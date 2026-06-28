import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

vi.mock('../../src/os-input/windows-hooks.js', () => ({
  windowsHooks: { start: vi.fn(), stop: vi.fn() },
  WindowsHooks: vi.fn(),
}), { virtual: true });

import { InputCapture } from '../../src/os-input/input-capture.js';
import { WindowTracker } from '../../src/os-input/window-tracker.js';

describe('InputCapture', () => {
  let cap;

  beforeEach(() => {
    cap = new InputCapture();
    cap.active = true;
  });

  it('does not emit when inactive', () => {
    cap.active = false;
    const h = vi.fn();
    cap.on('mouseMove', h);
    cap.on('keyDown', h);
    cap._onMouseMove({ x: 0, y: 0 });
    cap._onKeyDown({ key: 'a' });
    expect(h).not.toHaveBeenCalled();
  });

  it('emits mouseDown', () => {
    const h = vi.fn();
    cap.on('mouseDown', h);
    cap._onMouseButton({ x: 50, y: 60, button: 0, pressed: true });
    expect(h).toHaveBeenCalledWith({ x: 50, y: 60, button: 0 });
  });

  it('emits mouseUp', () => {
    const h = vi.fn();
    cap.on('mouseUp', h);
    cap._onMouseButton({ x: 50, y: 60, button: 0, pressed: false });
    expect(h).toHaveBeenCalledWith({ x: 50, y: 60, button: 0 });
  });

  it('emits click on mouseUp button 0', () => {
    const h = vi.fn();
    cap.on('click', h);
    cap._onMouseButton({ x: 10, y: 20, button: 0, pressed: false });
    expect(h).toHaveBeenCalledWith({ x: 10, y: 20, button: 0, clickCount: 1 });
  });

  it('no click on mouseDown', () => {
    const h = vi.fn();
    cap.on('click', h);
    cap._onMouseButton({ x: 10, y: 20, button: 0, pressed: true });
    expect(h).not.toHaveBeenCalled();
  });

  it('no click on right mouseUp', () => {
    const h = vi.fn();
    cap.on('click', h);
    cap._onMouseButton({ x: 10, y: 20, button: 2, pressed: false });
    expect(h).not.toHaveBeenCalled();
  });

  it('emits scroll', () => {
    const h = vi.fn();
    cap.on('scroll', h);
    cap._onMouseWheel({ x: 100, y: 200, deltaX: 0, deltaY: -120 });
    expect(h).toHaveBeenCalledWith({ x: 100, y: 200, deltaX: 0, deltaY: -120 });
  });

  it('emits keyDown', () => {
    const h = vi.fn();
    cap.on('keyDown', h);
    cap._onKeyDown({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
    expect(h).toHaveBeenCalled();
  });

  it('emits keyUp', () => {
    const h = vi.fn();
    cap.on('keyUp', h);
    cap._onKeyUp({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
    expect(h).toHaveBeenCalled();
  });

  it('charInput for printable char', () => {
    const h = vi.fn();
    cap.on('charInput', h);
    cap._onKeyDown({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ctrlKey: false, shiftKey: false, altKey: false, metaKey: false });
    expect(h).toHaveBeenCalledWith({ text: 'a' });
  });

  it('no charInput for ctrl+a', () => {
    const h = vi.fn();
    cap.on('charInput', h);
    cap._onKeyDown({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ctrlKey: true, shiftKey: false, altKey: false, metaKey: false });
    expect(h).not.toHaveBeenCalled();
  });

  it('no charInput for alt+a', () => {
    const h = vi.fn();
    cap.on('charInput', h);
    cap._onKeyDown({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ctrlKey: false, shiftKey: false, altKey: true, metaKey: false });
    expect(h).not.toHaveBeenCalled();
  });

  it('no charInput for meta+a', () => {
    const h = vi.fn();
    cap.on('charInput', h);
    cap._onKeyDown({ key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, ctrlKey: false, shiftKey: false, altKey: false, metaKey: true });
    expect(h).not.toHaveBeenCalled();
  });

  it('throttles mouseMove', () => {
    const h = vi.fn();
    cap.on('mouseMove', h);
    cap._onMouseMove({ x: 1, y: 1 });
    cap._onMouseMove({ x: 2, y: 2 });
    cap._onMouseMove({ x: 3, y: 3 });
    expect(h).not.toHaveBeenCalled();
    return new Promise(r => setTimeout(() => {
      expect(h).toHaveBeenCalledTimes(1);
      expect(h).toHaveBeenCalledWith({ x: 3, y: 3 });
      r();
    }, 20));
  });

  it('mouseMove stores lastMousePos', () => {
    cap._onMouseMove({ x: 42, y: 99 });
    expect(cap.lastMousePos).toEqual({ x: 42, y: 99 });
  });

  it('stop clears state', () => {
    cap.throttleTimer = setTimeout(() => {}, 5000);
    cap.lastMousePos = { x: 1, y: 1 };
    cap.stop();
    expect(cap.throttleTimer).toBeNull();
    expect(cap.lastMousePos).toBeNull();
    expect(cap.active).toBe(false);
  });
});

describe('WindowsHooks (VK mapping)', () => {
  const { WindowsHooks } = require('../../src/os-input/windows-hooks.js');
  let hooks;

  beforeEach(() => {
    hooks = new WindowsHooks();
  });

  describe('_vkToKey', () => {
    it('maps letter keys a-z', () => {
      expect(hooks._vkToKey(0x41)).toBe('a');
      expect(hooks._vkToKey(0x5A)).toBe('z');
    });

    it('maps digit keys 0-9', () => {
      expect(hooks._vkToKey(0x30)).toBe('0');
      expect(hooks._vkToKey(0x39)).toBe('9');
    });

    it('maps special keys', () => {
      expect(hooks._vkToKey(0x0D)).toBe('Enter');
      expect(hooks._vkToKey(0x1B)).toBe('Escape');
      expect(hooks._vkToKey(0x20)).toBe(' ');
      expect(hooks._vkToKey(0x08)).toBe('Backspace');
      expect(hooks._vkToKey(0x09)).toBe('Tab');
      expect(hooks._vkToKey(0x10)).toBe('Shift');
      expect(hooks._vkToKey(0x11)).toBe('Control');
      expect(hooks._vkToKey(0x12)).toBe('Alt');
    });

    it('maps arrow keys', () => {
      expect(hooks._vkToKey(0x25)).toBe('ArrowLeft');
      expect(hooks._vkToKey(0x26)).toBe('ArrowUp');
      expect(hooks._vkToKey(0x27)).toBe('ArrowRight');
      expect(hooks._vkToKey(0x28)).toBe('ArrowDown');
    });

    it('maps F keys', () => {
      expect(hooks._vkToKey(0x70)).toBe('F1');
      expect(hooks._vkToKey(0x7B)).toBe('F12');
    });

    it('returns VK_xxx for unknown', () => {
      expect(hooks._vkToKey(0xFF)).toBe('VK_255');
    });
  });

  describe('_vkToCode', () => {
    it('maps letter keys', () => {
      expect(hooks._vkToCode(0x41)).toBe('KeyA');
      expect(hooks._vkToCode(0x5A)).toBe('KeyZ');
    });

    it('maps digit keys', () => {
      expect(hooks._vkToCode(0x30)).toBe('Digit0');
      expect(hooks._vkToCode(0x39)).toBe('Digit9');
    });

    it('maps special keys', () => {
      expect(hooks._vkToCode(0x0D)).toBe('Enter');
      expect(hooks._vkToCode(0x1B)).toBe('Escape');
      expect(hooks._vkToCode(0x20)).toBe('Space');
      expect(hooks._vkToCode(0x10)).toBe('ShiftLeft');
      expect(hooks._vkToCode(0x11)).toBe('ControlLeft');
      expect(hooks._vkToCode(0x12)).toBe('AltLeft');
    });

    it('maps arrow keys', () => {
      expect(hooks._vkToCode(0x25)).toBe('ArrowLeft');
      expect(hooks._vkToCode(0x26)).toBe('ArrowUp');
      expect(hooks._vkToCode(0x27)).toBe('ArrowRight');
      expect(hooks._vkToCode(0x28)).toBe('ArrowDown');
    });

    it('returns KeyXXX for unknown', () => {
      expect(hooks._vkToCode(0xFF)).toBe('Key255');
    });
  });

  describe('state management', () => {
    it('starts in stopped state', () => {
      expect(hooks.running).toBe(false);
      expect(hooks.mouseHook).toBeNull();
      expect(hooks.keyboardHook).toBeNull();
    });

    it('stop clears hooks and callbacks', () => {
      hooks.running = true;
      hooks.mouseHook = 'mock';
      hooks.keyboardHook = 'mock';
      hooks._mouseCallback = vi.fn();
      hooks._keyboardCallback = vi.fn();

      hooks.stop();

      expect(hooks.running).toBe(false);
      expect(hooks.mouseHook).toBeNull();
      expect(hooks.keyboardHook).toBeNull();
      expect(hooks._mouseCallback).toBeNull();
      expect(hooks._keyboardCallback).toBeNull();
    });

    it('stop is idempotent', () => {
      hooks.stop();
      expect(hooks.running).toBe(false);
    });
  });
});

describe('WindowTracker', () => {
  let tracker;

  beforeEach(() => {
    tracker = new WindowTracker();
  });

  it('setMasterWindow stores handle and pid', () => {
    tracker.setMasterWindow(12345, 67890);
    expect(tracker.masterHwnd).toBe(12345);
    expect(tracker.masterPid).toBe(67890);
  });

  it('registerWindow stores profile info', () => {
    tracker.registerWindow('p1', 111, 222);
    expect(tracker.windowHandles.get('p1')).toEqual({ hwnd: 111, pid: 222 });
  });

  it('unregisterWindow removes profile', () => {
    tracker.registerWindow('p1', 111, 222);
    tracker.unregisterWindow('p1');
    expect(tracker.windowHandles.has('p1')).toBe(false);
  });

  it('clear resets all state', () => {
    tracker.setMasterWindow(12345, 67890);
    tracker.registerWindow('p1', 111, 222);
    tracker.clear();
    expect(tracker.masterHwnd).toBeNull();
    expect(tracker.windowHandles.size).toBe(0);
  });

  it('getProfileIdByPid finds profile', () => {
    tracker.registerWindow('p1', 111, 222);
    tracker.registerWindow('p2', 333, 444);
    expect(tracker.getProfileIdByPid(222)).toBe('p1');
    expect(tracker.getProfileIdByPid(444)).toBe('p2');
    expect(tracker.getProfileIdByPid(999)).toBeNull();
  });

  it('getProfileIdByHwnd finds profile', () => {
    tracker.registerWindow('p1', 111, 222);
    expect(tracker.getProfileIdByHwnd(111)).toBe('p1');
    expect(tracker.getProfileIdByHwnd(999)).toBeNull();
  });

  it('isMasterFocused returns false without master', () => {
    expect(tracker.isMasterFocused()).toBe(false);
  });
});
