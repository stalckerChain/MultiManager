process.on('uncaughtException', (err) => {
  try { process.send({ type: 'error', data: 'uncaught: ' + err.message + '\n' + err.stack }); } catch {}
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  try { process.send({ type: 'error', data: 'unhandled: ' + String(err) }); } catch {}
  process.exit(1);
});

try {
  const koffi = require('koffi');
  const { vkToKey, vkToCode } = require('./vk-map');

  const user32 = koffi.load('user32.dll');

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
    pt_x: 'int32', pt_y: 'int32', mouseData: 'uint32',
    flags: 'uint32', time: 'uint32', dwExtraInfo: 'uint64',
  });

  const KBDLLHOOKSTRUCT = koffi.struct('KBDLLHOOKSTRUCT', {
    vkCode: 'uint32', scanCode: 'uint32', flags: 'uint32',
    time: 'uint32', dwExtraInfo: 'uint64',
  });

  const MSG = koffi.struct('MSG', {
    hwnd: 'void*', message: 'uint32', wParam: 'uint64',
    lParam: 'int64', time: 'uint32', pt_x: 'int32', pt_y: 'int32',
  });

  const HOOKPROC = koffi.proto('HOOKPROC_WORKER', 'long long', ['int', 'long long', 'void*']);

  const SetWindowsHookExW = user32.func('SetWindowsHookExW', 'void*', ['int', koffi.pointer(HOOKPROC), 'void*', 'uint32']);
  const UnhookWindowsHookEx = user32.func('UnhookWindowsHookEx', 'int', ['void*']);
  const CallNextHookEx = user32.func('CallNextHookEx', 'long long', ['void*', 'int', 'long long', 'void*']);
  const PeekMessageW = user32.func('PeekMessageW', 'int', [koffi.pointer(MSG), 'void*', 'uint32', 'uint32', 'uint32']);

  let mouseHook = null;
  let keyboardHook = null;

  const msgBuf = koffi.alloc(MSG, 1);

  let eventCount = 0;
  let pumpCount = 0;

  function emit(type, data) {
    eventCount++;
    try {
      if (process.send) process.send({ type, data });
    } catch (e) {}
  }

  const mouseCallback = koffi.register(function(nCode, wParam, lParam) {
    if (nCode >= 0) {
      try {
        const msg = koffi.decode(lParam, MSLLHOOKSTRUCT);
        if (msg) {
          const x = msg.pt_x;
          const y = msg.pt_y;
          switch (wParam) {
            case WM_MOUSEMOVE:
              emit('mouseMove', { x, y, screenX: x, screenY: y });
              break;
            case WM_LBUTTONDOWN:
              emit('mouseDown', { x, y, button: 0, pressed: true });
              break;
            case WM_LBUTTONUP:
              emit('mouseUp', { x, y, button: 0, pressed: false });
              break;
            case WM_RBUTTONDOWN:
              emit('mouseDown', { x, y, button: 2, pressed: true });
              break;
            case WM_RBUTTONUP:
              emit('mouseUp', { x, y, button: 2, pressed: false });
              break;
            case WM_MOUSEWHEEL: {
              const delta = msg.mouseData >> 16;
              emit('scroll', { x, y, deltaX: 0, deltaY: delta });
              break;
            }
          }
        }
      } catch (e) {}
    }
    return CallNextHookEx(mouseHook, nCode, wParam, lParam);
  }, koffi.pointer(HOOKPROC));

  const keyboardCallback = koffi.register(function(nCode, wParam, lParam) {
    if (nCode >= 0) {
      try {
        const msg = koffi.decode(lParam, KBDLLHOOKSTRUCT);
        if (msg) {
          const isDown = wParam === WM_KEYDOWN || wParam === WM_SYSKEYDOWN;
          const flags = msg.flags;
          const event = {
            key: vkToKey(msg.vkCode),
            code: vkToCode(msg.vkCode),
            windowsVirtualKeyCode: msg.vkCode,
            ctrlKey: !!(flags & (1 << 5)),
            shiftKey: !!(flags & (1 << 6)),
            altKey: !!(flags & (1 << 7)),
            metaKey: false,
          };
          if (isDown) {
            emit('keyDown', event);
          } else {
            emit('keyUp', event);
          }
        }
      } catch (e) {}
    }
    return CallNextHookEx(keyboardHook, nCode, wParam, lParam);
  }, koffi.pointer(HOOKPROC));

  mouseHook = SetWindowsHookExW(WH_MOUSE_LL, mouseCallback, null, 0);
  keyboardHook = SetWindowsHookExW(WH_KEYBOARD_LL, keyboardCallback, null, 0);

  if (!mouseHook || !keyboardHook) {
    process.send({ type: 'error', data: 'Failed to install hooks: mouse=' + !!mouseHook + ' keyboard=' + !!keyboardHook });
    process.exit(1);
  }

  process.send({ type: 'ready' });

  setInterval(() => {
    PeekMessageW(msgBuf, null, 0, 0, 1);
    pumpCount++;
  }, 5);

  setInterval(() => {
    process.send({ type: 'heartbeat', data: { eventCount, pumpCount } });
  }, 3000);

} catch (err) {
  try {
    process.send({ type: 'error', data: err.message + '\n' + err.stack });
  } catch (e) {
    console.error('HOOK WORKER FATAL:', err);
  }
  process.exit(1);
}
