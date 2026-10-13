const { app, BrowserWindow, Menu, WebContentsView, ipcMain, screen, session, shell, dialog } = require('electron');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { spawn } = require('child_process');
const hypr = require('./hyprland');
const { loadConfig, saveConfig, loadState, saveState, configPath, dataDir } = require('./config');
const presets = require('./presets');
const agents = require('./agents');
const browser = require('./browser');
const { startBridge } = require('./bridge');

// Web sign-ins live under userData. Pin it so a packaged build's product name
// doesn't move it away from ~/.config/bot-bubble.
app.setPath('userData', path.join(app.getPath('appData'), 'bot-bubble'));

// Geometry (logical px). Collapsed, the window is just the dot. Expanded, the
// dot stays where it was and the bubble opens toward the middle of the screen.
const DOT = 72;
const EXP_W = 440;
const EXP_H = 700;
const HEADER = 48;
const PAD = 8;
const TITLE = 'bot-bubble';
const SETTINGS_TITLE = 'Bot Bubble Settings';
const AUTOSTART = path.join(app.getPath('home'), '.config', 'autostart', 'bot-bubble.desktop');
const MAX_MESSAGES = 100;
const WEB_PERMISSIONS = new Set(['media', 'notifications', 'clipboard-sanitized-write', 'fullscreen']);
const inContainer = fs.existsSync('/run/.containerenv');
const SUPPORT_URL = 'https://github.com/VibeCodyH/bot-bubble#support';

let cfg = loadConfig();
const saved = loadState();
const state = {
  pos: saved.pos || null,          // top-left of the dot, global logical coords
  locked: Boolean(saved.locked),
  active: cfg.providers.some((p) => p.id === saved.active && p.enabled !== false) ? saved.active : cfg.active,
  expanded: false,
  anchor: { h: 'right', v: 'bottom' },
  unread: {},
  threads: saved.threads || {}, // cli provider id -> { sessionId, messages }
  busy: null,                   // { id, cancel } while an agent is answering
  browserError: {},             // provider id -> last real-browser launch error
};

let win = null;
let settingsWin = null;
let bridge = null; // loopback endpoint for real-browser bots' extension

// Sandboxed preloads can't require local files, so the web preload is built
// from page-watch.js + web-preload.js at startup.
function webPreload() {
  const file = path.join(dataDir, 'gen', 'web-preload.js');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, ['page-watch.js', 'web-preload.js'].map((f) => fs.readFileSync(path.join(__dirname, f), 'utf8')).join('\n'));
  return file;
}
let webPreloadFile = null;
let hyprAddr = null;
const views = new Map(); // provider id -> WebContentsView

const provider = (id = state.active) => cfg.providers.find((p) => p.id === id);
const enabled = () => cfg.providers.filter((p) => p.enabled !== false);
const embedded = (p) => p?.type === 'web' && p.browser !== true;  // lives in our WebContentsView
const inBrowser = (p) => p?.type === 'web' && p.browser === true; // lives in a real browser window
const persist = () => saveState({ pos: state.pos, locked: state.locked, active: state.active, threads: state.threads });
const thread = (id = state.active) => (state.threads[id] ||= { sessionId: null, messages: [] });

// The bot's own avatar, mirrored from its page (see web-preload.js) and kept on
// disk so it's there at startup. { kind: 'video' | 'img', url }
const avatarDir = path.join(dataDir, 'avatars');
const botAvatars = new Map();
for (const f of fs.existsSync(avatarDir) ? fs.readdirSync(avatarDir) : []) {
  const m = f.match(/^(.+)\.(video|img|sprite)\.[0-9a-f]{12}$/);
  if (!m) continue;
  let meta;
  if (m[2] === 'sprite') {
    try { meta = JSON.parse(fs.readFileSync(path.join(avatarDir, `${f}.json`), 'utf8')); } catch { continue; }
  }
  botAvatars.set(m[1], { kind: m[2], url: pathToFileURL(path.join(avatarDir, f)).href, meta });
}

const AVATAR_KINDS = new Set(['video', 'img', 'sprite']);
function saveBotAvatar(id, { kind, data, url, meta }) {
  if (!AVATAR_KINDS.has(kind)) return;
  if (url) { if (/^https:\/\//.test(url) && kind !== 'sprite') botAvatars.set(id, { kind, url }); return; }
  if (!data || (kind === 'sprite' && !meta)) return;
  const buf = Buffer.from(data);
  const name = `${id}.${kind}.${crypto.createHash('sha1').update(buf).digest('hex').slice(0, 12)}`;
  fs.mkdirSync(avatarDir, { recursive: true });
  for (const f of fs.readdirSync(avatarDir)) if (f.startsWith(`${id}.`) && f !== name) fs.rmSync(path.join(avatarDir, f), { force: true });
  fs.writeFileSync(path.join(avatarDir, name), buf);
  if (kind === 'sprite') fs.writeFileSync(path.join(avatarDir, `${name}.json`), JSON.stringify(meta));
  botAvatars.set(id, { kind, url: pathToFileURL(path.join(avatarDir, name)).href, meta });
}

// "bot": the bot's own (animated) avatar when we have one; else the custom image; else the default.
function avatarFor(p) {
  const mode = p.avatarMode || (p.type === 'web' ? 'bot' : 'custom');
  if (mode === 'bot' && botAvatars.has(p.id)) return botAvatars.get(p.id);
  const url = avatarUrl(p);
  return url ? { kind: 'img', url } : null;
}

function avatarUrl(p) {
  for (const c of [].concat(p.avatar || [])) {
    for (const f of [c, `/run/host${c}`]) if (fs.existsSync(f)) return pathToFileURL(f).href;
  }
  return '';
}

// ---------- geometry ----------

const inside = (pt, b) => pt.x >= b.x && pt.x < b.x + b.width && pt.y >= b.y && pt.y < b.y + b.height;

async function monitors() {
  if (!hypr.available) return screen.getAllDisplays().map((d) => d.workArea);
  return (await hypr.monitors()).map((m) => ({ x: m.x, y: m.y, width: m.width / m.scale, height: m.height / m.scale, focused: m.focused }));
}

async function monitorAt(pt) {
  const mons = await monitors();
  return mons.find((b) => inside(pt, b)) || mons.find((b) => b.focused) || mons[0];
}

async function defaultPos() {
  const m = hypr.available ? await monitorAt(await hypr.cursor()) : screen.getPrimaryDisplay().workArea;
  return { x: Math.round(m.x + m.width - DOT - 24), y: Math.round(m.y + m.height - DOT - 96) };
}

function layout() {
  const { h, v } = state.anchor;
  if (!state.expanded) {
    return { win: { x: state.pos.x, y: state.pos.y, width: DOT, height: DOT }, dot: { x: 0, y: 0, size: DOT } };
  }
  // Stacked outward from the dot: dot, bot bar (optional), gap, chat card.
  // A real-browser bot's card is its own window, so ours stops at the bar.
  const tabs = cfg.settings.showTabs !== false;
  const bar = tabs ? HEADER : 0;
  const external = inBrowser(provider());
  const cardH = EXP_H - DOT - HEADER - PAD;
  const height = DOT + bar + (external ? 0 : PAD + cardH);
  const x = h === 'right' ? state.pos.x + DOT - EXP_W : state.pos.x;
  const y = v === 'bottom' ? state.pos.y + DOT - height : state.pos.y;
  const dotY = v === 'bottom' ? height - DOT : 0;
  const barY = v === 'bottom' ? dotY - bar : DOT;
  const card = { x: PAD, y: v === 'bottom' ? barY - PAD - cardH : barY + bar + PAD, width: EXP_W - 2 * PAD, height: cardH };
  return {
    compact: external,
    tabs,
    win: { x, y, width: EXP_W, height },
    dot: { x: h === 'right' ? EXP_W - DOT : 0, y: dotY, size: DOT },
    pill: tabs ? { x: 0, y: barY, width: EXP_W, height: HEADER } : null,
    card: external ? null : card,
    browser: external ? { x: x + card.x, y: y + card.y, width: card.width, height: card.height } : null,
  };
}

let placed = null; // last bounds we put the window at
async function place(b, { refreshPointer = true } = {}) {
  if (hyprAddr) {
    // One round trip: the compositor resizes and moves in the same tick, so the
    // dot never visibly jumps and there's nothing to wait on.
    const w = `window = "address:${hyprAddr}"`;
    let lua = `hl.dispatch(hl.dsp.window.resize({ ${w}, x = ${b.width}, y = ${b.height} })) `
      + `hl.dispatch(hl.dsp.window.move({ ${w}, x = ${b.x}, y = ${b.y} }))`;
    // Wayland only tells us where the pointer is when it moves. If the window
    // changed under a still cursor, our idea of it is stale and the next click
    // misses; re-warping to the same spot makes the compositor send it again.
    if (refreshPointer) {
      const c = await hypr.cursor();
      if (inside(c, b) || (placed && inside(c, placed))) lua += ` hl.dispatch(hl.dsp.cursor.move({ x = ${c.x}, y = ${c.y} }))`;
    }
    const out = await hypr.eval(lua);
    if (out.trim() !== 'ok') throw new Error(`hyprland place: ${out.trim()}`);
  } else {
    win.setBounds(b);
  }
  placed = b;
}

// Layout passes never overlap: a click mid-pass just schedules one more pass
// with the newest state, so rapid clicks can't leave the window half-placed.
let layoutRun = null;
let layoutAgain = false;
function applyLayout() {
  if (layoutRun) { layoutAgain = true; return layoutRun; }
  layoutRun = (async () => {
    do { layoutAgain = false; await layoutPass(); } while (layoutAgain);
  })().finally(() => { layoutRun = null; });
  return layoutRun;
}

async function layoutPass() {
  const m = await monitorAt({ x: state.pos.x + DOT / 2, y: state.pos.y + DOT / 2 });
  state.anchor = {
    h: state.pos.x + DOT / 2 > m.x + m.width / 2 ? 'right' : 'left',
    v: state.pos.y + DOT / 2 > m.y + m.height / 2 ? 'bottom' : 'top',
  };
  const l = layout();
  await place(l.win).catch((e) => console.error(e.message));
  syncViews(l);
  broadcast();
}

// ---------- web providers ----------

const preparedSessions = new Set();
// The bot's own site and its subdomains, so mic and notifications don't go to
// whatever page a link or sign-in flow lands on.
function sameSite(url, botUrl) {
  try {
    const host = new URL(url).hostname;
    const base = new URL(botUrl).hostname.replace(/^www\./, '');
    return host === base || host.endsWith(`.${base}`);
  } catch { return false; }
}

function prepareSession(ses, id) {
  if (preparedSessions.has(ses)) return;
  preparedSessions.add(ses);
  // Sites gate features (and some sign-in flows) on a plain Chrome UA.
  ses.setUserAgent(ses.getUserAgent().replace(/\s(Electron|bot-bubble)\/\S+/g, ''));
  // Looked up per request: the bot's URL can change in Settings while its session lives on.
  const allowed = (perm, url) => WEB_PERMISSIONS.has(perm) && sameSite(url, provider(id)?.url);
  ses.setPermissionRequestHandler((_wc, perm, cb, details) => cb(allowed(perm, details.requestingUrl)));
  ses.setPermissionCheckHandler((_wc, perm, origin) => allowed(perm, origin));
}

// window.open popups (OAuth sign-in) stay in-app on the bot's session, which a
// shift-click popup wouldn't get by default; ordinary target=_blank links go to the
// real browser. Popups of popups get the same rules.
function guardPopups(wc, ses) {
  wc.setWindowOpenHandler(({ url, disposition }) => {
    if (disposition === 'new-window' && (/^https?:\/\//i.test(url) || url === 'about:blank')) {
      return { action: 'allow', overrideBrowserWindowOptions: { width: 520, height: 720, autoHideMenuBar: true, webPreferences: { session: ses } } };
    }
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  wc.on('did-create-window', (child) => guardPopups(child.webContents, ses));
}

function markUnread(id) {
  const visible = state.expanded && state.active === id;
  if (visible || state.unread[id]) return;
  state.unread[id] = true;
  broadcast();
}

function createView(p) {
  const view = new WebContentsView({
    webPreferences: {
      partition: `persist:${p.id}`,
      preload: (webPreloadFile ||= webPreload()),
      backgroundThrottling: false, // keep watching for replies while hidden
    },
  });
  prepareSession(view.webContents.session, p.id);
  view.setBorderRadius(18);
  view.setVisible(false);
  view.setBounds({ x: PAD, y: 0, width: EXP_W - 2 * PAD, height: EXP_H - DOT - HEADER - PAD });
  const wc = view.webContents;
  guardPopups(wc, wc.session);
  wc.on('page-title-updated', (_e, title) => { if (/^\(\d+\)/.test(title)) markUnread(p.id); });
  wc.loadURL(p.url);
  win.contentView.addChildView(view);
  views.set(p.id, { view, url: p.url });
  return view;
}

function destroyView(id) {
  const v = views.get(id);
  if (!v) return;
  win.contentView.removeChildView(v.view);
  v.view.webContents.close();
  views.delete(id);
}

function syncViews(l = layout()) {
  const p = provider();
  if (state.expanded && embedded(p) && !views.has(p.id)) createView(p);
  for (const b of cfg.providers.filter(inBrowser)) {
    if (state.expanded && b.id === state.active) {
      browser.show(b, l.browser, dataDir, bridge).then(() => {
        // The bubble may have closed while the browser was starting.
        if (!(state.expanded && state.active === b.id)) browser.hide(b.id);
        if (state.browserError[b.id]) { delete state.browserError[b.id]; broadcast(); }
      }).catch((e) => { state.browserError[b.id] = e.message; broadcast(); });
    } else {
      browser.hide(b.id);
    }
  }
  for (const [id, { view }] of views) {
    const show = state.expanded && id === state.active;
    if (show) view.setBounds(l.card);
    if (view.getVisible() !== show) view.setVisible(show);
  }
}

ipcMain.on('web:avatar', (e, a) => {
  for (const [id, { view }] of views) {
    if (view.webContents !== e.sender) continue;
    const before = botAvatars.get(id)?.url;
    saveBotAvatar(id, a);
    if (botAvatars.get(id)?.url !== before) { broadcast(); settingsWin?.webContents.send('settings:avatars'); }
  }
});

ipcMain.on('web:activity', (e) => {
  for (const [id, { view }] of views) if (view.webContents === e.sender) markUnread(id);
});

// ---------- app providers ----------

function launchApp(p) {
  const cmd = inContainer ? ['distrobox-host-exec', ...p.command] : p.command;
  spawn(cmd[0], cmd.slice(1), { detached: true, stdio: 'ignore' }).on('error', (e) => console.error(e.message)).unref();
}

// ---------- state + actions ----------

// Bot pages never get ipcRenderer, but only our own two windows may drive the app.
const trusted = (e) => [win, settingsWin].some((w) => w && !w.isDestroyed() && e.sender === w.webContents);
const handle = (channel, fn) => ipcMain.handle(channel, (e, ...args) => (trusted(e) ? fn(e, ...args) : undefined));
const listen = (channel, fn) => ipcMain.on(channel, (e, ...args) => { if (trusted(e)) fn(e, ...args); });

// Our windows only ever show our own files.
function lockDown(wc) {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }));
  wc.on('will-navigate', (e) => e.preventDefault());
}

function publicState() {
  const p = provider();
  return {
    providers: enabled().map(({ id, label, type }) => ({ id, label, type })),
    provider: p.id,
    type: p.type,
    label: p.label,
    avatar: avatarFor(p),
    locked: state.locked,
    expanded: state.expanded,
    anchor: state.anchor,
    layout: layout(),
    unread: Object.values(state.unread).some(Boolean),
    unreadBy: state.unread,
    hint: inBrowser(p) ? (state.browserError[p.id] || `${p.label} is open in its own browser window.`) : 'Loading…',
    messages: p.type === 'cli' ? thread(p.id).messages : [],
    busy: state.busy?.id === p.id,
    busyAny: Boolean(state.busy),
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
  updateLook();
}

// Pet avatars turn their head toward the cursor, so while one is on the dot we
// feed the renderer the cursor's offset from the dot (only when it moves).
let lookTimer = null;
let lastLook = null;
function updateLook() {
  const av = state.pos && avatarFor(provider());
  const want = Boolean(av?.kind === 'sprite' && av.meta?.grid);
  if (want && !lookTimer) {
    lookTimer = setInterval(async () => {
      const c = hypr.available ? await hypr.cursor().catch(() => null) : screen.getCursorScreenPoint();
      if (!c || !win || win.isDestroyed()) return;
      const look = { dx: Math.round(c.x - (state.pos.x + DOT / 2)), dy: Math.round(c.y - (state.pos.y + DOT / 2)) };
      if (lastLook && look.dx === lastLook.dx && look.dy === lastLook.dy) return;
      lastLook = look;
      win.webContents.send('look', look);
    }, 80);
  } else if (!want && lookTimer) {
    clearInterval(lookTimer);
    lookTimer = null;
  }
}

// fromDot: opened by clicking the dot (or the launcher), which is when the
// default bot applies. Picking a bot explicitly never gets overridden.
async function setExpanded(open, fromDot = false) {
  const def = cfg.settings.defaultBot;
  if (open && fromDot && !state.expanded && def && def !== 'last' && enabled().some((p) => p.id === def)) state.active = def;
  if (open) state.unread[state.active] = false;
  state.expanded = open;
  await applyLayout();
  if (open) {
    win.focus();
    views.get(state.active)?.view.webContents.focus();
  }
}

handle('state:get', () => publicState());
handle('win:toggle', () => setExpanded(!state.expanded, true));
handle('win:collapse', () => setExpanded(false));
handle('win:lock', (_e, locked) => { state.locked = Boolean(locked); persist(); broadcast(); });
handle('provider:set', async (_e, id) => {
  const p = provider(id);
  if (!p || p.enabled === false) return;
  state.active = id;
  persist();
  await setExpanded(state.expanded);
});
handle('app:open', async () => {
  if (provider().type !== 'app') return;
  launchApp(provider());
  await setExpanded(false);
});
// ---------- cli providers ----------

function addMessage(id, msg) {
  const t = thread(id);
  t.messages.push({ ts: Date.now(), ...msg });
  if (t.messages.length > MAX_MESSAGES) t.messages.splice(0, t.messages.length - MAX_MESSAGES);
}

async function sendChat({ text, attachments = [] }) {
  const p = provider();
  if (p.type !== 'cli' || state.busy || !(text.trim() || attachments.length)) return;
  const t = thread(p.id);
  addMessage(p.id, { role: 'user', text, attachments });
  const workDir = path.join(dataDir, 'workspace', p.id);
  fs.mkdirSync(workDir, { recursive: true });
  try {
    const job = agents.run(p.agent, { text, attachments, sessionId: t.sessionId, workDir });
    state.busy = { id: p.id, cancel: job.cancel };
    broadcast();
    const r = await job.promise;
    t.sessionId = r.sessionId || t.sessionId;
    addMessage(p.id, { role: 'assistant', text: r.text });
    markUnread(p.id);
  } catch (err) {
    addMessage(p.id, { role: 'system', text: err.message });
  } finally {
    state.busy = null;
    persist();
    broadcast();
  }
}
handle('chat:send', (_e, msg) => sendChat(msg));
handle('chat:cancel', () => state.busy?.cancel());
function newThread() {
  const p = provider();
  if (p.type !== 'cli' || state.busy?.id === p.id) return;
  state.threads[p.id] = { sessionId: null, messages: [] };
  persist();
  broadcast();
}
handle('chat:new', () => newThread());

// Right-click on the dot: everything, so the bot bar can be hidden.
handle('menu:open', () => {
  const p = provider();
  Menu.buildFromTemplate([
    ...enabled().map((b) => ({
      label: b.label,
      type: 'radio',
      checked: b.id === state.active,
      click: async () => { state.active = b.id; persist(); await setExpanded(true); },
    })),
    { type: 'separator' },
    ...(p.type === 'cli' ? [{ label: 'New chat', click: () => newThread() }] : []),
    ...(embedded(p) ? [{ label: 'Reload', click: () => views.get(p.id)?.view.webContents.reload() }] : []),
    { label: 'Lock position', type: 'checkbox', checked: state.locked, click: (item) => { state.locked = item.checked; persist(); broadcast(); } },
    { label: 'Settings…', click: () => openSettings() },
    { type: 'separator' },
    { label: 'Quit Bot Bubble', click: () => app.quit() },
  ]).popup({ window: win });
});
handle('files:pick', async () => {
  const r = await dialog.showOpenDialog(win, { properties: ['openFile', 'multiSelections'] });
  return r.canceled ? [] : r.filePaths;
});
handle('view:reload', () => views.get(state.active)?.view.webContents.reload());
handle('app:quit', () => app.quit());

// ---------- settings ----------

function applyConfig(next) {
  const prev = cfg;
  cfg = saveConfig(next);
  for (const [id, v] of views) {
    const p = provider(id);
    const keep = p && p.enabled !== false && embedded(p) && p.url === v.url;
    if (!keep) destroyView(id);
  }
  for (const old of prev.providers.filter(inBrowser)) {
    const p = provider(old.id);
    if (!p || p.enabled === false || !inBrowser(p) || p.url !== old.url) browser.close(old.id);
  }
  if (cfg.settings.keepLoaded) {
    for (const p of enabled()) if (embedded(p) && !views.has(p.id)) createView(p);
  }
  for (const id of Object.keys(state.unread)) if (!provider(id)) delete state.unread[id];
  if (!enabled().some((p) => p.id === state.active)) state.active = enabled()[0].id;
  persist();
  applyLayout();
}

function settingsPayload() {
  return {
    config: cfg,
    presets,
    avatars: Object.fromEntries(cfg.providers.map((p) => [p.id, avatarFor(p)])),
    botAvatars: Object.fromEntries(cfg.providers.map((p) => [p.id, botAvatars.has(p.id)])),
    locked: state.locked,
    autostart: autostartOn(),
    version: app.getVersion(),
    paths: { config: configPath, data: dataDir },
  };
}

function openSettings() {
  if (settingsWin && !settingsWin.isDestroyed()) { settingsWin.focus(); return; }
  settingsWin = new BrowserWindow({
    title: SETTINGS_TITLE,
    width: 860,
    height: 600,
    minWidth: 720,
    minHeight: 480,
    frame: false,
    backgroundColor: '#14161b',
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js') },
  });
  settingsWin.on('page-title-updated', (e) => e.preventDefault());
  lockDown(settingsWin.webContents);
  settingsWin.loadFile(path.join(__dirname, 'renderer', 'settings.html'));
  settingsWin.on('closed', () => { settingsWin = null; });
}

// Linux uses an XDG autostart entry; macOS and Windows have their own login items.
const autostartOn = () => (process.platform === 'linux' ? fs.existsSync(AUTOSTART) : app.getLoginItemSettings().openAtLogin);

function setAutostart(on) {
  if (process.platform !== 'linux') { app.setLoginItemSettings({ openAtLogin: on }); return; }
  if (!on) { fs.rmSync(AUTOSTART, { force: true }); return; }
  // An AppImage runs from a new mount each time, so point at the AppImage itself.
  const bin = process.env.APPIMAGE || (app.isPackaged ? process.execPath : path.resolve(__dirname, '..', 'bin', 'bot-bubble'));
  fs.mkdirSync(path.dirname(AUTOSTART), { recursive: true });
  fs.writeFileSync(AUTOSTART, `[Desktop Entry]\nType=Application\nName=Bot Bubble\nComment=A floating dot for your AI bots\nExec="${bin}"\nX-GNOME-Autostart-enabled=true\n`);
}

handle('settings:open', () => openSettings());
handle('settings:get', () => settingsPayload());
handle('settings:save', (_e, next) => { applyConfig(next); return settingsPayload(); });
handle('settings:lock', (_e, locked) => { state.locked = Boolean(locked); persist(); broadcast(); });
handle('settings:resetPosition', async () => {
  state.pos = await defaultPos();
  persist();
  await applyLayout();
});
handle('settings:autostart', (_e, on) => { setAutostart(Boolean(on)); return autostartOn(); });
handle('settings:clearData', async (_e, id) => {
  const p = provider(id);
  if (!p || p.type !== 'web') return;
  browser.clearProfile(dataDir, id);
  const ses = session.fromPartition(`persist:${id}`);
  await ses.clearStorageData();
  await ses.clearCache();
  views.get(id)?.view.webContents.reload();
});
handle('settings:openInBrowser', (_e, id) => {
  const url = provider(id)?.url;
  if (url && /^https?:\/\//i.test(url)) shell.openExternal(url);
});
handle('settings:clearThread', (_e, id) => {
  if (state.busy?.id === id) return;
  delete state.threads[id];
  persist();
  broadcast();
});
handle('settings:pickAvatar', async () => {
  const r = await dialog.showOpenDialog(settingsWin, { properties: ['openFile'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'] }] });
  return r.canceled ? null : r.filePaths[0];
});
handle('settings:openPath', (_e, which) => shell.openPath(which === 'config' ? configPath : dataDir));
handle('settings:close', () => settingsWin?.close());
handle('settings:support', () => shell.openExternal(SUPPORT_URL));

// Drag: follow the cursor until the renderer says the button is up.
let drag = null;
listen('drag:start', async () => {
  if (state.locked || drag) return;
  if (state.expanded) await setExpanded(false);
  const cursor = hypr.available ? hypr.cursor : async () => screen.getCursorScreenPoint();
  const c0 = await cursor();
  drag = { dx: c0.x - state.pos.x, dy: c0.y - state.pos.y, busy: false };
  drag.timer = setInterval(async () => {
    if (!drag || drag.busy) return;
    drag.busy = true;
    try {
      const c = await cursor();
      state.pos = { x: Math.round(c.x - drag.dx), y: Math.round(c.y - drag.dy) };
      await place(layout().win, { refreshPointer: false });
    } catch (e) { console.error(e.message); }
    if (drag) drag.busy = false;
  }, 16);
});
listen('drag:end', async () => {
  if (!drag) return;
  clearInterval(drag.timer);
  drag = null;
  persist();
  await applyLayout();
});

// ---------- boot ----------

async function findHyprWindow() {
  for (let i = 0; i < 50; i++) {
    const c = await hypr.findWindow(process.pid, TITLE);
    if (c) return c.address;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('bot-bubble window never appeared in hyprctl clients');
}

async function boot() {
  await hypr.init();
  bridge = await startBridge(dataDir, {
    activity: (id) => { if (inBrowser(provider(id))) markUnread(id); },
    avatar: (id, a) => {
      if (!inBrowser(provider(id))) return;
      const before = botAvatars.get(id)?.url;
      saveBotAvatar(id, a.b64 ? { kind: a.kind, meta: a.meta, data: Buffer.from(a.b64, 'base64') } : { kind: 'img', url: a.url });
      if (botAvatars.get(id)?.url !== before) { broadcast(); settingsWin?.webContents.send('settings:avatars'); }
    },
  });
  // A saved spot on a monitor that's gone would strand the dot off-screen.
  const center = state.pos && { x: state.pos.x + DOT / 2, y: state.pos.y + DOT / 2 };
  if (!center || !(await monitors()).some((b) => inside(center, b))) state.pos = await defaultPos();
  if (hypr.available) {
    // Runtime rule, nothing written to the user's config. Gone after a Hyprland reload.
    const rule = `hl.window_rule({ name = "bot-bubble", match = { title = "^${TITLE}$" }, float = true, pin = true, `
      + `border_size = 0, rounding = 0, no_shadow = true, no_anim = true, no_blur = true, no_initial_focus = true, `
      + `size = "${DOT} ${DOT}", move = "${state.pos.x} ${state.pos.y}" })`;
    const settingsRule = `hl.window_rule({ name = "bot-bubble-settings", match = { title = "^${SETTINGS_TITLE}$" }, `
      + `float = true, center = true, size = "860 600" })`;
    for (const r of [rule, settingsRule]) {
      const out = await hypr.eval(r);
      if (out.trim() !== 'ok') console.error(`hyprland rule: ${out.trim()}`);
    }
  }
  win = new BrowserWindow({
    title: TITLE,
    width: DOT,
    height: DOT,
    x: state.pos.x,
    y: state.pos.y,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Hyprland sizes it from outside, and Wayland min/max would block that. On Windows a
    // resizable transparent window gets a faint frame, and setBounds works without it.
    resizable: process.platform !== 'win32',
    thickFrame: false, // Windows: no frame or border around the transparent dot
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: false,
    show: false,
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.on('page-title-updated', (e) => e.preventDefault());
  lockDown(win.webContents);
  await win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.showInactive();
  if (hypr.available) hyprAddr = await findHyprWindow();
  // Web bots load up front so replies can light the badge before first open.
  if (cfg.settings.keepLoaded) for (const p of enabled()) if (embedded(p)) createView(p);
  await applyLayout();
  if (process.argv.includes('--settings')) openSettings();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const open = argv.find((a) => a.startsWith('--open='))?.slice(7);
    if (argv.includes('--settings')) openSettings();
    else if (open && enabled().some((p) => p.id === open)) { state.active = open; persist(); setExpanded(true); }
    else setExpanded(!state.expanded, true);
  });
  app.whenReady().then(boot).catch((e) => {
    dialog.showErrorBox('Bot Bubble', e.stack || String(e));
    app.quit();
  });
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', () => browser.closeAll());
}
