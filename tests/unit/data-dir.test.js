import { describe, it, expect, afterEach } from 'vitest';
import path from 'path';
import { getDataDir } from '../../src/core/data-dir';

const ENV = 'MULTIMANAGER_DATA_DIR';

let currentSaved = null;

function getEnv() {
  return {
    [ENV]: process.env[ENV],
    APPDATA: process.env.APPDATA,
    HOME: process.env.HOME,
    USERPROFILE: process.env.USERPROFILE,
  };
}

function restoreEnv(saved) {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

describe('data-dir resolver', () => {
  afterEach(() => restoreEnv(currentSaved));

  it('uses MULTIMANAGER_DATA_DIR when set', () => {
    currentSaved = getEnv();
    const expected = path.resolve('C:\\custom\\data');
    process.env[ENV] = 'C:\\custom\\data';
    expect(getDataDir()).toBe(expected);
  });

  it('accepts a nontrivial absolute path with separators', () => {
    currentSaved = getEnv();
    process.env[ENV] = 'D:\\some dir\\nested';
    expect(getDataDir()).toBe(path.resolve('D:\\some dir\\nested'));
  });

  it('rejects a relative MULTIMANAGER_DATA_DIR with an Error', () => {
    currentSaved = getEnv();
    process.env[ENV] = 'relative\\path';
    expect(() => getDataDir()).toThrow(/absolute/i);
  });

  it('rejects an empty string MULTIMANAGER_DATA_DIR with an Error', () => {
    currentSaved = getEnv();
    process.env[ENV] = '';
    expect(() => getDataDir()).toThrow(/absolute/i);
  });

  it('fallback contains MultiManager', () => {
    currentSaved = getEnv();
    delete process.env[ENV];
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    process.env.HOME = 'C:\\Users\\test';
    process.env.USERPROFILE = 'C:\\Users\\test';
    const dir = getDataDir();
    expect(dir).toContain('MultiManager');
    expect(dir).not.toContain('CloakManager');
  });

  it('fallback is deterministic on win32', () => {
    currentSaved = getEnv();
    delete process.env[ENV];
    process.env.APPDATA = 'C:\\Users\\test\\AppData\\Roaming';
    const a = getDataDir();
    const b = getDataDir();
    expect(a).toBe(b);
    expect(a).toBe(path.join(process.env.APPDATA, 'MultiManager'));
  });

  it('does not cache the result across env changes', () => {
    currentSaved = getEnv();
    process.env[ENV] = 'C:\\first\\dir';
    const first = getDataDir();
    process.env[ENV] = 'C:\\second\\dir';
    const second = getDataDir();
    expect(first).toBe(path.resolve('C:\\first\\dir'));
    expect(second).toBe(path.resolve('C:\\second\\dir'));
    expect(first).not.toBe(second);
  });
});