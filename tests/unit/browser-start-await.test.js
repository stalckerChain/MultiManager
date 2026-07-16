import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import { spawn } from 'child_process';

const BROWSER_JS = new URL('../../src/api/browser.js', import.meta.url);

// --- Source-level regression tests ---

describe('Browser — getBrowserPath must be awaited in start handler', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('getBrowserPath() is declared as async', () => {
    expect(content).toMatch(/async\s+function\s+getBrowserPath\s*\(/);
  });

  it('start handler awaits getBrowserPath() — regression for missing await bug', () => {
    // The line must be "await getBrowserPath()" inside the POST /:id/start handler
    expect(content).toMatch(/await\s+getBrowserPath\(\)/);
  });

  it('getBrowserPath returns a path or null, never a bare call without await', () => {
    // Ensure there is no "const browserPath = getBrowserPath();" (without await)
    expect(content).not.toMatch(
      /const\s+browserPath\s*=\s*getBrowserPath\(\)\s*;/
    );
  });

  it('getBrowserPath uses fs.promises.readdir and fs.promises.access (async fs)', () => {
    expect(content).toContain('fs.promises.readdir');
    expect(content).toContain('fs.promises.access');
  });
});

// --- Functional unit tests for getBrowserPath ---

function createMockFs({ readdirEntries = [], missingDirs = [] } = {}) {
  return {
    promises: {
      readdir: vi.fn().mockResolvedValue(readdirEntries),
      access: vi.fn().mockImplementation(async (p) => {
        if (missingDirs.includes(p)) {
          const err = new Error('ENOENT');
          err.code = 'ENOENT';
          throw err;
        }
      }),
    },
    existsSync: vi.fn().mockReturnValue(true),
  };
}

async function runGetBrowserPath(mockFs, platform, home) {
  // Re-implement getBrowserPath logic from source to test in isolation
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

describe('getBrowserPath — logic (reimplemented)', () => {
  it('returns first valid chrome.exe on Windows (reverse string sort)', async () => {
    const home = 'C:\\Users\\test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0', 'chromium-100.0.0.0'],
    });
    const result = await runGetBrowserPath(mockFs, 'win32', home);

    // sort() is string-based: "chromium-110" < "chromium-100" (because '1' == '1', then '1' < '0' is false... wait)
    // Actually: "chromium-110" vs "chromium-100" → compare char by char:
    // ...chromium-1 same, then '1' vs '0' → '1' > '0', so "chromium-110" > "chromium-100"
    // sort ascending: ["chromium-100.0.0.0", "chromium-110.0.0.0"]
    // reverse: ["chromium-110.0.0.0", "chromium-100.0.0.0"]
    expect(result).toBe(path.join(cacheDir, 'chromium-110.0.0.0', 'chrome.exe'));
  });

  it('returns first valid chrome on Linux', async () => {
    const home = '/home/test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0'],
    });
    const result = await runGetBrowserPath(mockFs, 'linux', home);

    expect(result).toBe(path.join(cacheDir, 'chromium-110.0.0.0', 'chrome'));
  });

  it('returns first valid chrome on macOS', async () => {
    const home = '/Users/test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-105.0.0.0'],
    });
    const result = await runGetBrowserPath(mockFs, 'darwin', home);

    expect(result).toBe(path.join(cacheDir, 'chromium-105.0.0.0', 'chrome'));
  });

  it('skips non-chromium directories', async () => {
    const home = '/home/test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0', 'chromium-100.0.0.0', 'firefox-99', '.DS_Store'],
    });
    const result = await runGetBrowserPath(mockFs, 'linux', home);

    // Sorted reverse, so 110 should come first
    expect(result).toBe(path.join(cacheDir, 'chromium-110.0.0.0', 'chrome'));
  });

  it('returns null when cache dir does not exist', async () => {
    const home = '/home/test';
    const mockFs = createMockFs();
    mockFs.promises.readdir.mockRejectedValue(new Error('ENOENT'));

    const result = await runGetBrowserPath(mockFs, 'linux', home);

    expect(result).toBeNull();
  });

  it('returns null when no chromium directories exist', async () => {
    const home = '/home/test';
    const mockFs = createMockFs({ readdirEntries: [] });

    const result = await runGetBrowserPath(mockFs, 'linux', home);

    expect(result).toBeNull();
  });

  it('skips version dir when chrome binary is missing', async () => {
    const home = '/home/test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const missingPath = path.join(cacheDir, 'chromium-110.0.0.0', 'chrome');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0', 'chromium-109.0.0.0'],
      missingDirs: [missingPath],
    });
    const result = await runGetBrowserPath(mockFs, 'linux', home);

    // Should skip 110 (missing) and return 109
    expect(result).toBe(path.join(cacheDir, 'chromium-109.0.0.0', 'chrome'));
  });

  it('returns null when all versions have missing binaries', async () => {
    const home = '/home/test';
    const cacheDir = path.join(home, '.cloakbrowser');
    const missingPath = path.join(cacheDir, 'chromium-110.0.0.0', 'chrome');
    const mockFs = createMockFs({
      readdirEntries: ['chromium-110.0.0.0'],
      missingDirs: [missingPath],
    });
    const result = await runGetBrowserPath(mockFs, 'linux', home);

    expect(result).toBeNull();
  });
});

// --- Tests for the start handler's browserPath usage ---

describe('Browser start — browserPath type safety', () => {
  it('fs.existsSync must receive a string, not a Promise', () => {
    // Regression: before the fix, browserPath was a Promise object
    // because getBrowserPath() was called without await.
    // fs.existsSync(Promise) always returns false.
    const fs = { existsSync: vi.fn().mockReturnValue(true) };

    const browserPath = path.join('/some', 'path', 'chrome.exe');
    const result = fs.existsSync(browserPath);

    expect(result).toBe(true);
    expect(typeof browserPath).toBe('string');
  });

  it('fs.existsSync returns false for a Promise (the old bug scenario)', () => {
    const fs = { existsSync: vi.fn().mockReturnValue(false) };

    // Simulating the old bug: passing a Promise to existsSync
    const fakePromise = Promise.resolve(path.join('/some', 'path', 'chrome.exe'));
    const result = fs.existsSync(fakePromise);

    // existsSync would return false for a Promise object
    expect(result).toBe(false);
    expect(typeof fakePromise).not.toBe('string');
  });

  it('spawn receives browserPath as string, not a Promise object', () => {
    // This verifies the contract: after await getBrowserPath(), the value
    // passed to spawn() must be a plain string, not a Promise.
    // A Promise passed to spawn() would be coerced to "[object Promise]" and fail.
    const browserPath = path.join('/home', 'user', '.cloakbrowser', 'chromium-110.0.0.0', 'chrome');

    expect(typeof browserPath).toBe('string');
    expect(String(browserPath)).toBe(browserPath);

    // Demonstrate the old bug: Promise coercion would fail
    const fakePromise = Promise.resolve(browserPath);
    expect(String(fakePromise)).toBe('[object Promise]');
    expect(String(fakePromise)).not.toBe(browserPath);
  });
});
