const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  loginGoogle: () => ipcRenderer.send('auth:login'),
  startSync: (config) => ipcRenderer.send('sync:start', config),
  onSyncProgress: (callback) => ipcRenderer.on('sync:progress', (e, v) => callback(v)),
  onAuthSuccess: (callback) => ipcRenderer.on('auth:success', (e, p) => callback(p)),
  onAuthError: (callback) => ipcRenderer.on('auth:error', (e, msg) => callback(msg)),
  setWindowIcon: (pngBase64) => ipcRenderer.send('icon:rendered', pngBase64)
});
