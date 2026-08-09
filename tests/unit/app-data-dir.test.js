import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';
import { canonicalUserData, APP_NAME } from '../../gui/src/main/app-data-dir.js';

function makeFakeApp(appDataPath) {
  return {
    getPath: (name) => {
      if (name === 'appData') return appDataPath;
      throw new Error(`unexpected getPath(${name})`);
    },
  };
}

describe('app-data-dir canonicalUserData', () => {
  it('builds appData/MultiManager from the mocked app', () => {
    const app = makeFakeApp('C:\\Users\\test\\AppData\\Roaming');
    expect(canonicalUserData(app)).toBe(
      path.join('C:\\Users\\test\\AppData\\Roaming', 'MultiManager')
    );
  });

  it('uses path.join and keeps a single app folder name', () => {
    const app = makeFakeApp('/home/test/.config');
    const result = canonicalUserData(app);
    expect(result).toBe(path.join('/home/test/.config', 'MultiManager'));
    expect(result).toContain('MultiManager');
    expect(result).not.toContain('CloakManager');
    expect(result).not.toContain('multimanager-gui');
  });

  it('APP_NAME is the single canonical folder name', () => {
    expect(APP_NAME).toBe('MultiManager');
  });
});

describe('app-data-dir static order in index.js', () => {
  const indexSrc = fs.readFileSync(
    path.join(__dirname, '..', '..', 'gui', 'src', 'main', 'index.js'),
    'utf8'
  );

  it('calls app.setPath(userData, canonicalUserData(app))', () => {
    expect(indexSrc).toContain("app.setPath('userData', canonicalUserData(app))");
  });

  it('does the setPath before requiring ./core-manager', () => {
    const setPathPos = indexSrc.indexOf("app.setPath('userData', canonicalUserData(app))");
    const coreManagerPos = indexSrc.indexOf("require('./core-manager')");
    expect(setPathPos).toBeGreaterThanOrEqual(0);
    expect(coreManagerPos).toBeGreaterThan(setPathPos);
  });

  it('requires ./app-data-dir near the top of the file', () => {
    const helperPos = indexSrc.indexOf("require('./app-data-dir')");
    const coreManagerPos = indexSrc.indexOf("require('./core-manager')");
    expect(helperPos).toBeGreaterThanOrEqual(0);
    expect(helperPos).toBeLessThan(coreManagerPos);
  });

  it('the canonical path is built through canonicalUserData (no hardcoded guesses)', () => {
    const helperSrc = fs.readFileSync(
      path.join(__dirname, '..', '..', 'gui', 'src', 'main', 'app-data-dir.js'),
      'utf8'
    );
    expect(helperSrc).toContain('path.join');
    expect(helperSrc).toContain("app.getPath('appData')");
    expect(helperSrc).toContain("'MultiManager'");
    expect(helperSrc).not.toContain('multimanager-gui');
  });
});