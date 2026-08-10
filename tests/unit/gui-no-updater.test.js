import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GUI_ROOT = path.resolve(__dirname, '..', '..', 'gui');

function read(file) {
  return readFileSync(path.join(GUI_ROOT, file), 'utf-8');
}

describe('GUI — Electron auto-updater fully removed', () => {
  it('gui/src/main/index.js does not import or call the updater', () => {
    const content = read('src/main/index.js');
    expect(content).not.toMatch(/updater/i);
    expect(content).not.toContain('checkForUpdates');
    expect(content).not.toContain('autoUpdater');
  });

  it('gui/src/main/updater.js file no longer exists', () => {
    expect(existsSync(path.join(GUI_ROOT, 'src', 'main', 'updater.js'))).toBe(false);
  });

  it('gui/src/preload/index.js exposes no update events', () => {
    const content = read('src/preload/index.js');
    expect(content).not.toContain('onUpdateAvailable');
    expect(content).not.toContain('onUpdateDownloaded');
    expect(content).not.toMatch(/update-available/);
    expect(content).not.toMatch(/update-downloaded/);
  });

  it('gui/package.json has no electron-updater dependency', () => {
    const content = read('package.json');
    expect(content).not.toContain('electron-updater');
  });

  it('gui/package-lock.json has no electron-updater entry', () => {
    const content = read('package-lock.json');
    expect(content).not.toContain('electron-updater');
  });

  it('electron-builder config has no publish/update provider settings', () => {
    const content = read('package.json');
    // Нет runtime-настроек, инициирующих auto-update (publish provider, feed URL).
    expect(content).not.toMatch(/"publish"\s*:/);
    expect(content).not.toMatch(/updateProvider|generic|GitHub Releases/i);
  });
});
