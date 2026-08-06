import { describe, it, expect, vi } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';

import {
  activateMainWindow,
} from '../../gui/src/main/main-window-utils.js';
import {
  resolveTrayResources,
  resolveResourcesPath,
  pickIconFormat,
  ICONS,
} from '../../gui/src/main/tray-paths.js';

function makeFakeWindow({ minimized = false, destroyed = false } = {}) {
  const calls = { restore: 0, show: 0, focus: 0 };
  const win = {
    isMinimized: vi.fn(() => minimized),
    isDestroyed: vi.fn(() => destroyed),
    restore: vi.fn(() => { calls.restore += 1; }),
    show: vi.fn(() => { calls.show += 1; }),
    focus: vi.fn(() => { calls.focus += 1; }),
  };
  return { win, calls };
}

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'mm-tray-'));
}

describe('activateMainWindow', () => {
  it('returns false and does nothing for null window', () => {
    const hidden = vi.fn();
    const result = activateMainWindow(hidden);
    expect(result).toBe(false);
    expect(hidden).not.toHaveBeenCalled();
  });

  it('returns false for a destroyed window', () => {
    const { win } = makeFakeWindow({ destroyed: true });
    expect(activateMainWindow(win)).toBe(false);
    expect(win.show).not.toHaveBeenCalled();
  });

  it('restores a minimized window, then shows and focuses it', () => {
    const { win, calls } = makeFakeWindow({ minimized: true });
    expect(activateMainWindow(win)).toBe(true);
    expect(win.restore).toHaveBeenCalledTimes(1);
    expect(calls.show).toBe(1);
    expect(calls.focus).toBe(1);
  });

  it('does not call restore for a non-minimized window', () => {
    const { win, calls } = makeFakeWindow({ minimized: false });
    expect(activateMainWindow(win)).toBe(true);
    expect(win.restore).not.toHaveBeenCalled();
    expect(calls.show).toBe(1);
    expect(calls.focus).toBe(1);
  });
});

describe('resolveTrayResources', () => {
  let dir;
  beforeEach(() => { dir = tempDir(); });
  afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }); });

  it('selects ICO on win32 when it exists', () => {
    fs.writeFileSync(path.join(dir, 'tray-icon.ico'), 'x');
    const r = resolveTrayResources({ resourcesDir: dir, platform: 'win32' });
    expect(r.present).toBe(true);
    expect(r.fallback).toBe(false);
    expect(r.format).toBe('ico');
    expect(r.iconPath).toBe(path.join(dir, ICONS.ico));
  });

  it('falls back to png on win32 when ico is missing', () => {
    fs.writeFileSync(path.join(dir, 'tray-icon.png'), 'x');
    const r = resolveTrayResources({ resourcesDir: dir, platform: 'win32' });
    expect(r.present).toBe(true);
    expect(r.fallback).toBe(true);
    expect(r.format).toBe('png');
    expect(r.iconPath).toBe(path.join(dir, ICONS.png));
  });

  it('reports not present when neither file exists', () => {
    const r = resolveTrayResources({ resourcesDir: dir, platform: 'win32' });
    expect(r.present).toBe(false);
    expect(r.primaryExists).toBe(false);
    expect(r.altExists).toBe(false);
  });

  it('selects png on non-win32 platforms', () => {
    fs.writeFileSync(path.join(dir, 'tray-icon.png'), 'x');
    const r = resolveTrayResources({ resourcesDir: dir, platform: 'darwin' });
    expect(r.present).toBe(true);
    expect(r.fallback).toBe(false);
    expect(r.format).toBe('png');
    expect(r.iconPath).toBe(path.join(dir, ICONS.png));
  });

  it('honours an injected exists checker', () => {
    const exists = vi.fn(() => true);
    const r = resolveTrayResources({ resourcesDir: dir, platform: 'linux', exists });
    expect(r.present).toBe(true);
    expect(exists).toHaveBeenCalled();
  });
});

describe('tray icon resource path', () => {
  it('pickIconFormat returns ico for win32 and png otherwise', () => {
    expect(pickIconFormat('win32')).toBe('ico');
    expect(pickIconFormat('darwin')).toBe('png');
    expect(pickIconFormat('linux')).toBe('png');
  });

  it('resolveResourcesPath points at gui/resources and tray icons exist', () => {
    const dir = resolveResourcesPath();
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(path.join(dir, ICONS.ico))).toBe(true);
    expect(fs.existsSync(path.join(dir, ICONS.png))).toBe(true);
  });
});