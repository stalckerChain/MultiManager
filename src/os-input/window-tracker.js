const koffi = require('koffi');
const { logger } = require('../logger');

const user32 = koffi.load('user32.dll');
const kernel32 = koffi.load('kernel32.dll');

const GetForegroundWindow = user32.func('GetForegroundWindow', 'void*', []);
const GetWindowThreadProcessId = user32.func('GetWindowThreadProcessId', 'uint32', ['void*', 'uint32*']);
const GetWindowTextW = user32.func('GetWindowTextW', 'int', ['void*', 'uint16*', 'int']);
const IsWindow = user32.func('IsWindow', 'int', ['void*']);

class WindowTracker {
  constructor() {
    this.masterHwnd = null;
    this.masterPid = null;
    this.windowHandles = new Map();
  }

  setMasterWindow(hwnd, pid) {
    this.masterHwnd = hwnd;
    this.masterPid = pid;
    logger.info({ hwnd: hwnd?.toString(), pid }, 'OS-INPUT: Master window tracked');
  }

  registerWindow(profileId, hwnd, pid) {
    this.windowHandles.set(profileId, { hwnd, pid });
    logger.info({ profileId, hwnd: hwnd?.toString(), pid }, 'OS-INPUT: Window registered');
  }

  unregisterWindow(profileId) {
    this.windowHandles.delete(profileId);
  }

  getForegroundWindowInfo() {
    const hwnd = GetForegroundWindow();
    if (!hwnd) return null;

    const pidBuf = koffi.alloc('uint32', 1);
    GetWindowThreadProcessId(hwnd, pidBuf);
    const pid = koffi.decode(pidBuf, 'uint32');

    const titleBuf = koffi.alloc('uint16', 256);
    GetWindowTextW(hwnd, titleBuf, 256);
    const title = koffi.decode(titleBuf, 'string', 256);

    return { hwnd, pid, title };
  }

  isMasterFocused() {
    if (!this.masterPid) return false;

    const fg = this.getForegroundWindowInfo();
    if (!fg) return false;

    return fg.pid === this.masterPid;
  }

  getProfileIdByHwnd(hwnd) {
    for (const [profileId, info] of this.windowHandles) {
      if (info.hwnd === hwnd) return profileId;
    }
    return null;
  }

  getProfileIdByPid(pid) {
    for (const [profileId, info] of this.windowHandles) {
      if (info.pid === pid) return profileId;
    }
    return null;
  }

  clear() {
    this.masterHwnd = null;
    this.masterPid = null;
    this.windowHandles.clear();
  }
}

const windowTracker = new WindowTracker();

module.exports = { WindowTracker, windowTracker };
