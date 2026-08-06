const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');
const { resolveResourcesPath, resolveTrayResources } = require('./tray-paths');
const { activateMainWindow } = require('./main-window-utils');

let tray = null;

const LOG_DIR = path.join(app.getPath('userData'), 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [TRAY] [${level}] ${args.join(' ')}`;
  console.log(msg);
  try { fs.appendFileSync(LOG_FILE, msg + '\n'); } catch (e) {}
}

function createTray(mainWindow, onQuit) {
  const resourcesDir = resolveResourcesPath();
  const trayResource = resolveTrayResources({
    resourcesDir,
    platform: process.platform,
  });

  if (!trayResource.present) {
    log('WARN',
      'no tray icon found. dir:', resourcesDir,
      'primary:', trayResource.primaryPath,
      'primaryExists:', trayResource.primaryExists,
      'alt:', trayResource.altPath,
      'altExists:', trayResource.altExists);
  } else if (trayResource.fallback) {
    log('WARN',
      'tray icon fallback used. primary missing, using', trayResource.format,
      'path:', trayResource.iconPath);
  } else {
    log('INFO', 'tray icon selected. format:', trayResource.format, 'path:', trayResource.iconPath);
  }

  let icon;
  try {
    icon = nativeImage.createFromPath(trayResource.iconPath);
    if (icon.isEmpty()) {
      log('ERROR',
        'nativeImage is empty for selected icon. path:', trayResource.iconPath,
        'fileExists:', fs.existsSync(trayResource.iconPath),
        'format:', trayResource.format,
        'fallback:', trayResource.fallback);
      icon = nativeImage.createEmpty();
    }
  } catch (err) {
    log('ERROR',
      'failed to load tray icon. path:', trayResource.iconPath,
      'error:', err.message);
    icon = nativeImage.createEmpty();
  }

  const showWindow = () => {
    activateMainWindow(mainWindow);
  };

  tray = new Tray(icon);
  tray.setToolTip('MultiManager');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть панель',
      click: showWindow,
    },
    {
      label: 'Статус API',
      click: () => {
        activateMainWindow(mainWindow);
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('navigate', 'settings');
        }
      },
    },
    { type: 'separator' },
    {
      label: 'Выход',
      click: () => {
        onQuit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('double-click', showWindow);
  tray.on('click', showWindow);

  return tray;
}

module.exports = { createTray };
