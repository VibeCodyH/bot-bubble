const $ = (id) => document.getElementById(id);
const api = window.dot;
const IMAGE = /\.(png|jpe?g|gif|webp)$/i;
let state = null;
let pending = []; // attachment paths for the next cli message
let shownMessages = '';

function render(s) {
  state = s;
  const { layout } = s;
  document.body.className = [`h-${s.anchor.h}`, `v-${s.anchor.v}`, `t-${s.type}`,
    layout.compact ? 'compact' : '', layout.tabs ? 'tabs' : ''].join(' ');

  const inset = (layout.dot.size - 56) / 2;
  Object.assign($('dot').style, { left: `${layout.dot.x + inset}px`, top: `${layout.dot.y + inset}px` });
  $('dot').title = s.label;
  const av = s.avatar;
  $('glyph').style.display = renderAvatar($('dot'), av) ? 'none' : '';
  $('badge').hidden = !s.unread;
  $('locked').hidden = !s.locked;

  const box = (el, r) => {
    el.hidden = !r;
    if (r) Object.assign(el.style, { left: `${r.x}px`, top: `${r.y}px`, width: `${r.width}px`, height: `${r.height}px` });
  };
  box($('card'), s.expanded && layout.card);
  box($('pill'), s.expanded && layout.pill);
  if (!s.expanded) return;

  if (layout.pill) {
    renderTabs(s);
    $('reload').hidden = s.type !== 'web' || layout.compact;
  }
  if (s.type === 'web') $('web-hint').textContent = s.hint;
  if (s.type === 'app') {
    $('app-avatar').hidden = !av || av.kind !== 'img';
    if (av?.kind === 'img') $('app-avatar').src = av.url;
    $('app-name').textContent = s.label;
    $('app-name2').textContent = s.label;
  }
  if (s.type === 'cli') renderChat(s);
}

function renderTabs(s) {
  $('tabs').replaceChildren(...s.providers.map((p) => {
    const b = document.createElement('button');
    b.textContent = p.label;
    b.classList.toggle('on', p.id === s.provider);
    b.classList.toggle('unread', Boolean(s.unreadBy[p.id]));
    b.onclick = () => api.setProvider(p.id);
    b.title = p.label;
    return b;
  }));
  $('tabs').querySelector('.on')?.scrollIntoView({ inline: 'nearest', block: 'nearest' });
}

// ---------- cli chat ----------

const esc = (t) => t.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const inline = (t) => t
  .replace(/`([^`]+)`/g, '<code>$1</code>')
  .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
  .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '$1 ($2)');

// Small, safe markdown: everything is escaped first, then a few constructs are re-allowed.
function markdown(text) {
  const out = [];
  esc(text).split(/```[^\n]*\n?([\s\S]*?)```/g).forEach((chunk, i) => {
    if (i % 2) { out.push(`<pre><code>${chunk}</code></pre>`); return; }
    for (const block of chunk.split(/\n{2,}/)) {
      const ls = block.split('\n').filter((l) => l.trim());
      if (!ls.length) continue;
      if (ls.every((l) => /^\s*([-*]|\d+\.)\s/.test(l))) {
        out.push(`<ul>${ls.map((l) => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s/, ''))}</li>`).join('')}</ul>`);
      } else {
        out.push(`<p>${ls.map(inline).join('<br>')}</p>`);
      }
    }
  });
  return out.join('');
}

function chip(file, onRemove) {
  const c = document.createElement('span');
  c.className = 'chip';
  if (IMAGE.test(file)) {
    const img = document.createElement('img');
    // Windows paths too: C:\a\b.png -> file:///C:/a/b.png
    img.src = `file://${file.startsWith('/') ? '' : '/'}${encodeURI(file.replace(/\\/g, '/')).replace(/[?#]/g, encodeURIComponent)}`;
    c.append(img);
  }
  c.append(file.split('/').pop());
  if (onRemove) {
    const x = document.createElement('button');
    x.type = 'button';
    x.textContent = '×';
    x.onclick = onRemove;
    c.append(x);
  }
  return c;
}

function renderChat(s) {
  $('chat-title').textContent = s.label;
  $('new-chat').disabled = s.busy;
  $('input').placeholder = `Message ${s.label}`;
  $('send').disabled = s.busy || (s.busyAny && !s.busy);
  const key = `${s.provider}:${s.messages.length}:${s.busy}`;
  if (key === shownMessages) return;
  shownMessages = key;

  const items = s.messages.map((m) => {
    const li = document.createElement('li');
    li.className = m.role;
    if (m.role === 'assistant') li.innerHTML = markdown(m.text);
    else li.textContent = m.text;
    if (m.attachments?.length) {
      const chips = document.createElement('div');
      chips.className = 'chips';
      chips.append(...m.attachments.map((f) => chip(f)));
      li.append(chips);
    }
    return li;
  });
  if (s.busy) {
    const li = document.createElement('li');
    li.className = 'assistant typing';
    li.innerHTML = '<span></span><span></span><span></span><a>stop</a>';
    li.querySelector('a').onclick = () => api.cancel();
    items.push(li);
  }
  if (!items.length) {
    const li = document.createElement('li');
    li.className = 'system';
    li.textContent = `New thread with ${s.label}. It can't change anything on this computer.`;
    items.push(li);
  }
  $('messages').replaceChildren(...items);
  $('messages').scrollTop = $('messages').scrollHeight;
}

function renderPending() {
  $('pending').replaceChildren(...pending.map((f, i) => chip(f, () => { pending.splice(i, 1); renderPending(); })));
}

function addFiles(paths) {
  for (const p of paths) if (p && !pending.includes(p)) pending.push(p);
  renderPending();
}

function grow() {
  const t = $('input');
  t.style.height = 'auto';
  t.style.height = `${Math.min(t.scrollHeight, 108)}px`;
}

$('composer').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = $('input').value.trim();
  if (state.busyAny || !(text || pending.length)) return;
  api.send(text, pending);
  $('input').value = '';
  pending = [];
  renderPending();
  grow();
});
$('input').addEventListener('input', grow);
$('input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    $('composer').requestSubmit();
  }
});
$('attach').onclick = async () => addFiles(await api.pickFiles());
$('chat').addEventListener('dragover', (e) => e.preventDefault());
$('chat').addEventListener('drop', (e) => {
  e.preventDefault();
  addFiles([...e.dataTransfer.files].map((f) => api.pathForFile(f)));
});
$('input').addEventListener('paste', (e) => {
  const files = [...e.clipboardData.files].map((f) => api.pathForFile(f)).filter(Boolean);
  if (files.length) { e.preventDefault(); addFiles(files); }
});

// ---------- dot: click toggles the bubble; press-and-move drags (unless locked) ----------

let press = null;
$('dot').addEventListener('pointerdown', (e) => {
  if (e.button !== 0) return;
  $('dot').setPointerCapture(e.pointerId);
  press = { x: e.clientX, y: e.clientY, dragging: false };
});
$('dot').addEventListener('pointermove', (e) => {
  if (!press || press.dragging || state.locked) return;
  if (Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) {
    press.dragging = true;
    api.dragStart();
  }
});
$('dot').addEventListener('pointerup', () => {
  if (!press) return;
  if (press.dragging) api.dragEnd();
  else api.toggle();
  press = null;
});
// The button-up can go missing (capture lost, pointer cancelled); a drag must still end.
// A plain click is left alone: capture can drop before its button-up (focus moving
// from a bot's page to the dot), and clearing it there would swallow the click.
const endPress = () => {
  if (!press?.dragging) return;
  api.dragEnd();
  press = null;
};
$('dot').addEventListener('pointercancel', endPress);
$('dot').addEventListener('lostpointercapture', endPress);
$('dot').addEventListener('contextmenu', (e) => {
  e.preventDefault();
  api.menu();
});

// ---------- header ----------

$('reload').onclick = () => api.reload();
$('new-chat').onclick = () => { api.newThread(); $('input').focus(); };
$('settings').onclick = () => api.openSettings();
$('close').onclick = () => api.collapse();
$('open-app').onclick = () => api.openApp();
window.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.collapse(); });

api.getState().then(render);
api.onState(render);
api.onLook(({ dx, dy }) => avatarLook(dx, dy));
