// Bridge between the dot/bubble renderer and the main process.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('dot', {
  getState: () => ipcRenderer.invoke('state:get'),
  onState: (cb) => ipcRenderer.on('state', (_e, s) => cb(s)),
  onLook: (cb) => ipcRenderer.on('look', (_e, l) => cb(l)),
  toggle: () => ipcRenderer.invoke('win:toggle'),
  collapse: () => ipcRenderer.invoke('win:collapse'),
  setLocked: (locked) => ipcRenderer.invoke('win:lock', locked),
  setProvider: (id) => ipcRenderer.invoke('provider:set', id),
  reload: () => ipcRenderer.invoke('view:reload'),
  openApp: () => ipcRenderer.invoke('app:open'),
  openSettings: () => ipcRenderer.invoke('settings:open'),
  menu: () => ipcRenderer.invoke('menu:open'),
  dragStart: () => ipcRenderer.send('drag:start'),
  dragEnd: () => ipcRenderer.send('drag:end'),
  // cli providers
  send: (text, attachments) => ipcRenderer.invoke('chat:send', { text, attachments }),
  cancel: () => ipcRenderer.invoke('chat:cancel'),
  newThread: () => ipcRenderer.invoke('chat:new'),
  pickFiles: () => ipcRenderer.invoke('files:pick'),
  pathForFile: (file) => webUtils.getPathForFile(file),
});
