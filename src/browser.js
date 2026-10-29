// "Real browser" mode for web bots whose sign-in refuses embedded browsers
// (Google sign-in does). The bot runs in an actual Chrome/Brave/Chromium app
// window with its own profile, and on Hyprland the dot parks that window over
// the bubble, pins it, and hides it on a special workspace when the bubble closes.
const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const hypr = require('./hyprland');
const winpark = process.platform === 'win32' ? require('./winpark') : null;

// Brave and Chromium still load our extension from the command line (avatar +
// unread badge). Branded Chrome refuses, so it's the fallback: sign-in works, no extras.
const CANDIDATES = ['brave-browser', 'brave', 'chromium', 'chromium-browser', 'google-chrome', 'google-chrome-stable'];
const EXTENSIONS_OK = new Set(['brave-browser', 'brave', 'chromium', 'chromium-browser']);
// macOS and Windows browsers aren't on PATH, so look in their install folders.
const under = (dir, ...rest) => (process.env[dir] ? path.join(process.env[dir], ...rest) : null);
const APP_PATHS = {
  darwin: {
    'brave-browser': ['/Applications/Brave Browser.app/Contents/MacOS/Brave Browser'],
    chromium: ['/Applications/Chromium.app/Contents/MacOS/Chromium'],
    'google-chrome': ['/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'],
  },
  win32: {
    'brave-browser': ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map((d) => under(d, 'BraveSoftware', 'Brave-Browser', 'Application', 'brave.exe')),
    'google-chrome': ['ProgramFiles', 'ProgramFiles(x86)', 'LOCALAPPDATA'].map((d) => under(d, 'Google', 'Chrome', 'Application', 'chrome.exe')),
  },
}[process.platform];
const HIDDEN = 'special:bot-bubble';
const inContainer = fs.existsSync('/run/.containerenv');
const host = (cmd) => (inContainer ? ['distrobox-host-exec', ...cmd] : cmd);

let found; // promise of { name, cmd } for the browser to use, or null
function findBrowser() {
  if (APP_PATHS) {
    found ||= Promise.resolve(Object.entries(APP_PATHS)
      .map(([name, files]) => ({ name, cmd: files.find((f) => f && fs.existsSync(f)) }))
      .find((b) => b.cmd) || null);
  }
  found ||= new Promise((resolve) => {
    const [cmd, ...args] = host(['sh', '-c', CANDIDATES.map((b) => `command -v ${b} >/dev/null && echo ${b} && exit`).join('; ')]);
    execFile(cmd, args, (err, out) => {
      const name = err ? null : out.trim().split('\n')[0];
      resolve(name ? { name, cmd: name } : null);
    });
  });
  return found;
}

const windows = new Map(); // provider id -> { addr, pid, shown }
// One profile per browser: Brave and Chrome can't share one.
const profileDir = (dataDir, id, browser) => path.join(dataDir, 'browser', `${id}-${browser}`);

// Our extension for this bot: page-watch.js + glue, with the bridge details baked in,
// plus wide-load.js for a bot with a `loadWidth`.
function writeExtension(dataDir, p, bridge) {
  const dir = path.join(dataDir, 'browser-ext', p.id);
  const src = (f) => fs.readFileSync(path.join(__dirname, f), 'utf8');
  const matches = [`${new URL(p.url).origin}/*`];
  const width = Number(p.loadWidth) > 0 ? Number(p.loadWidth) : 0;
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    manifest_version: 3,
    name: 'Bot Bubble bridge',
    version: '1',
    description: 'Tells Bot Bubble when this bot replies and which avatar it uses.',
    host_permissions: ['http://127.0.0.1/*'],
    background: { service_worker: 'background.js' },
    content_scripts: [
      { matches, js: ['content.js'], run_at: 'document_idle' },
      // In the page's own world, before its scripts. It gets nothing else of ours.
      ...(width ? [{ matches, js: ['wide-load.js'], run_at: 'document_start', world: 'MAIN' }] : []),
    ],
  }, null, 2));
  fs.writeFileSync(path.join(dir, 'content.js'), `${src('page-watch.js')}\n${src('ext/content.js')}`);
  if (width) fs.writeFileSync(path.join(dir, 'wide-load.js'), `${src('wide-load.js')}\nbotBubbleWideLoad(${width});`);
  fs.writeFileSync(path.join(dir, 'background.js'),
    `const BRIDGE = ${JSON.stringify({ port: bridge.port, token: bridge.token, bot: p.id })};\n${src('ext/background.js')}`, { mode: 0o600 });
  fs.chmodSync(path.join(dir, 'background.js'), 0o600); // holds the bridge token
  return dir;
}
const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function cmdline(pid) {
  try { return fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch { return ''; }
}

// The window is ours when its process was started with our profile dir.
async function locate(dir) {
  const clients = await hypr.json('clients');
  return clients.find((c) => cmdline(c.pid).includes(`--user-data-dir=${dir}`)) || null;
}

async function place(addr, b) {
  const w = `window = "address:${addr}"`;
  await hypr.eval(`hl.dispatch(hl.dsp.window.resize({ ${w}, x = ${b.width}, y = ${b.height} })) `
    + `hl.dispatch(hl.dsp.window.move({ ${w}, x = ${b.x}, y = ${b.y} }))`);
}

// The card belongs over the bar. If it gets dragged or resized while showing, put it back.
let guard = null;
function watch() {
  if (guard) return;
  guard = setInterval(async () => {
    const shown = [...windows.values()].filter((w) => w.shown && w.bounds);
    if (!shown.length) { clearInterval(guard); guard = null; return; }
    const clients = await hypr.json('clients').catch(() => []);
    for (const w of shown) {
      const c = clients.find((x) => x.address === w.addr);
      const b = w.bounds;
      if (c && (c.at[0] !== b.x || c.at[1] !== b.y || c.size[0] !== b.width || c.size[1] !== b.height)) {
        await place(w.addr, b).catch(() => {});
      }
    }
  }, 500);
}

async function show(p, bounds, dataDir, bridge) {
  let w = windows.get(p.id);
  if (w && !hypr.available) {
    // Windows can be parked too; elsewhere we can only launch it.
    if (winpark) { winpark.show(dataDir, w.pid, bounds); w.shown = true; }
    return;
  }
  if (w && !(await hypr.json('clients')).some((c) => c.address === w.addr)) w = null; // user closed it
  if (!w) {
    const browser = await findBrowser();
    if (!browser) throw new Error('Real-browser mode needs Brave, Chromium or Chrome installed.');
    const dir = profileDir(dataDir, p.id, browser.name);
    if (hypr.available) {
      // Float it from the first frame so it never flashes in as a tiled window.
      const cls = `^[a-z-]+-${escape(new URL(p.url).host)}_.*$`;
      // JSON.stringify doubles the regex backslashes, which is what a Lua string needs.
      const name = `bot-bubble-browser-${p.id}`;
      const out = await hypr.rule(name, `hl.window_rule({ name = ${JSON.stringify(name)}, match = { class = ${JSON.stringify(cls)} }, float = true, tag = "+bot-bubble", `
        + `border_size = 0, rounding = 14, no_shadow = true, size = "${bounds.width} ${bounds.height}", move = "${bounds.x} ${bounds.y}" })`);
      if (out.trim() !== 'ok') console.error(`hyprland rule: ${out.trim()}`);
    }
    fs.mkdirSync(dir, { recursive: true });
    if (winpark) await winpark.closeProfile(dir);
    const extras = EXTENSIONS_OK.has(browser.name) && bridge ? [
      `--load-extension=${writeExtension(dataDir, p, bridge)}`,
      '--disable-features=DisableLoadExtensionCommandLineSwitch',
      // Keep watching for replies while the window sits hidden.
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows',
    ] : [];
    // Without Hyprland we can't park it later, so at least open it over the card.
    const geometry = hypr.available ? [] : [`--window-position=${bounds.x},${bounds.y}`, `--window-size=${bounds.width},${bounds.height}`];
    const [cmd, ...args] = host([browser.cmd, `--app=${p.url}`, `--user-data-dir=${dir}`, '--no-first-run', '--no-default-browser-check', ...geometry, ...extras]);
    const child = spawn(cmd, args, { detached: true, stdio: 'ignore' });
    child.on('error', (e) => console.error(e.message)).unref();
    if (!hypr.available) {
      // We can't see the window here, so treat the browser exiting as the window closing.
      const entry = { addr: null, pid: child.pid, shown: true };
      windows.set(p.id, entry);
      child.on('exit', () => { if (windows.get(p.id) === entry) windows.delete(p.id); });
      if (winpark) winpark.show(dataDir, child.pid, bounds);
      return;
    }
    let c = null;
    for (let i = 0; i < 150 && !c; i++) {
      c = await locate(dir);
      if (!c) await new Promise((r) => setTimeout(r, 100));
    }
    if (!c) throw new Error(`${browser.name} window didn't appear`);
    w = { addr: c.address, pid: c.pid, shown: false };
    windows.set(p.id, w);
  }
  if (hypr.available) await park(w, bounds);
}

// Hyprland: float and pin the window on the current workspace, over the card.
async function park(w, bounds) {
  const window = `address:${w.addr}`;
  if (!w.shown) {
    const ws = await hypr.json('activeworkspace');
    await hypr.dispatch('window.move', { window, workspace: String(ws.id), follow: false });
    await hypr.dispatch('window.float', { window, action: 'enable' });
    // Taskbars can skip tagged windows. Tag before pinning: the pin event is what makes them refresh.
    await hypr.dispatch('window.tag', { window, tag: '+bot-bubble' });
    await hypr.dispatch('window.pin', { window, action: 'enable' });
    w.shown = true;
  }
  w.bounds = bounds;
  await place(w.addr, bounds);
  // An app may refuse to get as small as the card. Then let it grow away from the
  // dot, and guard the size it actually took.
  await new Promise((r) => setTimeout(r, 150)); // the app's minimum applies a moment later
  const c = (await hypr.json('clients')).find((x) => x.address === w.addr);
  if (c && (c.size[0] > bounds.width || c.size[1] > bounds.height)) {
    const [width, height] = c.size;
    w.bounds = {
      x: bounds.right ? bounds.x + bounds.width - width : bounds.x,
      y: bounds.bottom ? bounds.y + bounds.height - height : bounds.y,
      width,
      height,
    };
    await place(w.addr, w.bounds);
  }
  watch();
}

// An app with no web client (Grok Bot): find its own window, or start it and wait,
// then park it like a real-browser window. Its window is matched by executable.
const resolved = new Map(); // command -> promise of its real path
function binary(cmd) {
  if (!resolved.has(cmd)) {
    resolved.set(cmd, new Promise((resolve) => {
      const [c, ...args] = host(['sh', '-c', 'readlink -f "$(command -v "$1")"', 'sh', cmd]);
      execFile(c, args, (err, out) => resolve(err ? '' : out.trim()));
    }));
  }
  return resolved.get(cmd);
}

// argv[0] rather than /proc/<pid>/exe: Electron apps can make the exe link unreadable.
const exeOf = (pid) => cmdline(pid).split('\0')[0];

async function findApp(p) {
  const bin = await binary(p.command[0]);
  const name = path.basename(p.command[0]);
  const mine = (await hypr.json('clients')).filter((c) => {
    const exe = exeOf(c.pid);
    return exe && (exe === bin || path.basename(exe) === name);
  });
  // The biggest one is the main window, not a popup or the app's own mini widget.
  return mine.sort((a, b) => b.size[0] * b.size[1] - a.size[0] * a.size[1])[0] || null;
}

async function showApp(p, bounds) {
  if (!hypr.available || !p.command?.length) return;
  let w = windows.get(p.id);
  if (w && !(await hypr.json('clients')).some((c) => c.address === w.addr)) { windows.delete(p.id); w = null; }
  if (!w) {
    let c = await findApp(p);
    if (!c) {
      const [cmd, ...args] = host(p.command);
      spawn(cmd, args, { detached: true, stdio: 'ignore' }).on('error', (e) => console.error(e.message)).unref();
      for (let i = 0; i < 150 && !c; i++) {
        await new Promise((r) => setTimeout(r, 100));
        c = await findApp(p);
      }
      if (!c) throw new Error(`${p.label} window didn't appear`);
    }
    // Remember where it lived, to hand it back when the bubble lets go of it.
    w = { addr: c.address, pid: c.pid, shown: false, app: true, home: c.workspace.id, floating: c.floating };
    windows.set(p.id, w);
  }
  await park(w, bounds);
}

// Put an app's window back on a normal workspace, unpinned, as it was.
async function release(w) {
  const window = `address:${w.addr}`;
  try {
    await hypr.dispatch('window.tag', { window, tag: '-bot-bubble' });
    await hypr.dispatch('window.pin', { window, action: 'disable' });
    const ws = w.home > 0 ? w.home : (await hypr.json('activeworkspace')).id;
    await hypr.dispatch('window.move', { window, workspace: String(ws), follow: false });
    if (!w.floating) await hypr.dispatch('window.float', { window, action: 'disable' });
  } catch { /* already closed */ }
}

async function hide(id, dataDir) {
  const w = windows.get(id);
  if (!w || !w.shown) return;
  if (!hypr.available) {
    if (winpark) { w.shown = false; winpark.hide(dataDir, w.pid); }
    return;
  }
  w.shown = false; // first, so a show() racing this one re-shows it instead of trusting stale state
  const window = `address:${w.addr}`;
  try {
    await hypr.dispatch('window.pin', { window, action: 'disable' });
    await hypr.dispatch('window.move', { window, workspace: HIDDEN, follow: false });
  } catch { windows.delete(id); } // already closed by the user
}

// After a crash an app's window can be left on our hidden workspace. Bring it back.
async function rescue(apps) {
  if (!hypr.available) return;
  for (const p of apps) {
    if (!p.command?.length) continue;
    const name = path.basename(p.command[0]);
    for (const c of await hypr.json('clients')) {
      if (c.workspace.name === HIDDEN && path.basename(exeOf(c.pid)) === name) {
        await release({ addr: c.address, shown: true, home: 0, floating: false });
      }
    }
  }
}

// Our browsers are closed; an app is never killed, only handed back.
async function close(id) {
  const w = windows.get(id);
  windows.delete(id);
  if (w?.app) await release(w);
  else if (w?.pid) { try { process.kill(w.pid); } catch { /* already gone */ } }
}

module.exports = {
  show,
  showApp,
  rescue,
  hide,
  close,
  closeAll: () => Promise.all([...windows.keys()].map(close)),
  isShown: (id) => Boolean(windows.get(id)?.shown),
  clearProfile: (dataDir, id) => {
    close(id);
    const root = path.join(dataDir, 'browser');
    for (const d of fs.existsSync(root) ? fs.readdirSync(root) : []) {
      if (d === id || CANDIDATES.some((b) => d === `${id}-${b}`)) fs.rmSync(path.join(root, d), { recursive: true, force: true });
    }
  },
};
