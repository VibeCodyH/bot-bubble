const $ = (sel, el = document) => el.querySelector(sel);
const api = window.settings;
const TYPE_LABEL = { web: 'Web', app: 'App', cli: 'CLI' };
const AGENTS = [['claude', 'Claude Code'], ['codex', 'Codex'], ['grok', 'Grok Build'], ['muse', 'Muse Code']];

let data = null;    // last payload from main
let cfg = null;     // working copy of the config
const open = new Set(); // ids of bots with the editor expanded

// ---------- saving ----------

let savedTimer = null;
async function save({ rerender = false } = {}) {
  data = await api.save(cfg);
  // Open editors hold references into cfg, so only swap in the saved copy on a full re-render.
  if (rerender) {
    cfg = structuredClone(data.config);
    renderBots();
    renderGeneral(); // the default-bot list follows the bots
  } else {
    refreshAvatars();
  }
  $('#saved').classList.add('show');
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => $('#saved').classList.remove('show'), 1400);
}

// ---------- helpers ----------

function hue(s) {
  let h = 0;
  for (const c of s) h = (h * 31 + c.charCodeAt(0)) % 360;
  return h;
}

function avatarEl(el, { id, label }, av) {
  if (renderAvatar(el, av)) {
    for (const n of [...el.childNodes]) if (!(n instanceof Element && n.classList.contains('av'))) n.remove();
    el.style.background = '#2a2e36';
  } else {
    el.replaceChildren();
    delete el.dataset.avatar;
    el.textContent = (label || '?').trim().charAt(0).toUpperCase() || '?';
    const h = hue(id || label || '');
    el.style.background = `linear-gradient(135deg, hsl(${h} 55% 48%), hsl(${(h + 40) % 360} 60% 34%))`;
  }
}

function detail(p) {
  if (p.type === 'web') return (p.url || '').replace(/^https?:\/\//, '') + (p.browser ? '  ·  real browser' : '');
  if (p.type === 'app') return (p.command || []).join(' ') || 'no command set';
  return AGENTS.find(([a]) => a === p.agent)?.[0] || p.agent || '';
}

function uniqueId(label) {
  const base = (label || 'bot').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'bot';
  let id = base;
  for (let i = 2; cfg.providers.some((p) => p.id === id); i++) id = `${base}-${i}`;
  return id;
}

function splitCommand(s) {
  return (s.match(/"[^"]*"|'[^']*'|\S+/g) || []).map((t) => t.replace(/^(['"])(.*)\1$/, '$2'));
}

const joinCommand = (cmd) => (cmd || []).map((t) => (/\s/.test(t) ? `"${t}"` : t)).join(' ');

// A destructive button needs a second click within 3 s.
function confirmButton(label, armedLabel, onConfirm, cls = 'danger') {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  let timer = null;
  b.onclick = async () => {
    if (!b.classList.contains('arm')) {
      b.classList.add('arm');
      b.textContent = armedLabel;
      timer = setTimeout(() => { b.classList.remove('arm'); b.textContent = label; }, 3000);
      return;
    }
    clearTimeout(timer);
    b.classList.remove('arm');
    b.disabled = true;
    await onConfirm();
    b.textContent = 'Done';
    setTimeout(() => { b.disabled = false; b.textContent = label; }, 1500);
  };
  return b;
}

function button(label, cls, onClick) {
  const b = document.createElement('button');
  b.className = cls;
  b.textContent = label;
  b.onclick = onClick;
  return b;
}

// ---------- bots ----------

function field(fields, label, input, hint) {
  const l = document.createElement('label');
  l.textContent = label;
  fields.append(l, input);
  if (hint) {
    const h = document.createElement('div');
    h.className = 'hint';
    h.textContent = hint;
    fields.append(h);
  }
}

function textInput(value, placeholder, onInput, onCommit) {
  const i = document.createElement('input');
  i.type = 'text';
  i.value = value || '';
  i.placeholder = placeholder;
  i.spellcheck = false;
  i.addEventListener('input', () => onInput(i.value));
  i.addEventListener('change', () => onCommit(i.value));
  i.addEventListener('keydown', (e) => { if (e.key === 'Enter') i.blur(); });
  return i;
}

function renderEditor(li, p) {
  const fields = $('.fields', li);
  const actions = $('.actions', li);
  fields.replaceChildren();
  actions.replaceChildren();
  const refreshHead = () => {
    $('.name', li).textContent = p.label || 'Untitled';
    $('.detail', li).textContent = detail(p);
    avatarEl($('.avatar', li), p, data.avatars[p.id]);
  };

  field(fields, 'Name', textInput(p.label, 'Tab name', (v) => { p.label = v; refreshHead(); }, () => save()));

  if (p.type === 'web') {
    field(fields, 'Address', textInput(p.url, 'https://', (v) => { p.url = v; refreshHead(); }, (v) => {
      if (v && !/^https?:\/\//i.test(v)) { p.url = `https://${v}`; renderEditor(li, p); refreshHead(); }
      save();
    }), 'The page loads signed in as you, in its own private session.');
    const mode = document.createElement('input');
    mode.type = 'checkbox';
    mode.className = 'switch';
    mode.checked = p.browser === true;
    mode.onchange = () => { p.browser = mode.checked || undefined; refreshHead(); save(); };
    field(fields, 'Real browser', mode,
      'Opens in a Brave, Chromium or Chrome app window parked over the bot bar. Use it when sign-in (like Google) refuses embedded browsers. Avatar and unread badge need Brave or Chromium; positioning needs Hyprland.');
  }
  if (p.type === 'app') {
    field(fields, 'Command', textInput(joinCommand(p.command), 'grok-bot', (v) => { p.command = splitCommand(v); refreshHead(); }, () => save()),
      'Runs when you click Open in the bubble.');
  }
  if (p.type === 'cli') {
    const sel = document.createElement('select');
    for (const [v, l] of AGENTS) sel.add(new Option(l, v, false, v === p.agent));
    sel.onchange = () => { p.agent = sel.value; refreshHead(); save(); };
    field(fields, 'Agent', sel, 'Runs on your own login for that CLI. It can\'t change anything on this computer.');
  }

  const pick = document.createElement('div');
  pick.className = 'avatar-pick';
  // Web bots default to their own avatar from the page; anything can use a custom image.
  const canMirror = p.type === 'web';
  const mode = canMirror ? (p.avatarMode || 'bot') : 'custom';
  let hint;
  if (canMirror) {
    const seg = document.createElement('div');
    seg.className = 'seg';
    for (const [m, label] of [['bot', `${p.label || 'Bot'}'s own`], ['custom', 'Custom image']]) {
      const b = button(label, mode === m ? 'on' : '', async () => {
        p.avatarMode = m;
        await save();
        renderEditor(li, p);
        refreshHead();
      });
      seg.append(b);
    }
    pick.append(seg);
    if (mode === 'bot') {
      hint = data.botAvatars[p.id]
        ? `Mirrors the avatar from ${p.label}, animation included. Change it in ${p.label} and the dot follows.`
        : `Appears once ${p.label} has loaded its avatar. Open its tab once if it hasn't.${p.browser ? ' In real-browser mode this needs Brave or Chromium.' : ''}`;
    }
  }
  if (mode === 'custom') {
    pick.append(button('Choose image…', 'secondary', async () => {
      const file = await api.pickAvatar();
      if (!file) return;
      p.avatar = [file];
      await save();
      renderEditor(li, p);
      refreshHead();
    }));
    if (p.avatar?.length) {
      pick.append(button('Use default', 'secondary', async () => { delete p.avatar; await save(); renderEditor(li, p); refreshHead(); }));
    }
  }
  field(fields, 'Avatar', pick, hint);

  if (p.type === 'web') {
    actions.append(
      button('Open in browser', 'secondary', () => api.openInBrowser(p.id)),
      confirmButton('Clear sign-in data', 'Click again to sign out', () => api.clearData(p.id)),
    );
  }
  if (p.type === 'cli') {
    actions.append(confirmButton('Clear conversation', 'Click again to clear', () => api.clearThread(p.id), 'secondary'));
  }
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  const remove = confirmButton('Remove', 'Click again to remove', async () => {
    cfg.providers = cfg.providers.filter((x) => x !== p);
    open.delete(p.id);
    await save({ rerender: true });
  });
  remove.disabled = cfg.providers.length === 1;
  actions.append(spacer, remove);
}

function renderBots() {
  const tpl = $('#bot-row');
  const enabledCount = cfg.providers.filter((p) => p.enabled !== false).length;
  $('#bots').replaceChildren(...cfg.providers.map((p, i) => {
    const li = tpl.content.firstElementChild.cloneNode(true);
    li.dataset.id = p.id;
    li.classList.toggle('off', p.enabled === false);
    li.classList.toggle('open', open.has(p.id));
    $('.name', li).textContent = p.label || 'Untitled';
    $('.detail', li).textContent = detail(p);
    $('.type', li).textContent = TYPE_LABEL[p.type] || p.type;
    avatarEl($('.avatar', li), p, data.avatars[p.id]);

    const sw = $('.enabled', li);
    sw.checked = p.enabled !== false;
    sw.disabled = sw.checked && enabledCount === 1; // keep at least one tab
    sw.onchange = () => { p.enabled = sw.checked; save({ rerender: true }); };

    const up = $('.up', li);
    const down = $('.down', li);
    up.disabled = i === 0;
    down.disabled = i === cfg.providers.length - 1;
    const move = (d) => {
      const [x] = cfg.providers.splice(i, 1);
      cfg.providers.splice(i + d, 0, x);
      save({ rerender: true });
    };
    up.onclick = () => move(-1);
    down.onclick = () => move(1);

    const editor = $('.editor', li);
    const toggle = () => {
      const show = editor.hidden;
      editor.hidden = !show;
      li.classList.toggle('open', show);
      if (show) { open.add(p.id); renderEditor(li, p); } else open.delete(p.id);
    };
    $('.expand', li).onclick = toggle;
    $('.meta', li).onclick = toggle;
    $('.meta', li).style.cursor = 'pointer';
    if (open.has(p.id)) { editor.hidden = false; renderEditor(li, p); }
    return li;
  }));
}

function refreshAvatars() {
  for (const li of document.querySelectorAll('.bot')) {
    const p = cfg.providers.find((x) => x.id === li.dataset.id);
    if (p) avatarEl($('.avatar', li), p, data.avatars[p.id]);
  }
}

// ---------- add sheet ----------

function sameBot(a, b) {
  if (a.type !== b.type) return false;
  if (a.type === 'web') return (a.url || '').replace(/\/$/, '') === (b.url || '').replace(/\/$/, '');
  if (a.type === 'cli') return a.agent === b.agent;
  return joinCommand(a.command) === joinCommand(b.command);
}

function openSheet() {
  const groups = new Map();
  for (const pr of data.presets) {
    if (!groups.has(pr.group)) groups.set(pr.group, []);
    groups.get(pr.group).push(pr);
  }
  $('#presets').replaceChildren(...[...groups].map(([name, items]) => {
    const g = document.createElement('div');
    g.className = 'preset-group';
    const h = document.createElement('h2');
    h.textContent = name;
    const grid = document.createElement('div');
    grid.className = 'preset-grid';
    for (const pr of items) {
      const added = !pr.custom && cfg.providers.some((p) => sameBot(p, pr));
      const b = document.createElement('button');
      b.className = `preset${added ? ' added' : ''}`;
      const av = document.createElement('span');
      av.className = 'avatar';
      avatarEl(av, { id: pr.label, label: pr.label }, '');
      const txt = document.createElement('span');
      txt.innerHTML = '<b></b><small></small>';
      txt.querySelector('b').textContent = pr.label;
      txt.querySelector('small').textContent = added ? 'Already added' : pr.note;
      b.append(av, txt);
      b.disabled = added;
      b.onclick = () => addPreset(pr);
      grid.append(b);
    }
    g.append(h, grid);
    return g;
  }));
  $('#sheet').hidden = false;
}

async function addPreset(pr) {
  const { group, note, custom, ...rest } = pr;
  const label = custom ? (pr.type === 'web' ? 'New web bot' : 'New app') : pr.label;
  const p = { ...structuredClone(rest), id: uniqueId(label), label };
  cfg.providers.push(p);
  open.add(p.id);
  $('#sheet').hidden = true;
  await save({ rerender: true });
  const li = document.querySelector(`.bot[data-id="${p.id}"]`);
  li?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (custom) $('.fields input', li)?.select();
}

// ---------- general + about ----------

function renderGeneral() {
  const sel = $('#default-bot');
  sel.replaceChildren(new Option('Last used', 'last'),
    ...cfg.providers.filter((p) => p.enabled !== false).map((p) => new Option(p.label || 'Untitled', p.id)));
  sel.value = cfg.providers.some((p) => p.id === cfg.settings.defaultBot && p.enabled !== false) ? cfg.settings.defaultBot : 'last';
  $('#show-tabs').checked = cfg.settings.showTabs !== false;
  $('#autostart').checked = data.autostart;
  $('#keep-loaded').checked = cfg.settings.keepLoaded;
  $('#locked').checked = data.locked;
  $('#version').textContent = `v${data.version}`;
  $('#config-path').textContent = data.paths.config;
  $('#data-path').textContent = data.paths.data;
}

$('#autostart').onchange = async (e) => { e.target.checked = await api.setAutostart(e.target.checked); };
$('#default-bot').onchange = (e) => { cfg.settings.defaultBot = e.target.value; save(); };
$('#show-tabs').onchange = (e) => { cfg.settings.showTabs = e.target.checked; save(); };
$('#keep-loaded').onchange = (e) => { cfg.settings.keepLoaded = e.target.checked; save(); };
$('#locked').onchange = (e) => api.setLocked(e.target.checked);
$('#reset-pos').onclick = () => api.resetPosition();
for (const b of document.querySelectorAll('[data-open]')) b.onclick = () => api.openPath(b.dataset.open);
$('#support').onclick = () => api.support();

// ---------- shell ----------

for (const b of document.querySelectorAll('#sidebar [data-page]')) {
  b.onclick = () => {
    for (const x of document.querySelectorAll('#sidebar [data-page]')) x.classList.toggle('on', x === b);
    for (const pg of document.querySelectorAll('.page')) pg.hidden = pg.id !== `page-${b.dataset.page}`;
  };
}
$('#add').onclick = openSheet;
$('#sheet-close').onclick = () => { $('#sheet').hidden = true; };
$('#sheet').onclick = (e) => { if (e.target.id === 'sheet') $('#sheet').hidden = true; };
$('#close').onclick = () => api.close();
$('#quit').onclick = () => api.quit();
window.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (!$('#sheet').hidden) $('#sheet').hidden = true;
  else api.close();
});

async function load() {
  data = await api.get();
  cfg = structuredClone(data.config);
  renderBots();
  renderGeneral();
}

api.onAvatars(async () => { data = await api.get(); refreshAvatars(); });

// Pick up changes made from the dot (lock toggle) when coming back to this window.
window.addEventListener('focus', async () => {
  data = await api.get();
  renderGeneral();
});

load();
