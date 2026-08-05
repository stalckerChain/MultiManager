const { autoUpdater } = require('electron-updater');
const { app } = require('electron');

function setupUpdater(mainWindow) {
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.allowDowngrade = false;

  autoUpdater.on('update-available', (info) => {
    const trusted = info?.version && typeof info.version === 'string';
    if (!trusted) return;
    mainWindow.webContents.send('update-available', info);
  });

  autoUpdater.on('update-downloaded', (info) => {
    const trusted = info?.version && typeof info.version === 'string';
    if (!trusted) return;
    mainWindow.webContents.send('update-downloaded', info);
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update error');
  });

  autoUpdater.checkForUpdates().catch(() => {});
}

module.exports = { setupUpdater };
