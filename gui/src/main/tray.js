const { Tray, Menu, nativeImage, app } = require('electron');
const path = require('path');
const fs = require('fs');

let tray = null;

function getResourcesPath() {
  // Dev: resources/ is at gui/src/main/../../resources
  // Packaged: resources/ is at {resourcesPath}/resources (due to "files" in build config)
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'resources');
  }
  return path.join(__dirname, '..', '..', 'resources');
}

function createTray(mainWindow, onQuit) {
  // Use ICO on Windows for best tray compatibility
  const iconName = process.platform === 'win32' ? 'tray-icon.ico' : 'tray-icon.png';
  let iconPath = path.join(getResourcesPath(), iconName);

  // Fallback to the other format
  if (!fs.existsSync(iconPath)) {
    const altName = iconName === 'tray-icon.ico' ? 'tray-icon.png' : 'tray-icon.ico';
    iconPath = path.join(getResourcesPath(), altName);
  }

  let icon;
  try {
    icon = nativeImage.createFromPath(iconPath);
    if (icon.isEmpty()) icon = nativeImage.createEmpty();
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('MultiManager');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Открыть панель',
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: 'Статус API',
      click: () => {
        mainWindow.show();
        mainWindow.webContents.send('navigate', 'settings');
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

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

module.exports = { createTray };
