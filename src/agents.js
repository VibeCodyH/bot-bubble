// Agent CLIs, run headless on the user's own subscription login (no API keys),
// each in its own empty working folder. Nothing can write: Claude and Grok Build
// run with no tools at all; Codex runs in its read-only sandbox and Muse Code with
// writes disabled, so those two can still read files to answer a question.
const { spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { nativeImage } = require('electron');

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);
const MAX_INLINE = 100 * 1024;
const ARG_BUDGET = 120 * 1024; // Linux caps one argv string at 128 KiB

const isImage = (f) => IMAGE_EXT.has(path.extname(f).toLowerCase());
const mime = (f) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' }[path.extname(f).toLowerCase()] || 'image/png');

// Non-image attachments are inlined as text.
function withFiles(text, files) {
  const parts = [text];
  for (const f of files) {
    const name = path.basename(f);
    const buf = fs.readFileSync(f);
    if (buf.length > MAX_INLINE || buf.includes(0)) parts.push(`[Attached ${name}: too large or not text, not included]`);
    else parts.push(`--- ${name} ---\n${buf.toString('utf8')}`);
  }
  return parts.join('\n\n');
}

// Shrink an image until its base64 fits the budget (grok only takes images inline in argv).
function inlineImage(file, budget) {
  let img = nativeImage.createFromPath(file);
  for (const width of [1600, 1280, 1024, 768, 512, 384]) {
    if (img.getSize().width > width) img = img.resize({ width, quality: 'good' });
    for (const q of [85, 70, 55]) {
      const data = img.toJPEG(q).toString('base64');
      if (data.length <= budget) return { type: 'image', data, mimeType: 'image/jpeg' };
    }
  }
  throw new Error(`${path.basename(file)} is too large to attach`);
}

function lines(out) {
  return out.split('\n').filter((l) => l.trim().startsWith('{')).map((l) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);
}

const ADAPTERS = {
  claude({ text, images, sessionId }) {
    const content = [{ type: 'text', text }, ...images.map((f) => ({
      type: 'image', source: { type: 'base64', media_type: mime(f), data: fs.readFileSync(f).toString('base64') },
    }))];
    return {
      cmd: 'claude',
      args: ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
        '--tools', '', '--setting-sources', '', ...(sessionId ? ['--resume', sessionId] : [])],
      stdin: `${JSON.stringify({ type: 'user', message: { role: 'user', content } })}\n`,
      parse(out) {
        const r = lines(out).find((e) => e.type === 'result');
        if (!r) return null;
        if (r.is_error) throw new Error(r.result || 'Claude returned an error');
        return { text: r.result, sessionId: r.session_id };
      },
    };
  },

  codex({ text, images, sessionId }) {
    const common = ['--json', '--skip-git-repo-check', '-c', 'sandbox_mode="read-only"', ...images.flatMap((f) => ['-i', f])];
    return {
      cmd: 'codex',
      args: sessionId ? ['exec', 'resume', sessionId, ...common, '-'] : ['exec', ...common, '-'],
      stdin: text,
      parse(out) {
        const ev = lines(out);
        const thread = ev.find((e) => e.type === 'thread.started');
        const msgs = ev.filter((e) => e.type === 'item.completed' && e.item?.type === 'agent_message');
        if (!msgs.length) return null;
        return { text: msgs.map((m) => m.item.text).join('\n\n'), sessionId: thread?.thread_id || sessionId };
      },
    };
  },

  grok({ text, images, sessionId, tmpDir }) {
    const args = ['--output-format', 'json', '--tools', '', ...(sessionId ? ['-r', sessionId] : [])];
    const files = [];
    if (images.length) {
      const blocks = [{ type: 'text', text }];
      const budget = Math.floor((ARG_BUDGET - Buffer.byteLength(text) - 1024) / images.length);
      for (const f of images) blocks.push(inlineImage(f, budget));
      args.push('--prompt-json', JSON.stringify(blocks));
    } else {
      const file = path.join(tmpDir, `prompt-${crypto.randomUUID()}.txt`);
      fs.writeFileSync(file, text);
      args.push('--prompt-file', file);
      files.push(file);
    }
    return {
      cmd: 'grok',
      args,
      files,
      parse(out) {
        const start = out.indexOf('{');
        if (start < 0) return null;
        const r = JSON.parse(out.slice(start));
        return { text: r.text, sessionId: r.sessionId };
      },
    };
  },

  muse({ text, images, sessionId, tmpDir }) {
    const id = sessionId || crypto.randomUUID();
    const file = path.join(tmpDir, `prompt-${crypto.randomUUID()}.txt`);
    fs.writeFileSync(file, text);
    return {
      cmd: 'muse',
      files: [file],
      args: ['exec', '--session-id', id, '--disable-write', '--json', '--prompt-file', file,
        ...images.flatMap((f) => ['--image', f])],
      parse(out) {
        const done = lines(out).filter((e) => e.payload_type === 'run.terminal.completed').pop();
        if (!done) return null;
        if (done.payload.terminal !== 'completed') throw new Error(`Muse run ${done.payload.terminal}`);
        return { text: done.payload.text, sessionId: id };
      },
    };
  },
};

// Returns { promise, cancel }. promise resolves to { text, sessionId }.
function run(agent, { text, attachments = [], sessionId, workDir }) {
  const adapter = ADAPTERS[agent];
  if (!adapter) throw new Error(`Unknown agent "${agent}"`);
  const tmpDir = path.join(workDir, '.tmp');
  fs.mkdirSync(tmpDir, { recursive: true });
  const images = attachments.filter(isImage);
  const spec = adapter({ text: withFiles(text, attachments.filter((f) => !isImage(f))), images, sessionId, tmpDir });

  const env = { ...process.env, PATH: `${path.join(os.homedir(), '.local', 'bin')}${path.delimiter}${process.env.PATH}` };
  const child = spawn(spec.cmd, spec.args, { cwd: workDir, env, detached: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let out = '';
  let err = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { err += d; });
  child.stdin.end(spec.stdin || '');

  let cancelled = false;
  const promise = new Promise((resolve, reject) => {
    child.on('error', (e) => reject(e.code === 'ENOENT' ? new Error(`"${spec.cmd}" is not installed or not on PATH`) : e));
    child.on('close', (code) => {
      for (const f of spec.files || []) fs.rmSync(f, { force: true });
      if (cancelled) return reject(new Error('Stopped'));
      try {
        const r = spec.parse(out);
        if (r && r.text) return resolve(r);
      } catch (e) { return reject(e); }
      const tail = (err || out).trim().split('\n').slice(-3).join('\n');
      reject(new Error(`${spec.cmd} exited ${code}${tail ? `: ${tail}` : ''}`));
    });
  });
  const cancel = () => {
    cancelled = true;
    try {
      if (process.platform === 'win32') child.kill();
      else process.kill(-child.pid, 'SIGTERM');
    } catch { /* already gone */ }
  };
  return { promise, cancel };
}

module.exports = { run };
