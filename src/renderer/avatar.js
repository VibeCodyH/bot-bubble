// Draws a bot avatar into a round container: an image, a looping video, a CSS
// sprite replayed from the keyframes captured on the bot's own page, or a "pet"
// sprite sheet animated here. Shared by the dot and the Settings window.
// Returns false when there's nothing to draw.

// Pets: the 8x11 sprite-sheet layout OpenAI uses for Dots and Codex mascots.
// Row 0 is idle (frame 1 is the blink), rows 9 then 10 are 16 head turns going
// clockwise from facing up, 22.5 degrees apart. The page steps these frames with
// its own script, so there's nothing to copy; we animate the sheet ourselves.
const pets = new Set();
const PET = { cols: 8, rows: 11, blink: [1, 0], turnRows: [9, 10], restMs: 2500, near: 40 };

function pet(el, url, m) {
  const frame = document.createElement('div');
  const cellRatio = 0.923; // 192x208 cells
  Object.assign(frame.style, {
    position: 'absolute', left: '50%', top: '56%', height: '100%', aspectRatio: String(cellRatio),
    transform: 'translate(-50%, -50%) scale(1.4)',
    backgroundImage: `url("${url}")`, backgroundSize: `${PET.cols * 100}% ${PET.rows * 100}%`, backgroundRepeat: 'no-repeat',
  });
  el.append(frame);
  const show = (c, r) => { frame.style.backgroundPosition = `${(c / (PET.cols - 1)) * 100}% ${(r / (PET.rows - 1)) * 100}%`; };
  let looking = 0;
  let blinkTimer = null;
  const idle = () => {
    show(0, 0);
    blinkTimer = setTimeout(() => {
      if (!el.isConnected) return;
      if (Date.now() - looking > PET.restMs) { show(PET.blink[0], PET.blink[1]); setTimeout(() => { if (Date.now() - looking > PET.restMs) show(0, 0); }, 140); }
      idle();
    }, 2500 + Math.random() * 3500);
  };
  const entry = {
    el,
    look(dx, dy) {
      looking = Date.now();
      if (Math.hypot(dx, dy) < PET.near) { show(0, 0); return; }
      const deg = (Math.atan2(dx, -dy) * 180 / Math.PI + 360) % 360;
      const i = Math.round(deg / 22.5) % 16;
      show(i % 8, PET.turnRows[Math.floor(i / 8)]);
      clearTimeout(entry.rest);
      entry.rest = setTimeout(() => { if (Date.now() - looking >= PET.restMs) show(0, 0); }, PET.restMs);
    },
    stop() { clearTimeout(blinkTimer); clearTimeout(entry.rest); },
  };
  pets.add(entry);
  idle();
}

// Grok Bot: its app draws the mark in code and has no page to mirror, so this is
// our own take on it. A lit sphere whose eyes turn toward the cursor and settle
// back to rest. Once the cursor has been still a while he does one of the app's
// moves: a glance around, a spin, a squinting scan, or shrinking to a small dot
// with dots orbiting him or rings pinging out.
const GROK = { restMs: 2500, x: 10, y: 8, idleMin: 6000, idleMax: 14000 };
let grokIds = 0;

function grok(el) {
  const id = `grok-${++grokIds}`;
  const eye = (cx, cy, k) => `<g transform="rotate(-38 ${cx} ${cy})"><rect class="lid" x="${cx - 6.5 * k}" y="${cy - 15.5 * k}" width="${13 * k}" height="${31 * k}" rx="${6.5 * k}"/></g>`;
  el.innerHTML = `<svg viewBox="0 0 100 100" width="100%" height="100%">
    <defs>
      <radialGradient id="${id}" gradientUnits="userSpaceOnUse" cx="60" cy="50" r="72">
        <stop offset="0" stop-color="#fff"/><stop offset="0.45" stop-color="#dedede"/><stop offset="1" stop-color="#8a8a8a"/>
      </radialGradient>
      <clipPath id="${id}-clip"><circle cx="48" cy="73" r="55"/></clipPath>
    </defs>
    <rect width="100" height="100" fill="#1e1e1e"/>
    <g class="face">
      <circle class="body" cx="48" cy="73" r="55" fill="url(#${id})"/>
      <g clip-path="url(#${id}-clip)"><g class="eyes" fill="#111">${eye(45, 60, 1)}${eye(74, 48, 0.85)}</g></g>
    </g>
    <g class="fx" fill="#e6e6e6"></g>
  </svg>`;
  const face = el.querySelector('.face');
  const body = el.querySelector('.body');
  const eyes = el.querySelector('.eyes');
  const fx = el.querySelector('.fx');
  const lids = el.querySelectorAll('.lid');
  for (const n of [body, eyes, ...lids]) Object.assign(n.style, { transformBox: 'fill-box', transformOrigin: 'center', transition: 'transform 200ms ease-out' });
  // Shrinking scales the face about the point that lands the sphere in the middle.
  Object.assign(face.style, { transformBox: 'view-box', transformOrigin: '51px 39px' });
  Object.assign(fx.style, { transformBox: 'view-box', transformOrigin: '50px 50px' });

  const pose = (nx, ny) => {
    body.style.transform = `translate(${nx * 2}px, ${-ny * 2}px)`;
    eyes.style.transform = `translate(${nx * GROK.x}px, ${-ny * GROK.y}px) scale(${1 - 0.12 * Math.abs(nx)}, ${1 - 0.08 * Math.abs(ny)})`;
  };
  const squint = (on) => { for (const l of lids) l.style.transform = on ? 'scaleY(0.4)' : ''; };
  const timers = new Set();
  const wait = (ms) => new Promise((done) => { const t = setTimeout(() => { timers.delete(t); done(); }, ms); timers.add(t); });
  const play = (node, frames, ms, opts = {}) => node.animate(frames, { duration: ms, easing: 'ease-in-out', ...opts }).finished.catch(() => {});
  const dot = (attrs) => {
    const n = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
    fx.append(n);
    return n;
  };
  const shrink = (ms) => play(face, [
    { transform: 'scale(1)' }, { transform: 'scale(0.32)', offset: 0.14 },
    { transform: 'scale(0.32)', offset: 0.86 }, { transform: 'scale(1)' },
  ], ms);

  const moves = {
    async glance() {
      pose(-1, 0); await wait(650);
      pose(1, 0); await wait(650);
      pose(0, 0);
    },
    async squint() {
      squint(true); await wait(200);
      for (const [x, y] of [[-1, 0.4], [1, 0.4], [1, -0.6], [-1, -0.6]]) { pose(x, y); await wait(480); }
      pose(0, 0); await wait(250);
      squint(false);
    },
    async spin() {
      // One eased turn about the vertical axis: the eyes slide round the sphere,
      // narrowing toward its edge, and are hidden while they're round the back.
      const rest = 0.3; // the eyes sit a little right of the sphere's front
      const frames = [];
      for (let i = 0; i <= 48; i++) {
        const a = rest + Math.PI * (1 - Math.cos(Math.PI * i / 48));
        const c = Math.cos(a);
        frames.push({ transform: `translateX(${42 * (Math.sin(a) - Math.sin(rest))}px) scaleX(${Math.max(0.05, c / Math.cos(rest))})`, opacity: c > 0 ? 1 : 0 });
      }
      await play(eyes, frames, 1300, { easing: 'linear' });
    },
    async orbit() {
      for (let i = 0; i < 3; i++) {
        const a = i * 2 * Math.PI / 3;
        dot({ cx: 50 + 27 * Math.cos(a), cy: 50 + 27 * Math.sin(a), r: 3.5 });
      }
      await Promise.all([shrink(3200), play(fx, [
        { transform: 'rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.18 },
        { opacity: 1, offset: 0.8 }, { transform: 'rotate(720deg)', opacity: 0 },
      ], 3200, { easing: 'linear' })]);
      fx.replaceChildren();
    },
    async ping() {
      const rings = [0, 1].map(() => dot({ cx: 50, cy: 50, r: 44, fill: 'none', stroke: '#e6e6e6', 'stroke-width': 2.5 }));
      for (const r of rings) Object.assign(r.style, { transformBox: 'view-box', transformOrigin: '50px 50px' });
      await Promise.all([shrink(3000), ...rings.map((r, i) => play(r, [
        { transform: 'scale(0.35)', opacity: 0 }, { opacity: 0.9, offset: 0.08 }, { transform: 'scale(1)', opacity: 0 },
      ], 1100, { delay: 500 + i * 800, easing: 'ease-out', fill: 'both' }))]);
      fx.replaceChildren();
    },
  };

  let busy = false;
  let last = [0, 0];
  let lastAt = 0;
  let prev = '';
  const aim = () => {
    pose(...last);
    clearTimeout(entry.rest);
    entry.rest = setTimeout(() => pose(0, 0), GROK.restMs);
  };
  const next = () => {
    clearTimeout(entry.idle);
    entry.idle = setTimeout(perform, GROK.idleMin + Math.random() * (GROK.idleMax - GROK.idleMin));
  };
  async function perform() {
    if (busy || !el.isConnected) return;
    const names = Object.keys(moves).filter((n) => n !== prev);
    prev = names[Math.floor(Math.random() * names.length)];
    busy = true;
    pose(0, 0);
    await moves[prev]();
    busy = false;
    // Pick the cursor back up if it moved while he was busy.
    if (Date.now() - lastAt < GROK.restMs) aim();
    next();
  }

  const entry = {
    el,
    look(dx, dy) {
      // Same falloff as the app: the offset over twice the mark's width, clamped,
      // so the gaze saturates instead of chasing the cursor across the screen.
      const w = 2 * (el.clientWidth || 56);
      const clamp = (v) => Math.max(-1, Math.min(1, v));
      last = [clamp(dx / w), clamp(-dy / w)];
      lastAt = Date.now();
      if (!busy) aim();
      next();
    },
    stop() {
      clearTimeout(entry.rest);
      clearTimeout(entry.idle);
      for (const t of timers) clearTimeout(t);
    },
  };
  pets.add(entry);
  next();
}

// Called with the cursor's offset from the dot's center whenever it moves.
// eslint-disable-next-line no-unused-vars
function avatarLook(dx, dy) {
  for (const p of pets) {
    if (!p.el.isConnected) { p.stop(); pets.delete(p); continue; }
    p.look(dx, dy);
  }
}
// eslint-disable-next-line no-unused-vars
function renderAvatar(box, av) {
  const key = av ? `${av.kind}|${av.url}` : '';
  if (box.dataset.avatar === key) return Boolean(av);
  box.dataset.avatar = key;
  box.querySelector('.av')?.remove();
  for (const p of pets) if (!p.el.isConnected) { p.stop(); pets.delete(p); }
  if (!av) return false;

  let el;
  if (av.kind === 'grok') {
    el = document.createElement('div');
    grok(el);
  } else if (av.kind === 'video') {
    el = Object.assign(document.createElement('video'), { muted: true, loop: true, autoplay: true, playsInline: true, src: av.url });
  } else if (av.kind === 'sprite' && av.meta.grid && av.meta.grid.cols === PET.cols && av.meta.grid.rows === PET.rows) {
    el = document.createElement('div');
    pet(el, av.url, av.meta);
  } else if (av.kind === 'sprite') {
    // The sprite keeps its native frame size; a wrapper scales it to fit the circle,
    // so keyframes that animate transform on the frame itself don't fight the fit.
    const m = av.meta;
    el = document.createElement('div');
    const wrap = document.createElement('div');
    const frame = document.createElement('div');
    Object.assign(wrap.style, { position: 'absolute', left: '50%', top: '50%', width: `${m.width}px`, height: `${m.height}px` });
    Object.assign(frame.style, {
      width: '100%',
      height: '100%',
      backgroundImage: `url("${av.url}")`,
      backgroundSize: m.backgroundSize,
      backgroundRepeat: m.backgroundRepeat,
      backgroundPosition: m.backgroundPosition,
    });
    wrap.append(frame);
    el.append(wrap);
    requestAnimationFrame(() => {
      const size = box.clientWidth || 56;
      wrap.style.transform = `translate(-50%, -50%) scale(${size / Math.max(m.width, m.height)})`;
    });
    for (const a of m.animations) {
      const t = { ...a.timing, iterations: a.timing.iterations === 'Infinity' ? Infinity : a.timing.iterations };
      try { frame.animate(a.keyframes, t); } catch { /* a property this page can't animate */ }
    }
  } else {
    el = Object.assign(document.createElement('img'), { src: av.url, alt: '' });
  }
  el.className = 'av';
  box.prepend(el);
  return true;
}
