const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getPort: () => ipcRenderer.invoke('get-port'),
  getPortAndToken: () => ipcRenderer.invoke('get-port-and-token'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  hooksStart: () => ipcRenderer.invoke('hooks:start'),
  hooksStop: () => ipcRenderer.invoke('hooks:stop'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectFile: (filters) => ipcRenderer.invoke('dialog:select-file', filters),
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, route) => callback(route)),
  onUpdateAvailable: (callback) => ipcRenderer.on('update-available', (event, info) => callback(info)),
  onUpdateDownloaded: (callback) => ipcRenderer.on('update-downloaded', (event, info) => callback(info)),
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  onBrowserInstallStart: (callback) => ipcRenderer.on('browser:install-start', () => callback()),
  onBrowserInstallComplete: (callback) => ipcRenderer.on('browser:install-complete', (event, data) => callback(data)),

  ptyStart: (filePath) => ipcRenderer.invoke('pty:start', filePath),
  ptyStop: () => ipcRenderer.invoke('pty:stop'),
  onPtyData: (callback) => {
    const handler = (event, data) => callback(data);
    ipcRenderer.on('pty:data', handler);
    return () => ipcRenderer.removeListener('pty:data', handler);
  },
  onPtyError: (callback) => {
    const handler = (event, error) => callback(error);
    ipcRenderer.on('pty:error', handler);
    return () => ipcRenderer.removeListener('pty:error', handler);
  },
});
