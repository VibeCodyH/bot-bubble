// Minimal Hyprland IPC client. Wayland won't let a client place or pin its own
// window, but on Hyprland we can ask the compositor over its control socket.
// Hyprland 0.55+ takes Lua dispatchers: `dispatch <lua expr>`.
const net = require('net');
const path = require('path');

const sig = process.env.HYPRLAND_INSTANCE_SIGNATURE;
const sock = sig && path.join(process.env.XDG_RUNTIME_DIR || '/tmp', 'hypr', sig, '.socket.sock');
let available = Boolean(sock);

function request(cmd) {
  return new Promise((resolve, reject) => {
    const s = net.connect(sock, () => s.write(cmd));
    let buf = '';
    s.on('data', (d) => { buf += d; });
    s.on('end', () => resolve(buf));
    s.on('error', reject);
  });
}

async function json(cmd) {
  return JSON.parse(await request(`j/${cmd}`));
}

const lua = (v) => (typeof v === 'string' ? JSON.stringify(v) : String(v));
const table = (o) => `{ ${Object.entries(o).map(([k, v]) => `${k} = ${lua(v)}`).join(', ')} }`;

async function dispatch(fn, args) {
  const out = await request(`dispatch hl.dsp.${fn}(${table(args)})`);
  if (out.trim() !== 'ok') throw new Error(`hyprland ${fn}: ${out.trim()}`);
}

// Runtime rules are dropped whenever Hyprland reloads its config (a `hyprctl reload`,
// or just saving the config file), and every window falls back to the default border
// and shadow. Keep each rule by name and replay them all when the event socket reports
// a reload. Replaying is safe: a rule's size/move only apply when a window opens.
const rules = new Map();
let events = null;
let retryMs = 1000;

function replayRules() {
  for (const [name, code] of rules) {
    request(`eval ${code}`).then(
      (out) => { if (out.trim() !== 'ok') console.error(`hyprland rule ${name}: ${out.trim()}`); },
      (e) => console.error(`hyprland rule ${name}: ${e.message}`),
    );
  }
}

function watchReloads() {
  if (events) return;
  events = net.connect(path.join(path.dirname(sock), '.socket2.sock'), () => {
    retryMs = 1000;
    // A reload may have happened while nobody was listening (before the first
    // connect, or after a drop). Replaying is idempotent, so just do it.
    replayRules();
  });
  events.unref();
  events.setEncoding('utf8');
  let buf = '';
  events.on('data', (d) => {
    const lines = (buf + d).split('\n');
    buf = lines.pop();
    if (lines.some((l) => l.startsWith('configreloaded>>'))) replayRules();
  });
  events.on('error', (e) => console.error(`hyprland events: ${e.message}`));
  events.on('close', () => {
    events = null;
    setTimeout(watchReloads, retryMs).unref();
    retryMs = Math.min(retryMs * 2, 30000);
  });
}

function rule(name, code) {
  rules.set(name, code);
  watchReloads();
  return request(`eval ${code}`);
}

module.exports = {
  get available() { return available; },
  // Older Hyprland has no Lua dispatchers; it gets the plain Electron path instead.
  async init() {
    if (!available) return;
    try {
      const v = await json('version');
      const [major, minor] = String(v.version || v.tag || '').replace(/^v/, '').split('.').map(Number);
      available = major > 0 || minor >= 55;
    } catch { available = false; }
  },
  json,
  dispatch,
  rule,
  eval: (code) => request(`eval ${code}`),
  async findWindow(pid, title) {
    const clients = await json('clients');
    return clients.find((c) => c.pid === pid && c.title === title) || null;
  },
  cursor: () => json('cursorpos'),
  monitors: () => json('monitors'),
};
