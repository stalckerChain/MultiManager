const http = require('http');
const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(require('electron').app.getPath('userData'), 'logs');
const LOG_FILE = path.join(LOG_DIR, `hooks-${new Date().toISOString().slice(0, 10)}.log`);

function logHook(msg) {
  const line = `[${new Date().toISOString()}] ${msg}\n`;
  try { fs.appendFileSync(LOG_FILE, line); } catch {}
}

const WH_KEYBOARD_LL = 14;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;

const VK_KEY_MAP = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'Shift',
  0x11: 'Control', 0x12: 'Alt', 0x13: 'Pause', 0x14: 'CapsLock',
  0x1B: 'Escape', 0x20: ' ', 0x21: 'PageUp', 0x22: 'PageDown',
  0x23: 'End', 0x24: 'Home', 0x25: 'ArrowLeft', 0x26: 'ArrowUp',
  0x27: 'ArrowRight', 0x28: 'ArrowDown', 0x2C: 'PrintScreen',
  0x2D: 'Insert', 0x2E: 'Delete', 0x5B: 'Meta', 0x5C: 'Meta',
  0x60: '0', 0x61: '1', 0x62: '2', 0x63: '3', 0x64: '4',
  0x65: '5', 0x66: '6', 0x67: '7', 0x68: '8', 0x69: '9',
  0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4',
  0x74: 'F5', 0x75: 'F6', 0x76: 'F7', 0x77: 'F8',
  0x78: 'F9', 0x79: 'F10', 0x7A: 'F11', 0x7B: 'F12',
};

const VK_CODE_MAP = {
  0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'ShiftLeft',
  0x11: 'ControlLeft', 0x12: 'AltLeft', 0x1B: 'Escape', 0x20: 'Space',
  0x25: 'ArrowLeft', 0x26: 'ArrowUp', 0x27: 'ArrowRight', 0x28: 'ArrowDown',
};

function vkToKey(vkCode) {
  if (vkCode >= 0x30 && vkCode <= 0x5A) return String.fromCharCode(vkCode).toLowerCase();
  return VK_KEY_MAP[vkCode] || 'VK_' + vkCode;
}

function vkToCode(vkCode) {
  if (vkCode >= 0x30 && vkCode <= 0x39) return 'Digit' + String.fromCharCode(vkCode);
  if (vkCode >= 0x41 && vkCode <= 0x5A) return 'Key' + String.fromCharCode(vkCode);
  return VK_CODE_MAP[vkCode] || 'Key' + vkCode;
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

      sendToBackend({
        type: event.isDown ? 'keyDown' : 'keyUp',
        key: vkToKey(event.vkCode),
        code: vkToCode(event.vkCode),
        windowsVirtualKeyCode: event.vkCode,
        ctrlKey: event.ctrlKey,
        shiftKey: event.shiftKey,
        altKey: event.altKey,
        metaKey: event.metaKey,
      });
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
