const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPort: () => ipcRenderer.invoke('get-port'),
  getToken: () => ipcRenderer.invoke('get-token'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  hooksStart: () => ipcRenderer.invoke('hooks:start'),
  hooksStop: () => ipcRenderer.invoke('hooks:stop'),
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, route) => callback(route)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, info) => callback(info)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onBrowserInstallStart: (callback) => ipcRenderer.on('browser:install-start', () => callback()),
  onBrowserInstallComplete: (callback) => ipcRenderer.on('browser:install-complete', (event, data) => callback(data)),
});
