// Bridge for the Settings window.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('settings', {
  get: () => ipcRenderer.invoke('settings:get'),
  save: (config) => ipcRenderer.invoke('settings:save', config),
  onAvatars: (cb) => ipcRenderer.on('settings:avatars', () => cb()),
  setLocked: (locked) => ipcRenderer.invoke('settings:lock', locked),
  resetPosition: () => ipcRenderer.invoke('settings:resetPosition'),
  setAutostart: (on) => ipcRenderer.invoke('settings:autostart', on),
  clearData: (id) => ipcRenderer.invoke('settings:clearData', id),
  clearThread: (id) => ipcRenderer.invoke('settings:clearThread', id),
  openInBrowser: (id) => ipcRenderer.invoke('settings:openInBrowser', id),
  pickAvatar: () => ipcRenderer.invoke('settings:pickAvatar'),
  openPath: (which) => ipcRenderer.invoke('settings:openPath', which),
  support: () => ipcRenderer.invoke('settings:support'),
  close: () => ipcRenderer.invoke('settings:close'),
  quit: () => ipcRenderer.invoke('app:quit'),
});
