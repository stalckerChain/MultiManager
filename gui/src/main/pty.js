const { ipcMain } = require('electron');
const os = require('os');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');

let ptyProcess = null;
let currentFile = null;
let senderRef = null;

function isAllowedLogPath(filePath) {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const allowedDirs = [
    path.join(home, 'AI'),
  ];
  try {
    const electron = require('electron');
    if (electron.app && typeof electron.app.getPath === 'function') {
      allowedDirs.push(path.join(electron.app.getPath('userData'), 'logs'));
    }
  } catch {}
  const resolved = path.resolve(filePath);
  return allowedDirs.some(dir => resolved.startsWith(dir));
}

function init(mainWindow) {
  ipcMain.handle('pty:start', (event, filePath) => {
    return startPty(filePath, event.sender);
  });

  ipcMain.handle('pty:stop', () => {
    return stopPty();
  });
}

function startPty(filePath, sender) {
  stopPty();

  if (!filePath || !fs.existsSync(filePath)) {
    return { success: false, error: 'File not found' };
  }

  if (!isAllowedLogPath(filePath)) {
    return { success: false, error: 'Path not in allowed log directory' };
  }

  currentFile = filePath;
  senderRef = sender;

  try {
    if (os.platform() === 'win32') {
      ptyProcess = spawn('powershell.exe', [
        '-NoProfile', '-NonInteractive',
        '-Command', `Get-Content -Path "${filePath}" -Wait -Tail 50`
      ], { windowsHide: true });
    } else {
      ptyProcess = spawn('tail', ['-f', '-n', '50', filePath]);
    }

    ptyProcess.stdout.on('data', (data) => {
      if (senderRef && !senderRef.isDestroyed()) {
        senderRef.send('pty:data', data.toString());
      }
    });

    ptyProcess.stderr.on('data', (data) => {
      if (senderRef && !senderRef.isDestroyed()) {
        senderRef.send('pty:data', data.toString());
      }
    });

    ptyProcess.on('close', () => {
      ptyProcess = null;
      currentFile = null;
      senderRef = null;
    });

    ptyProcess.on('error', (err) => {
      if (senderRef && !senderRef.isDestroyed()) {
        senderRef.send('pty:error', err.message);
      }
      stopPty();
    });

    return { success: true };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function stopPty() {
  if (ptyProcess) {
    ptyProcess.kill();
    ptyProcess = null;
  }
  currentFile = null;
  senderRef = null;
  return { success: true };
}

module.exports = { init, startPty, stopPty };
