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
// our own take on it, in the shape and color of the agent you last opened there
// (main.js reads those). The eyes turn toward the cursor and settle back to rest. Once the cursor has been still a while he does one of the app's
// moves: a glance around, a spin, a squinting scan, or shrinking to a small dot
// with dots orbiting him or rings pinging out.
const GROK = { restMs: 2500, x: 7, y: 6, idleMin: 6000, idleMax: 14000 };
let grokIds = 0;

// Body colors, as Grok Bot paints them on a dark background (color -> shade).
const GROK_COLORS = {
  black: ['#FFFFFF', '#C2C2C2'], brown: ['#855C36', '#604227'], red: ['#E02135', '#A21826'],
  orange: ['#FF6700', '#C24E00'], yellow: ['#FF9800', '#C27400'], green: ['#009957', '#008048'],
  cyan: ['#00A592', '#007769'], blue: ['#0E74E0', '#0C64C1'], violet: ['#804EE0', '#5C39A1'],
  magenta: ['#E02A88', '#A21E62'], gray: ['#777777', '#555555'],
};

// Body shapes in a 100x100 box, centered near (50, 52). A stroke-width on a
// shape rounds its corners (the stroke is painted in the body color).
const poly = (pts) => `<polygon points="${pts.map((q) => q.join(',')).join(' ')}" stroke-width="10" stroke-linejoin="round"/>`;
const ring = (n, r1, r2, turn = -90) => Array.from({ length: n * (r2 ? 2 : 1) }, (_, i) => {
  const a = (turn + i * 360 / (n * (r2 ? 2 : 1))) * Math.PI / 180;
  const r = r2 && i % 2 ? r2 : r1;
  return [+(50 + r * Math.cos(a)).toFixed(1), +(52 + r * Math.sin(a)).toFixed(1)];
});
const GROK_SHAPES = {
  blob: '<circle cx="50" cy="52" r="40"/>',
  pebble: '<ellipse cx="50" cy="54" rx="38" ry="31" transform="rotate(-8 50 54)"/>',
  bean: '<path d="M34 20C58 12 84 28 82 54C80 78 58 90 38 84C20 78 14 60 26 52C34 47 36 40 28 32C24 26 28 21 34 20Z"/>',
  egg: '<path d="M50 14C70 14 82 46 82 62C82 80 68 90 50 90C32 90 18 80 18 62C18 46 30 14 50 14Z"/>',
  squircle: '<rect x="16" y="18" width="68" height="68" rx="26"/>',
  tablet: '<rect x="13" y="24" width="74" height="58" rx="26"/>',
  capsule: '<rect x="27" y="12" width="46" height="80" rx="23"/>',
  cylinder: '<path d="M22 28A28 10 0 0 1 78 28V78A28 10 0 0 1 22 78Z"/>',
  hex: poly(ring(6, 34)),
  gem: poly([[27, 33], [40, 21], [60, 21], [73, 33], [50, 83]]),
  crystal: poly([[50, 13], [69, 33], [69, 71], [50, 91], [31, 71], [31, 33]]),
  wedge: '<polygon points="50,22 82,80 18,80" stroke-width="16" stroke-linejoin="round"/>',
  shield: '<path d="M50 15L79 25C79 56 70 76 50 88C30 76 21 56 21 25Z" stroke-width="8" stroke-linejoin="round"/>',
  dome: '<path d="M17 80V56A33 33 0 0 1 83 56V80Z" stroke-width="8" stroke-linejoin="round"/>',
  arch: '<path d="M17 84V50A33 33 0 0 1 83 50V84H63V56A13 13 0 0 0 37 56V84Z" stroke-width="8" stroke-linejoin="round"/>',
  cloud: '<circle cx="33" cy="58" r="19"/><circle cx="53" cy="44" r="24"/><circle cx="70" cy="60" r="18"/><rect x="30" y="56" width="42" height="22" rx="11"/>',
  teardrop: '<path d="M50 12C62 32 80 46 80 62A30 30 0 0 1 20 62C20 46 38 32 50 12Z"/>',
  leaf: '<path d="M50 10C78 30 82 64 50 92C18 64 22 30 50 10Z" transform="rotate(28 50 51)"/>',
  square: '<rect x="18" y="20" width="64" height="64" rx="8"/>',
  sparkle: '<path d="M50 10Q58 44 90 52Q58 60 50 94Q42 60 10 52Q42 44 50 10Z" stroke-width="6" stroke-linejoin="round"/>',
  clover: '<circle cx="35" cy="37" r="17"/><circle cx="65" cy="37" r="17"/><circle cx="35" cy="67" r="17"/><circle cx="65" cy="67" r="17"/><circle cx="50" cy="52" r="16"/>',
  flower: `${ring(6, 21).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="15"/>`).join('')}<circle cx="50" cy="52" r="22"/>`,
  heart: '<path d="M50 86C18 64 12 44 22 30C32 17 46 22 50 32C54 22 68 17 78 30C88 44 82 64 50 86Z" stroke-width="8" stroke-linejoin="round"/>',
  house: poly([[50, 18], [83, 45], [83, 84], [17, 84], [17, 45]]),
  star: '<polygon points="' + ring(6, 40, 25).map((q) => q.join(',')).join(' ') + '" stroke-width="8" stroke-linejoin="round"/>',
};
// The arch's eyes sit above its opening.
const GROK_EYE_LIFT = { arch: 8, horseshoe: 8 };
// Older or internal names the app also uses.
Object.assign(GROK_SHAPES, {
  sphere: GROK_SHAPES.blob, heartChubby: GROK_SHAPES.heart, starFlower: GROK_SHAPES.flower,
  star6: GROK_SHAPES.star, horseshoe: GROK_SHAPES.arch, hexagon: GROK_SHAPES.hex, spark: GROK_SHAPES.sparkle,
});

function grok(el, look) {
  const id = `grok-${++grokIds}`;
  const shape = GROK_SHAPES[look.shape] || GROK_SHAPES.blob;
  const [light, shade] = GROK_COLORS[look.color] || GROK_COLORS.black;
  const lift = GROK_EYE_LIFT[look.shape] || 0;
  const eye = (cx, cy, k) => `<g transform="rotate(-25 ${cx} ${cy})"><rect class="lid" x="${cx - 3.6 * k}" y="${cy - 8 * k}" width="${7.2 * k}" height="${16 * k}" rx="${3.6 * k}"/></g>`;
  el.innerHTML = `<svg viewBox="0 0 100 100" width="100%" height="100%">
    <defs>
      <linearGradient id="${id}-fill" gradientUnits="userSpaceOnUse" x1="18" y1="16" x2="82" y2="90">
        <stop offset="0.4" stop-color="${light}"/><stop offset="1" stop-color="${shade}"/>
      </linearGradient>
      <radialGradient id="${id}-shine" gradientUnits="userSpaceOnUse" cx="42" cy="36" r="42">
        <stop offset="0" stop-color="#fff" stop-opacity="0.5"/><stop offset="1" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
      <g id="${id}-shape" transform="translate(50 52) scale(0.88) translate(-50 -52)">${shape}</g>
      <mask id="${id}-mask"><use href="#${id}-shape" fill="#fff" stroke="#fff"/></mask>
    </defs>
    <rect width="100" height="100" fill="#1e1e1e"/>
    <g class="face">
      <g class="body">
        <use href="#${id}-shape" fill="url(#${id}-fill)" stroke="url(#${id}-fill)" stroke-width="0"/>
        <rect width="100" height="100" fill="url(#${id}-shine)" mask="url(#${id}-mask)"/>
      </g>
      <g mask="url(#${id}-mask)"><g class="eyes" fill="#111">${eye(46, 45 - lift, 1)}${eye(59, 41 - lift, 0.9)}</g></g>
    </g>
    <g class="fx" fill="#e6e6e6"></g>
  </svg>`;
  const face = el.querySelector('.face');
  const body = el.querySelector('.body');
  const eyes = el.querySelector('.eyes');
  const fx = el.querySelector('.fx');
  const lids = el.querySelectorAll('.lid');
  for (const n of [body, eyes, ...lids]) Object.assign(n.style, { transformBox: 'fill-box', transformOrigin: 'center', transition: 'transform 200ms ease-out' });
  Object.assign(face.style, { transformBox: 'view-box', transformOrigin: '50px 52px' });
  Object.assign(fx.style, { transformBox: 'view-box', transformOrigin: '50px 52px' });

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
    { transform: 'scale(1)' }, { transform: 'scale(0.4)', offset: 0.14 },
    { transform: 'scale(0.4)', offset: 0.86 }, { transform: 'scale(1)' },
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
      const rest = 0.2; // the eyes sit a little right of the body's front
      const frames = [];
      for (let i = 0; i <= 48; i++) {
        const a = rest + Math.PI * (1 - Math.cos(Math.PI * i / 48));
        const c = Math.cos(a);
        frames.push({ transform: `translateX(${30 * (Math.sin(a) - Math.sin(rest))}px) scaleX(${Math.max(0.05, c / Math.cos(rest))})`, opacity: c > 0 ? 1 : 0 });
      }
      await play(eyes, frames, 1300, { easing: 'linear' });
    },
    async orbit() {
      for (let i = 0; i < 3; i++) {
        const a = i * 2 * Math.PI / 3;
        dot({ cx: 50 + 27 * Math.cos(a), cy: 52 + 27 * Math.sin(a), r: 3.5 });
      }
      await Promise.all([shrink(3200), play(fx, [
        { transform: 'rotate(0deg)', opacity: 0 }, { opacity: 1, offset: 0.18 },
        { opacity: 1, offset: 0.8 }, { transform: 'rotate(720deg)', opacity: 0 },
      ], 3200, { easing: 'linear' })]);
      fx.replaceChildren();
    },
    async ping() {
      const rings = [0, 1].map(() => dot({ cx: 50, cy: 52, r: 44, fill: 'none', stroke: '#e6e6e6', 'stroke-width': 2.5 }));
      for (const r of rings) Object.assign(r.style, { transformBox: 'view-box', transformOrigin: '50px 52px' });
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
  const key = av ? `${av.kind}|${av.url}|${av.shape}|${av.color}` : '';
  if (box.dataset.avatar === key) return Boolean(av);
  box.dataset.avatar = key;
  box.querySelector('.av')?.remove();
  for (const p of pets) if (!p.el.isConnected) { p.stop(); pets.delete(p); }
  if (!av) return false;

  let el;
  if (av.kind === 'grok') {
    el = document.createElement('div');
    grok(el, av);
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
