// Preload for each in-app web bot. main.js prepends page-watch.js and wide-load.js
// to this file (sandboxed preloads can't require local modules), so botBubbleWatch
// and botBubbleWideLoad are in scope.
const { contextBridge, ipcRenderer } = require('electron');

const MARK = '__botBubbleNotify';

botBubbleWatch((type, payload) => ipcRenderer.send(`web:${type}`, payload));

window.addEventListener('message', (e) => {
  if (e.source === window && e.data && e.data[MARK]) ipcRenderer.send('web:activity');
});

// Wrap the page's Notification so a "reply ready" toast also lights the dot.
contextBridge.executeInMainWorld({
  func: (mark) => {
    const Native = window.Notification;
    if (!Native) return;
    function Wrapped(title, options) {
      window.postMessage({ [mark]: true }, '*');
      return new Native(title, options);
    }
    Wrapped.prototype = Native.prototype;
    Object.defineProperty(Wrapped, 'permission', { get: () => Native.permission });
    Wrapped.requestPermission = Native.requestPermission.bind(Native);
    window.Notification = Wrapped;
  },
  args: [MARK],
});

// A bot with a `loadWidth` (passed by main.js) loads as if its window were that wide.
const loadWidth = Number((process.argv.find((a) => a.startsWith('--bot-bubble-load-width=')) || '').split('=')[1]);
if (loadWidth > 0) contextBridge.executeInMainWorld({ func: botBubbleWideLoad, args: [loadWidth] });
