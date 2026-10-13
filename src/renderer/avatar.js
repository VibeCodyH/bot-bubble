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
  if (av.kind === 'video') {
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
