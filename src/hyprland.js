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
  eval: (code) => request(`eval ${code}`),
  async findWindow(pid, title) {
    const clients = await json('clients');
    return clients.find((c) => c.pid === pid && c.title === title) || null;
  },
  cursor: () => json('cursorpos'),
  monitors: () => json('monitors'),
};
