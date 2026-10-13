// Runs inside a bot's web page, both in Bot Bubble's own views (bundled into the
// preload) and in real-browser mode (bundled into a tiny extension). Plain browser
// JavaScript, no imports: main.js concatenates it with the matching glue file.
//
// It reports two things, with no site-specific selectors:
//   report('activity')        visible text grew past anything the page has shown,
//                             settled, and stayed (a reply streamed in). Main
//                             ignores it while the user is looking at that bot.
//   report('avatar', media)   the bot's own avatar, sent as bytes; re-sent only
//                             when it changes. Either a round <video>/<img>, or a
//                             sprite: an avatar-sized element painted from a sprite
//                             sheet. Sent with its grid (from background-size, e.g.
//                             800% 1100% = 8x11 frames) and any CSS animation
//                             keyframes, so the dot can animate its own copy.
// eslint-disable-next-line no-unused-vars
function botBubbleWatch(report) {
  const GROWTH = 40;     // chars of new text that count as a reply, not a timestamp tick
  const SETTLE = 1500;   // ms of quiet before measuring
  const WARMUP = 10000;  // ms after load before watching, so the page's own first render doesn't count
  const CONFIRM = 4000;  // a reply is still there this much later; banners and toasts usually aren't
  const RESET = 60000;   // text that stays shorter this long is a different thread
  const MAX_AVATAR = 4 * 1024 * 1024;

  let baseline = null; // text length at the last report (or first look); shorter text doesn't move it
  let lowSince = 0;
  let timer = null;
  let confirmTimer = null;
  let warm = false;
  let avatarSrc = '';

  const textLength = () => (document.body ? document.body.innerText.length : 0);

  function measure() {
    timer = null;
    const len = textLength();
    // A page that was still blank when warm-up ended is rendering for the first time, not replying.
    if (baseline === null || baseline < GROWTH) { baseline = len; return; }
    const grown = len - baseline >= GROWTH;
    // Growth has to hold for the whole CONFIRM window: a rotating banner or a toast drops back first.
    if (!grown) { clearTimeout(confirmTimer); confirmTimer = null; }
    if (len < baseline) {
      lowSince ||= Date.now();
      if (Date.now() - lowSince >= RESET) { baseline = len; lowSince = 0; }
      return;
    }
    lowSince = 0;
    if (!grown || confirmTimer) return;
    confirmTimer = setTimeout(() => {
      confirmTimer = null;
      const now = textLength();
      if (now - baseline >= GROWTH) { baseline = now; report('activity'); }
    }, CONFIRM);
  }

  function circular(el) {
    for (let n = el, i = 0; n && i < 4; n = n.parentElement, i++) {
      const r = getComputedStyle(n).borderTopLeftRadius;
      const w = n.getBoundingClientRect().width;
      if (r.endsWith('%') ? parseFloat(r) >= 40 : parseFloat(r) >= w * 0.4) return true;
    }
    return false;
  }

  function findAvatar() {
    const found = [...document.querySelectorAll('video, img')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width >= 28 && r.width <= 128 && Math.abs(r.width - r.height) <= 4 && (el.currentSrc || el.src) && circular(el);
    });
    found.sort((a, b) => (b.tagName === 'VIDEO') - (a.tagName === 'VIDEO') || a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return found[0] || null;
  }

  // Sprite-sheet frame size: background-size of whole-number multiples of 100%.
  function grid(cs) {
    const m = cs.backgroundSize.match(/^(\d+)% (\d+)%$/);
    if (!m || +m[1] % 100 || +m[2] % 100 || (+m[1] === 100 && +m[2] === 100)) return null;
    return { cols: +m[1] / 100, rows: +m[2] / 100 };
  }

  // Avatar-sized element painted from a sprite sheet: either CSS-animated, or a
  // grid sheet whose frames the page's own script steps through (a mascot).
  function findSprite() {
    const candidates = new Set(document.querySelectorAll('[style*="background-image"]'));
    for (const a of document.getAnimations()) if (a.effect && a.effect.target instanceof Element) candidates.add(a.effect.target);
    for (const el of candidates) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const ratio = r.width / r.height;
      if (r.width < 28 || r.width > 128 || ratio < 0.75 || ratio > 1.33 || !/^url\(/.test(cs.backgroundImage)) continue;
      if (grid(cs) || el.getAnimations().length) return el;
    }
    return null;
  }

  function spriteMeta(el) {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    // Keep the looping (idle) animation; one-off ones like a blink would replace it.
    const all = el.getAnimations();
    const loops = all.filter((a) => a.effect.getTiming().iterations === Infinity);
    return {
      grid: grid(cs),
      width: Math.round(r.width),
      height: Math.round(r.height),
      backgroundSize: cs.backgroundSize,
      backgroundRepeat: cs.backgroundRepeat,
      backgroundPosition: cs.backgroundPosition,
      animations: (loops.length ? loops : all).map((a) => {
        const t = a.effect.getTiming();
        return {
          keyframes: a.effect.getKeyframes().map(({ computedOffset, ...k }) => k),
          timing: { duration: t.duration, delay: t.delay, easing: t.easing, direction: t.direction, fill: t.fill,
            iterations: t.iterations === Infinity ? 'Infinity' : t.iterations },
        };
      }),
    };
  }

  async function scanSprite() {
    const el = findSprite();
    if (!el) return;
    const meta = spriteMeta(el);
    const url = getComputedStyle(el).backgroundImage.match(/^url\("?(.*?)"?\)/)[1];
    const key = `${url}|${JSON.stringify(meta.grid)}|${JSON.stringify(meta.animations)}`;
    if (key === avatarSrc) return;
    avatarSrc = key;
    try {
      const blob = await (await fetch(url)).blob();
      if (blob.size <= MAX_AVATAR) report('avatar', { kind: 'sprite', mime: blob.type, data: new Uint8Array(await blob.arrayBuffer()), meta });
    } catch { /* sheet not readable from here */ }
  }

  async function scanAvatar() {
    const el = findAvatar();
    const src = el && (el.currentSrc || el.src);
    if (!el) { await scanSprite(); return; }
    if (!src || src === avatarSrc) return;
    avatarSrc = src;
    const kind = el.tagName === 'VIDEO' ? 'video' : 'img';
    try {
      const blob = await (await fetch(src)).blob();
      if (blob.size <= MAX_AVATAR) report('avatar', { kind, mime: blob.type, data: new Uint8Array(await blob.arrayBuffer()) });
    } catch {
      if (/^https?:/.test(src)) report('avatar', { kind, url: src }); // cross-origin: let the dot load it
    }
  }

  const start = () => {
    new MutationObserver(() => {
      if (!warm) return;
      clearTimeout(timer);
      timer = setTimeout(measure, SETTLE);
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    setTimeout(() => { warm = true; baseline = textLength(); }, WARMUP);
    setInterval(scanAvatar, 3000);
  };
  if (document.readyState === 'complete') start();
  else window.addEventListener('load', start);
}
