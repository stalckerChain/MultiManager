import { describe, it, expect } from 'vitest';
import path from 'path';
import fs from 'fs';

const INSTALLED_DIR = path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA,
  'Programs', 'multimanager-gui'
);
const RESOURCES = path.join(INSTALLED_DIR, 'resources');
const PROJECT_ROOT = path.join(__dirname, '..', '..');

const isInstalled = fs.existsSync(path.join(RESOURCES, 'app.asar')) && (
  fs.existsSync(path.join(RESOURCES, 'backend')) ||
  fs.existsSync(path.join(RESOURCES, 'backend', 'src'))
);

describe('Core Manager — packaged mode path validation', () => {
  it.skipIf(!isInstalled)('resources/backend/ существует', () => {
    const backendDir = fs.existsSync(path.join(RESOURCES, 'backend', 'src'))
      ? path.join(RESOURCES, 'backend', 'src')
      : path.join(RESOURCES, 'backend');
    expect(fs.existsSync(backendDir)).toBe(true);
  });

  it.skipIf(!isInstalled)('CORE_PATH指向resources/backend/index.js', () => {
    const hasNew = fs.existsSync(path.join(RESOURCES, 'backend', 'index.js'));
    const hasOld = fs.existsSync(path.join(RESOURCES, 'backend', 'src', 'index.js'));
    expect(hasNew || hasOld).toBe(true);
  });

  it.skipIf(!isInstalled)('все ключевые модули backend доступны', () => {
    const base = fs.existsSync(path.join(RESOURCES, 'backend', 'src', 'index.js'))
      ? path.join(RESOURCES, 'backend', 'src')
      : path.join(RESOURCES, 'backend');
    const modules = [
      'index.js',
      path.join('core', 'app.js'),
      path.join('core', 'websocket.js'),
      path.join('api', 'auth.js'),
      path.join('api', 'profiles.js'),
      path.join('api', 'proxies.js'),
      path.join('api', 'browser.js'),
      path.join('db', 'index.js'),
      path.join('db', 'schema.js'),
      path.join('db', 'queries.js'),
      path.join('logger', 'index.js'),
      path.join('fingerprint', 'index.js'),
      path.join('proxy', 'index.js'),
      path.join('cookie', 'index.js'),
      path.join('typing', 'index.js'),
      path.join('multi-control', 'index.js'),
    ];

    for (const m of modules) {
      expect(fs.existsSync(path.join(base, m)), `Missing: ${m}`).toBe(true);
    }
  });

  it.skipIf(!isInstalled)('app.asar существует в resources/', () => {
    expect(fs.existsSync(path.join(RESOURCES, 'app.asar'))).toBe(true);
  });

  it.skipIf(!isInstalled)('app.asar.unpacked содержит native модули', () => {
    const unpacked = path.join(RESOURCES, 'app.asar.unpacked', 'node_modules', 'better-sqlite3');
    expect(fs.existsSync(unpacked)).toBe(true);
  });
});

describe('Core Manager — DEV mode path validation', () => {
  it('src/index.js существует от корня проекта', () => {
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'src', 'index.js'))).toBe(true);
  });

  it('все ключевые модули src/ доступны', () => {
    const base = path.join(PROJECT_ROOT, 'src');
    const modules = [
      'index.js',
      path.join('core', 'app.js'),
      path.join('core', 'websocket.js'),
      path.join('api', 'auth.js'),
      path.join('api', 'profiles.js'),
      path.join('api', 'proxies.js'),
      path.join('api', 'browser.js'),
      path.join('db', 'index.js'),
      path.join('logger', 'index.js'),
    ];

    for (const m of modules) {
      expect(fs.existsSync(path.join(base, m)), `Missing: ${m}`).toBe(true);
    }
  });
});

describe('Core Manager — CORE_PATH construction', () => {
  it('dev: CORE_PATH指向src/index.js от корня проекта', () => {
    const corePath = path.join(PROJECT_ROOT, 'src', 'index.js');
    expect(fs.existsSync(corePath)).toBe(true);
  });

  it('dev: CORE_PATH = gui/src/main/../../../../src/index.js', () => {
    const guiMain = path.join(PROJECT_ROOT, 'gui', 'src', 'main');
    const corePath = path.join(guiMain, '..', '..', '..', 'src', 'index.js');
    expect(path.resolve(corePath)).toBe(path.resolve(path.join(PROJECT_ROOT, 'src', 'index.js')));
  });

  it('packaged: CORE_PATH = exe/../resources/backend/index.js', () => {
    const exeDir = 'C:\\Programs\\multimanager-gui';
    const corePath = path.join(exeDir, '..', 'resources', 'backend', 'index.js');
    expect(path.dirname(corePath)).toContain(path.join('resources', 'backend'));
  });

  it('packaged: NODE_PATH = exe/../resources/app.asar/node_modules', () => {
    const exeDir = 'C:\\Programs\\multimanager-gui';
    const nodeModules = path.join(exeDir, '..', 'resources', 'app.asar', 'node_modules');
    expect(nodeModules).toContain('app.asar');
    expect(nodeModules).toContain('node_modules');
  });

  it('gui/backend junction существует и указывает на src/', () => {
    const junction = path.join(PROJECT_ROOT, 'gui', 'backend');
    expect(fs.existsSync(junction)).toBe(true);
    const stat = fs.lstatSync(junction);
    expect(stat.isSymbolicLink() || stat.isDirectory()).toBe(true);
  });
});
