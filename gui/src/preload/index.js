const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE = new Set([
  'get-port',
  'get-port-and-token',
  'quit-app',
  'hooks:start',
  'hooks:stop',
  'dialog:select-folder',
  'dialog:select-file',
  'dialog:select-zip',
  'pty:start',
  'pty:stop',
  'browser:check',
  'browser:install',
  'browser:path',
]);

contextBridge.exposeInMainWorld('electronAPI', {
  getPort: () => ipcRenderer.invoke('get-port'),
  getPortAndToken: () => ipcRenderer.invoke('get-port-and-token'),
  quitApp: () => ipcRenderer.invoke('quit-app'),
  hooksStart: () => ipcRenderer.invoke('hooks:start'),
  hooksStop: () => ipcRenderer.invoke('hooks:stop'),
  selectFolder: () => ipcRenderer.invoke('dialog:select-folder'),
  selectFile: (filters) => ipcRenderer.invoke('dialog:select-file', filters),
  selectZip: () => ipcRenderer.invoke('dialog:select-zip'),
  onNavigate: (callback) => ipcRenderer.on('navigate', (event, route) => callback(route)),
  onApiTokenChanged: (callback) => {
    const handler = (event, token) => callback(token);
    ipcRenderer.on('api-token-changed', handler);
    return () => ipcRenderer.removeListener('api-token-changed', handler);
  },
  invoke: (channel, ...args) => {
    if (!ALLOWED_INVOKE.has(channel)) {
      console.warn(`[Preload] Blocked invoke for unlisted channel: ${channel}`);
      return Promise.reject(new Error(`Channel ${channel} is not allowed`));
    }
    if (channel === 'pty:start') {
      if (!args[0] || typeof args[0] !== 'string' || args[0].length > 4096) {
        return Promise.reject(new Error('Invalid file path'));
      }
    }
    return ipcRenderer.invoke(channel, ...args);
  },
  onBrowserInstallStart: (callback) => ipcRenderer.on('browser:install-start', () => callback()),
  onBrowserInstallComplete: (callback) => ipcRenderer.on('browser:install-complete', (event, data) => callback(data)),

  ptyStart: (filePath) => {
    if (!filePath || typeof filePath !== 'string' || filePath.length > 4096) {
      return Promise.reject(new Error('Invalid file path'));
    }
    return ipcRenderer.invoke('pty:start', filePath);
  },
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
