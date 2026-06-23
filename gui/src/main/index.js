const { app, BrowserWindow, ipcMain, Tray, Menu, nativeTheme } = require('electron');
const path = require('path');
const { startCore, stopCore, getCorePort, getCoreToken } = require('./core-manager');
const { createTray } = require('./tray');
const { setupUpdater } = require('./updater');

let mainWindow = null;
let tray = null;

const isDev = !app.isPackaged;

async function createWindow() {
  const port = await startCore();
  const token = getCoreToken();

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(path.join(__dirname, '..', '..', 'dist', 'index.html'));
  }

  ipcMain.handle('get-port', () => getCorePort());
  ipcMain.handle('get-token', () => getCoreToken());
  ipcMain.handle('quit-app', () => {
    app.isQuitting = true;
    stopCore();
    app.quit();
  });

  tray = createTray(mainWindow, () => {
    app.isQuitting = true;
    stopCore();
    app.quit();
  });

  setupUpdater(mainWindow);
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
  stopCore();
});
