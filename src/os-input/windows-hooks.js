const koffi = require('koffi');
const { logger } = require('../logger');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const WH_MOUSE_LL = 13;
const WH_KEYBOARD_LL = 14;
const WM_MOUSEMOVE = 0x0200;
const WM_LBUTTONDOWN = 0x0201;
const WM_LBUTTONUP = 0x0202;
const WM_RBUTTONDOWN = 0x0204;
const WM_RBUTTONUP = 0x0205;
const WM_MOUSEWHEEL = 0x020A;
const WM_KEYDOWN = 0x0100;
const WM_KEYUP = 0x0101;
const WM_SYSKEYDOWN = 0x0104;
const WM_SYSKEYUP = 0x0105;

const MSLLHOOKSTRUCT = koffi.struct('MSLLHOOKSTRUCT', {
  pt_x: 'int32',
  pt_y: 'int32',
  mouseData: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});

const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
  vkCode: 'uint32',
  scanCode: 'uint32',
  flags: 'uint32',
  time: 'uint32',
  dwExtraInfo: 'uint64',
});

const GetForegroundWindow = user32.func('GetForegroundWindow', 'void*', []);
const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', ['void*', 'void*']);
const GetCurrentThreadId = kernel32.func('GetCurrentThreadId', 'uint32', []);
const SetWindowsHookExW = user32.func('SetWindowsHookExW', 'void*', ['int', 'void*', 'void*', 'uint32']);
const UnhookWindowsHookEx = user32.func('UnhookWindowsHookEx', 'int', ['void*']);
const CallNextHookEx = user32.func('CallNextHookEx', 'int64', ['void*', 'int', 'int64', 'void*']);

class WindowsHooks {
  constructor() {
    this.mouseHook = null;
    this.keyboardHook = null;
    this.threadId = 0;
    this.running = false;
    this.onMouseMove = null;
    this.onMouseButton = null;
    this.onMouseWheel = null;
    this.onKeyDown = null;
    this.onKeyUp = null;
    this._mouseCallback = null;
    this._keyboardCallback = null;
  }

  start() {
    if (this.running) return;
    this.running = true;
    this.threadId = GetCurrentThreadId();

    this._installMouseHook();
    this._installKeyboardHook();

    logger.info('OS-INPUT: Windows hooks started');
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this.mouseHook) {
      UnhookWindowsHookEx(this.mouseHook);
      this.mouseHook = null;
    }
    if (this.keyboardHook) {
      UnhookWindowsHookEx(this.keyboardHook);
      this.keyboardHook = null;
    }

    this._mouseCallback = null;
    this._keyboardCallback = null;

    logger.info('OS-INPUT: Windows hooks stopped');
  }

  _installMouseHook() {
    const self = this;
    this._mouseCallback = koffi.register(function(nCode, wParam, lParam) {
      if (nCode >= 0) {
        self._handleMouseEvent(wParam, lParam);
      }
      return CallNextHookEx(self.mouseHook, nCode, wParam, lParam);
    }, 'int64', ['int', 'int64', 'void*']);

    this.mouseHook = SetWindowsHookExW(WH_MOUSE_LL, this._mouseCallback, null, 0);
    if (!this.mouseHook) {
      logger.error('OS-INPUT: Failed to install mouse hook');
    }
  }

  _installKeyboardHook() {
    const self = this;
    this._keyboardCallback = koffi.register(function(nCode, wParam, lParam) {
      if (nCode >= 0) {
        self._handleKeyboardEvent(wParam, lParam);
      }
      return CallNextHookEx(self.keyboardHook, nCode, wParam, lParam);
    }, 'int64', ['int', 'int64', 'void*']);

    this.keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, this._keyboardCallback, null, 0);
    if (!this.keyboardHook) {
      logger.error('OS-INPUT: Failed to install keyboard hook');
    }
  }

  _handleMouseEvent(wParam, lParam) {
    try {
      const msg = koffi.decode(lParam, MSLLHOOKSTRUCT);
      if (!msg) return;

      const x = msg.pt_x;
      const y = msg.pt_y;

      switch (wParam) {
        case WM_MOUSEMOVE:
          if (this.onMouseMove) this.onMouseMove({ x, y, screenX: x, screenY: y });
          break;
        case WM_LBUTTONDOWN:
          if (this.onMouseButton) this.onMouseButton({ x, y, button: 0, pressed: true });
          break;
        case WM_LBUTTONUP:
          if (this.onMouseButton) this.onMouseButton({ x, y, button: 0, pressed: false });
          break;
        case WM_RBUTTONDOWN:
          if (this.onMouseButton) this.onMouseButton({ x, y, button: 2, pressed: true });
          break;
        case WM_RBUTTONUP:
          if (this.onMouseButton) this.onMouseButton({ x, y, button: 2, pressed: false });
          break;
        case WM_MOUSEWHEEL:
          if (this.onMouseWheel) {
            const delta = msg.mouseData >> 16;
            this.onMouseWheel({ x, y, deltaX: 0, deltaY: delta });
          }
          break;
      }
    } catch {}
  }

  _handleKeyboardEvent(wParam, lParam) {
    try {
      const msg = koffi.decode(lParam, KBDLLHOOKSTRUCT);
      if (!msg) return;

      const key = this._vkToKey(msg.vkCode);
      const code = this._vkToCode(msg.vkCode);
      const isDown = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN;
      const flags = msg.flags;

      const event = {
        key,
        code,
        windowsVirtualKeyCode: msg.vkCode,
        ctrlKey: !!(flags & (1 << 5)),
        shiftKey: !!(flags & (1 << 6)),
        altKey: !!(flags & (1 << 7)),
        metaKey: false,
      };

      if (isDown) {
        if (this.onKeyDown) this.onKeyDown(event);
      } else {
        if (this.onKeyUp) this.onKeyUp(event);
      }
    } catch {}
  }

  _vkToKey(vkCode) {
    const map = {
      0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'Shift',
      0x11: 'Control', 0x12: 'Alt', 0x13: 'Pause', 0x14: 'CapsLock',
      0x1B: 'Escape', 0x20: ' ', 0x21: 'PageUp', 0x22: 'PageDown',
      0x23: 'End', 0x24: 'Home', 0x25: 'ArrowLeft', 0x26: 'ArrowUp',
      0x27: 'ArrowRight', 0x28: 'ArrowDown', 0x2C: 'PrintScreen',
      0x2D: 'Insert', 0x2E: 'Delete', 0x5B: 'Meta', 0x5C: 'Meta',
      0x60: '0', 0x61: '1', 0x62: '2', 0x63: '3', 0x64: '4',
      0x65: '5', 0x66: '6', 0x67: '7', 0x68: '8', 0x69: '9',
      0x6A: '*', 0x6B: '+', 0x6C: ',', 0x6D: '-', 0x6E: '.', 0x6F: '/',
      0x70: 'F1', 0x71: 'F2', 0x72: 'F3', 0x73: 'F4',
      0x74: 'F5', 0x75: 'F6', 0x76: 'F7', 0x77: 'F8',
      0x78: 'F9', 0x79: 'F10', 0x7A: 'F11', 0x7B: 'F12',
      0x90: 'NumLock', 0x91: 'ScrollLock',
    };

    if (vkCode >= 0x30 && vkCode <= 0x5A) {
      return String.fromCharCode(vkCode).toLowerCase();
    }
    return map[vkCode] || `VK_${vkCode}`;
  }

  _vkToCode(vkCode) {
    const map = {
      0x08: 'Backspace', 0x09: 'Tab', 0x0D: 'Enter', 0x10: 'ShiftLeft',
      0x11: 'ControlLeft', 0x12: 'AltLeft', 0x1B: 'Escape', 0x20: 'Space',
      0x25: 'ArrowLeft', 0x26: 'ArrowUp', 0x27: 'ArrowRight', 0x28: 'ArrowDown',
    };
    if (vkCode >= 0x30 && vkCode <= 0x39) return `Digit${String.fromCharCode(vkCode)}`;
    if (vkCode >= 0x41 && vkCode <= 0x5A) return `Key${String.fromCharCode(vkCode)}`;
    return map[vkCode] || `Key${vkCode}`;
  }
}

const windowsHooks = new WindowsHooks();

module.exports = { WindowsHooks, windowsHooks };
