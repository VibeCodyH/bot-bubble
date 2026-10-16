// For bots whose page only builds its full view when it loads in a wide window
// (a provider's `loadWidth`). Runs in the page's own world before its scripts:
// while the page loads, innerWidth and width media queries answer as if the
// window were at least `width` px wide. Once the page's text settles, they go
// back to the real width and the page's listeners hear about it, the way they
// would after a real resize. CSS always sees the real width.
// Plain browser JavaScript, self-contained: it's passed to the page as a function.
// eslint-disable-next-line no-unused-vars
function botBubbleWideLoad(width) {
  const QUIET = 1000;  // ms of unchanged text that counts as loaded
  const MAX = 15000;   // stop pretending after this long regardless

  const realWidth = Object.getOwnPropertyDescriptor(window, 'innerWidth');
  const realMatchMedia = window.matchMedia;
  if (!realWidth || realWidth.get.call(window) >= width) return;
  let loading = true;
  const listeners = [];

  // What a plain min-/max-width query would answer at `width`; null for anything else.
  const atWidth = (q) => {
    const max = /max-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    const min = /min-width:\s*(\d+(?:\.\d+)?)px/.exec(q);
    if (max && !min) return width <= Number(max[1]);
    if (min && !max) return width >= Number(min[1]);
    return null;
  };

  Object.defineProperty(window, 'innerWidth', { configurable: true, get: () => Math.max(width, realWidth.get.call(window)) });
  window.matchMedia = function matchMedia(q) {
    const real = realMatchMedia.call(window, q);
    const wide = atWidth(String(q));
    if (wide === null || wide === real.matches) return real;
    return new Proxy(real, {
      get(t, k) {
        if (k === 'matches') return loading ? wide : t.matches;
        if (k === 'addEventListener') return (type, fn, o) => { if (type === 'change') listeners.push([t, fn]); return t.addEventListener(type, fn, o); };
        if (k === 'addListener') return (fn) => { listeners.push([t, fn]); return t.addListener(fn); };
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
  };

  function restore() {
    if (!loading) return;
    loading = false;
    Object.defineProperty(window, 'innerWidth', realWidth);
    window.matchMedia = realMatchMedia;
    for (const [mql, fn] of listeners) {
      try { (typeof fn === 'function' ? fn : fn.handleEvent).call(mql, { matches: mql.matches, media: mql.media }); } catch { /* the page's own handler */ }
    }
    window.dispatchEvent(new Event('resize'));
  }

  let last = -1;
  let since = Date.now();
  const tick = setInterval(() => {
    const len = document.body ? document.body.innerText.length : 0;
    if (len !== last) { last = len; since = Date.now(); return; }
    if (document.readyState === 'complete' && len > 0 && Date.now() - since >= QUIET) { clearInterval(tick); restore(); }
  }, 100);
  setTimeout(() => { clearInterval(tick); restore(); }, MAX);
}
