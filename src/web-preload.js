// Preload for each in-app web bot. main.js prepends page-watch.js to this file
// (sandboxed preloads can't require local modules), so botBubbleWatch is in scope.
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
