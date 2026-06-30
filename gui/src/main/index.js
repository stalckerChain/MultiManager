const { app, BrowserWindow, ipcMain, Tray, Menu, nativeTheme } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { startCore, stopCore, getCorePort, getCoreToken } = require('./core-manager');
const { createTray } = require('./tray');
const { setupUpdater } = require('./updater');
const { setupBrowserManager } = require('./browser-manager');
const keyboardHooks = require('./keyboard-hooks');

let appVersion = '0.0.0';
try {
  const pkgPath = path.join(__dirname, '..', '..', 'package.json');
  if (fs.existsSync(pkgPath)) {
    appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf-8')).version;
  } else {
    appVersion = app.getVersion();
  }
} catch {
  appVersion = app.getVersion();
}

let mainWindow = null;
let tray = null;

const isDev = !app.isPackaged;

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [${level}] ${args.join(' ')}`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, msg + '\n'); } catch (e) {}
}

log('INFO', '=== MultiManager started ===');
log('INFO', 'isDev:', isDev, 'isPackaged:', app.isPackaged);
log('INFO', 'appPath:', app.getAppPath());
log('INFO', 'userData:', app.getPath('userData'));
log('INFO', 'exePath:', process.execPath);

async function gracefulShutdown() {
  const port = getCorePort();
  const token = getCoreToken();
  log('INFO', 'gracefulShutdown: stopping browsers on port', port);

  return new Promise((resolve) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port,
      path: '/api/browser/shutdown',
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      timeout: 15000,
    }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        log('INFO', 'gracefulShutdown: response', body);
        stopCore();
        resolve();
      });
    });

    req.on('error', (err) => {
      log('ERROR', 'gracefulShutdown: error', err.message);
      stopCore();
      resolve();
    });

    req.on('timeout', () => {
      log('ERROR', 'gracefulShutdown: timeout, force stopping');
      req.destroy();
      stopCore();
      resolve();
    });

    req.end();
  });
}

async function createWindow() {
  log('INFO', 'createWindow: starting core...');
  let port;
  try {
    port = await startCore();
    log('INFO', 'createWindow: core started on port', port);
  } catch (err) {
    log('ERROR', 'createWindow: core failed:', err.message);
    port = 3000;
  }
  const token = getCoreToken();
  log('INFO', 'createWindow: token ready');

  const windowTitle = isDev ? `MultiManager v${appVersion} (dev)` : `MultiManager v${appVersion}`;

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    backgroundColor: '#0f172a',
    title: windowTitle,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload', 'index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  log('INFO', 'createWindow: BrowserWindow created');

  mainWindow.webContents.on('console-message', (e, level, msg, line, sourceId) => {
    const levels = ['verbose', 'info', 'warning', 'error'];
    log('RENDERER', `[${levels[level] || level}] ${msg} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('did-fail-load', (e, errorCode, errorDescription, validatedURL) => {
    log('ERROR', 'createWindow: failed to load:', errorCode, errorDescription, validatedURL);
  });

  mainWindow.webContents.on('crashed', () => {
    log('ERROR', 'createWindow: renderer crashed!');
  });

  mainWindow.once('ready-to-show', () => {
    log('INFO', 'createWindow: ready-to-show');
    mainWindow.show();
  });

  mainWindow.on('close', (e) => {
    log('INFO', 'window close event');
    if (!app.isQuitting) {
      e.preventDefault();
      mainWindow.hide();
    }
  });

  const distPath = path.join(__dirname, '..', '..', 'dist', 'index.html');
  log('INFO', 'createWindow: loading file:', distPath);
  log('INFO', 'createWindow: file exists:', fs.existsSync(distPath));

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(distPath);
    mainWindow.webContents.openDevTools();
  }

  ipcMain.handle('get-port', () => getCorePort());
  ipcMain.handle('get-token', () => getCoreToken());
  ipcMain.handle('quit-app', async () => {
    app.isQuitting = true;
    await gracefulShutdown();
    app.quit();
  });

  ipcMain.handle('hooks:start', () => {
    log('INFO', 'hooks:start IPC received');
    try {
      keyboardHooks.start(getCorePort(), getCoreToken());
      log('INFO', 'hooks:start completed');
    } catch (err) {
      log('ERROR', 'hooks:start failed:', err.message, err.stack);
    }
  });
  ipcMain.handle('hooks:stop', () => {
    log('INFO', 'hooks:stop IPC received');
    try {
      keyboardHooks.stop();
    } catch (err) {
      log('ERROR', 'hooks:stop failed:', err.message);
    }
  });

  tray = createTray(mainWindow, async () => {
    app.isQuitting = true;
    await gracefulShutdown();
    app.quit();
  });

  setupUpdater(mainWindow);
  setupBrowserManager(mainWindow);
}

app.whenReady().then(createWindow).catch(err => {
  log('ERROR', 'app.whenReady failed:', err.message, err.stack);
});

app.on('window-all-closed', () => {
  log('INFO', 'window-all-closed');
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow) {
    mainWindow.show();
  }
});

app.on('before-quit', async () => {
  log('INFO', 'before-quit');
  app.isQuitting = true;
  keyboardHooks.stop();
  await gracefulShutdown();
});

process.on('uncaughtException', (err) => {
  log('ERROR', 'uncaughtException:', err.message, err.stack);
});

process.on('unhandledRejection', (reason) => {
  log('ERROR', 'unhandledRejection:', reason?.message || reason);
});
