const { app, ipcMain } = require('electron');
const { execFile, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const execFileAsync = promisify(execFile);

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [BROWSER-MANAGER] [${level}] ${args.join(' ')}`;
  console.log(msg);
  try {
    const LOG_DIR = path.join(app.getPath('userData'), 'logs');
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch (e) {}
}

const NODE_PATH = process.execPath;

function getCloakBrowserCli() {
  const candidates = [
    path.join(process.resourcesPath, 'app.asar', 'node_modules', 'cloakbrowser', 'dist', 'cli.js'),
    path.join(__dirname, '..', '..', 'node_modules', 'cloakbrowser', 'dist', 'cli.js'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

function getCloakBrowserBinary() {
  const home = process.env.USERPROFILE || process.env.HOME || '';
  const cacheDir = path.join(home, '.cloakbrowser');
  if (!fs.existsSync(cacheDir)) return null;

  const versions = fs.readdirSync(cacheDir)
    .filter(d => d.startsWith('chromium-'))
    .sort()
    .reverse();

  for (const ver of versions) {
    const bin = path.join(cacheDir, ver, 'chrome.exe');
    if (fs.existsSync(bin)) return bin;
  }
  return null;
}

let cachedBrowserPath = null;

async function getBrowserPath() {
  if (cachedBrowserPath && fs.existsSync(cachedBrowserPath)) {
    return cachedBrowserPath;
  }

  const bin = getCloakBrowserBinary();
  if (bin) {
    cachedBrowserPath = bin;
    log('INFO', 'CloakBrowser found at:', bin);
    return bin;
  }

  return null;
}

async function runCloakBrowserCli(args, timeout = 15000) {
  const cliPath = getCloakBrowserCli();
  if (!cliPath) throw new Error('cloakbrowser CLI not found');

  return new Promise((resolve, reject) => {
    const child = spawn(NODE_PATH, [cliPath, ...args], {
      timeout,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, PATH: `${path.dirname(NODE_PATH)};${process.env.PATH || ''}` },
    });

    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });

    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(stderr || `Exit code ${code}`));
    });

    child.on('error', reject);
  });
}

async function installBrowser(mainWindow) {
  try {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:install-start');
    }

    log('INFO', 'Installing CloakBrowser...');
    const { stdout } = await runCloakBrowserCli(['install'], 300000);
    log('INFO', 'CloakBrowser installed:', stdout);

    cachedBrowserPath = null;
    const binPath = await getBrowserPath();

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:install-complete', { success: true, path: binPath });
    }

    return binPath;
  } catch (e) {
    log('ERROR', 'CloakBrowser install failed:', e.message);

    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('browser:install-complete', { success: false, error: e.message });
    }

    return null;
  }
}

function setupBrowserManager(mainWindow) {
  ipcMain.handle('browser:check', async () => {
    const browserPath = await getBrowserPath();
    return { installed: browserPath !== null, path: browserPath };
  });

  ipcMain.handle('browser:install', async () => {
    return await installBrowser(mainWindow);
  });

  ipcMain.handle('browser:path', async () => {
    return await getBrowserPath();
  });

  getBrowserPath().then(p => {
    log('INFO', 'Browser manager initialized, path:', p || 'NOT FOUND');
  });
}

module.exports = { setupBrowserManager, getBrowserPath };
