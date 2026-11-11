// Bridge between the editor page and the desktop features. Only plain data crosses it.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const listeners = new Map();
ipcRenderer.on('convert-progress', (_e, { input, p }) => { const f = listeners.get(input); if (f) f(p); });
let updateCb = null;
ipcRenderer.on('update-state', (_e, s) => { if (updateCb) updateCb(s); });

contextBridge.exposeInMainWorld('regaimNative', {
  desktop: true,
  info: () => ipcRenderer.invoke('app-info'),
  saveFile: (name, data) => ipcRenderer.invoke('save-file', { name, data }),
  showFile: (p) => ipcRenderer.invoke('show-file', p),
  pathOf: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch { return ''; } },
  convert: async (input, name, onP) => {
    if (onP) listeners.set(input, onP);
    try { return await ipcRenderer.invoke('convert', { input, name }); } finally { listeners.delete(input); }
  },
  keyStatus: () => ipcRenderer.invoke('key-status'),
  setKey: (k) => ipcRenderer.invoke('key-set', k),
  claudeJson: (prompt, images, tier) => ipcRenderer.invoke('claude-json', { prompt, images, tier }),
  updateState: () => ipcRenderer.invoke('update-state'),
  checkUpdates: () => ipcRenderer.invoke('update-check'),
  installUpdate: () => ipcRenderer.invoke('update-install'),
  transcode: (data, to, fps) => ipcRenderer.invoke('transcode', { data, to, fps }),
  onUpdate: (cb) => { updateCb = cb; }
});
