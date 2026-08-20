const http = require('http');
const fs = require('fs');
const path = require('path');
const { buildKeyEvent, shouldSendCharInput } = require('./keyboard-hooks-payload');

const LOG_DIR = path.join(require('electron').app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, `hooks-${new Date().toISOString().slice(0, 10)}.log`);

function logHook(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

let running = false;
let corePort = 3000;
let coreToken = '';
let addon = null;
let eventCount = 0;

function sendToBackend(event) {
  const data = JSON.stringify(event);

  if (event.ctrlKey && (event.key === 'w' || event.key === 't') && event.type === 'keyDown') {
    logHook(`CTRL+W/T intercepted: key=${event.key} type=${event.type} ctrlKey=${event.ctrlKey}`);
  }

  const req = http.request({
    hostname: '127.0.0.1',
    port: corePort,
    path: '/api/multi-control/os-keyboard',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${coreToken}`,
      'Content-Length': Buffer.byteLength(data),
    },
    timeout: 2000,
  }, (res) => {
    let body = '';
    res.on('data', (c) => { body += c; });
    res.on('end', () => {
      if (res.statusCode !== 200) {
        logHook(`HTTP ${res.statusCode}: ${body}`);
      }
    });
  });
  req.on('error', (err) => {
    logHook(`HTTP ERROR: ${err.message}`);
  });
  req.write(data);
  req.end();
}

function findAddon() {
  const isDev = !require('electron').app.isPackaged;
  const candidates = isDev
    ? [
        path.join(__dirname, '..', '..', '..', 'src', 'os-input', 'native-hooks', 'build', 'Release', 'hooks.node'),
        path.join(__dirname, '..', '..', '..', 'src', 'os-input', 'native-hooks', 'build', 'Debug', 'hooks.node'),
      ]
    : [
        path.join(process.resourcesPath, 'backend', 'os-input', 'native-hooks', 'build', 'Release', 'hooks.node'),
        path.join(process.resourcesPath, 'backend', 'os-input', 'native-hooks', 'build', 'Debug', 'hooks.node'),
      ];

  for (const p of candidates) {
    if (fs.existsSync(p)) {
      logHook(`Found addon at: ${p}`);
      return p;
    }
  }
  return null;
}

function start(port, token) {
  if (running) {
    logHook('Already running, skipping');
    return;
  }
  running = true;
  corePort = port;
  coreToken = token;
  logHook(`start() called — port=${port}, token=${token.slice(0, 8)}...`);

  const addonPath = findAddon();
  if (!addonPath) {
    logHook('FATAL: hooks.node addon not found');
    running = false;
    return;
  }

  try {
    addon = require(addonPath);
    logHook(`Addon loaded — start=${typeof addon.start}, stop=${typeof addon.stop}`);
  } catch (err) {
    logHook(`FATAL: Failed to load addon: ${err.message}\n${err.stack}`);
    running = false;
    return;
  }

  try {
    addon.start((event) => {
      eventCount++;
      if (eventCount <= 5 || eventCount % 100 === 0) {
        logHook(`event #${eventCount}: vk=${event.vkCode} wParam=${event.wParam} isDown=${event.isDown}`);
      }

      if (!event.isDown && !event.isUp) return;

      // Клавиша всегда передаётся ровно один раз (keyDown/keyUp). Printable text
      // отдельным событием charInput — только когда addon вычислил символ
      // (ToUnicodeEx с учётом раскладки), а не командное сочетание Ctrl/Meta/Alt.
      sendToBackend(buildKeyEvent(event));

      if (event.isDown && shouldSendCharInput(event)) {
        sendToBackend({ type: 'charInput', text: event.text, sourcePid: event.sourcePid });
      }
    });
    logHook('Addon start() called OK');
  } catch (err) {
    logHook(`FATAL: addon.start() failed: ${err.message}\n${err.stack}`);
    running = false;
  }
}

function stop() {
  if (!running) return;
  running = false;

  if (addon) {
    try { addon.stop(); } catch (e) {
      logHook(`addon.stop() error: ${e.message}`);
    }
  }

  logHook(`Stopped — total events captured: ${eventCount}`);
  eventCount = 0;
}

module.exports = { start, stop };
