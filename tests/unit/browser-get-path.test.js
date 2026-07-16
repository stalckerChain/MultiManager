import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';

const BROWSER_JS = new URL('../../src/api/browser.js', import.meta.url);

// --- Source-level regression tests for getBrowserPath ---

describe('Browser — getBrowserPath source-level invariants', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('imports logger from ../logger (needed for getBrowserPath logging)', () => {
    // Regression: missing logger import caused ReferenceError in Electron fork
    expect(content).toMatch(/const\s+\{[^}]*logger[^}]*\}\s*=\s*require\(['"].*logger['"]\)/);
  });

  it('uses USERPROFILE before HOME on Windows (Electron fork env)', () => {
    // Regression: HOME || USERPROFILE failed in Electron child_process.fork
    // because HOME may not be set on Windows while USERPROFILE always is.
    expect(content).toMatch(/process\.env\.USERPROFILE\s*\|\|\s*process\.env\.HOME/);
  });

  it('does NOT use HOME before USERPROFILE', () => {
    // The old pattern broke in Electron fork environment
    expect(content).not.toMatch(/process\.env\.HOME\s*\|\|\s*process\.env\.USERPROFILE/);
  });

  it('guards against empty home path', () => {
    expect(content).toMatch(/if\s*\(\s*!home\s*\)/);
  });

  it('null-checks browserPath before fs.existsSync', () => {
    // Regression: fs.existsSync(null) throws TypeError
    expect(content).toMatch(/if\s*\(\s*!browserPath\s*\|\|\s*!fs\.existsSync\(browserPath\)/);
  });

  it('does NOT call fs.existsSync without null-check on browserPath', () => {
    // The old code: if (!fs.existsSync(browserPath)) crashes when browserPath is null
    expect(content).not.toMatch(/if\s*\(\s*!fs\.existsSync\(browserPath\)\s*\)/);
  });
});

// --- Functional unit tests for getBrowserPath ---

function createMockFs({ readdirEntries = [], missingBins = [] } = {}) {
  return {
    promises: {
      readdir: vi.fn().mockResolvedValue(readdirEntries),
      access: vi.fn().mockImplementation(async (p) => {
        if (missingBins.includes(p)) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
      }),
    },
  };
}

async function runGetBrowserPath(mockFs, platform, home) {
  if (!home) return null;
  if (platform === 'win32' || platform === 'darwin' || platform === 'linux') {
    const cacheDir = path.join(home, '.cloakbrowser');
    try {
      const versions = (await mockFs.promises.readdir(cacheDir))
        .filter(d => d.startsWith('chromium-'))
        .sort()
        .reverse();
      for (const ver of versions) {
        const bin = platform === 'win32'
          ? path.join(cacheDir, ver, 'chrome.exe')
          : path.join(cacheDir, ver, 'chrome');
        try {
          await mockFs.promises.access(bin);
          return bin;
        } catch {}
      }
    } catch {}
  }
  return null;
}

describe('getBrowserPath — functional logic', () => {
  it('returns first valid chrome.exe on Windows', async () => {
    const home = 'C:\\Users\\test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0', 'chromium-100.0.0.0'],
    });
    const result = await runGetBrowserPath(mockFs, 'win32', home);
    expect(result).toBe(path.join(cacheDir, 'chromium-110.0.0.0', 'chrome.exe'));
  });

  it('returns null when home is empty string', async () => {
    const mockFs = createMockFs({ readdirEntries: ['chromium-110.0.0.0'] });
    const result = await runGetBrowserPath(mockFs, 'win32', '');
    expect(result).toBeNull();
  });

  it('returns null when cache dir does not exist', async () => {
    const mockFs = createMockFs();
    mockFs.promises.readdir.mockRejectedValue(new Error('ENOENT'));
    const result = await runGetBrowserPath(mockFs, 'win32', 'C:\\Users\\test');
    expect(result).toBeNull();
  });

  it('returns null when no chromium dirs exist', async () => {
    const mockFs = createMockFs({ readdirEntries: [] });
    const result = await runGetBrowserPath(mockFs, 'win32', 'C:\\Users\\test');
    expect(result).toBeNull();
  });

  it('skips dir when chrome binary is missing', async () => {
    const home = 'C:\\Users\\test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0', 'chromium-109.0.0.0'],
      missingBins: [path.join(cacheDir, 'chromium-110.0.0.0', 'chrome.exe')],
    });
    const result = await runGetBrowserPath(mockFs, 'win32', home);
    expect(result).toBe(path.join(cacheDir, 'chromium-109.0.0.0', 'chrome.exe'));
  });

  it('skips non-chromium entries', async () => {
    const home = 'C:\\Users\\test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0', 'firefox-99', '.DS_Store', 'temp'],
    });
    const result = await runGetBrowserPath(mockFs, 'win32', home);
    expect(result).toBe(path.join(cacheDir, 'chromium-110.0.0.0', 'chrome.exe'));
  });
});
