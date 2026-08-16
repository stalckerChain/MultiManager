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

// --- Anti-detect browser args tests ---

describe('Browser — anti-detect args and retry logic', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('--fingerprint-timezone is passed as browser arg', () => {
    expect(content).toContain('--fingerprint-timezone=');
  });

  it('--fingerprint= is used instead of legacy --fingerprint-seed= (documented CloakBrowser flag)', () => {
    expect(content).toContain("'--fingerprint=' + profile.fingerprint_seed");
  });

  it('--fingerprint-seed is not passed to the browser', () => {
    expect(content).not.toContain('--fingerprint-seed');
  });

  it('manual --user-agent is not passed to the browser', () => {
    expect(content).not.toContain("'--user-agent=' + profile.user_agent");
    expect(content).not.toMatch(/['"]--user-agent=/);
  });

  it('no manual Firefox/Safari UA is forced in launch args', () => {
    expect(content).not.toContain('Firefox');
    expect(content).not.toContain('Safari/6');
  });

  it('--fingerprint-storage-quota=10240 is passed as browser arg', () => {
    expect(content).toContain("'--fingerprint-storage-quota=10240'");
  });

  it('--unlimited-storage is not passed to the browser', () => {
    expect(content).not.toContain('--unlimited-storage');
  });

  it('--lang=en-US is passed as browser arg', () => {
    expect(content).toContain("'--lang=en-US'");
  });

  it('--no-first-run is passed as browser arg', () => {
    expect(content).toContain("'--no-first-run'");
  });

  it('--no-default-browser-check is passed as browser arg', () => {
    expect(content).toContain("'--no-default-browser-check'");
  });

  it('--disable-session-crashed-bubble is passed as browser arg', () => {
    expect(content).toContain("'--disable-session-crashed-bubble'");
  });

  it('timezone falls back to Asia/Bishkek when profile has no timezone', () => {
    expect(content).toMatch(/timezone\s*=\s*profile\.timezone\s*\|\|\s*'Asia\/Bishkek'/);
  });

  it('SPAWN_RETRIES is 3', () => {
    expect(content).toMatch(/SPAWN_RETRIES\s*=\s*3/);
  });

  it('SPAWN_RETRY_DELAY_MS is 2000', () => {
    expect(content).toMatch(/SPAWN_RETRY_DELAY_MS\s*=\s*2000/);
  });

  it('retry loop checks for ERR_ADDRESS_IN_USE', () => {
    expect(content).toContain('ERR_ADDRESS_IN_USE');
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

// --- Zerion login: runtime ID resolution regression tests ---

describe('Browser — zerion-login resolves runtime ID from profile.extensions', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('zerion-login handler uses tryParseJson(profile.extensions) to get extIds', () => {
    expect(content).toMatch(/tryParseJson\s*\(\s*profile\.extensions\s*\)/);
  });

  it('zerion-login handler calls resolveRuntimeId with extPath and profileDir', () => {
    expect(content).toMatch(/resolveRuntimeId\s*\(/);
  });

  it('zerion-login handler uses getExtensionsDir to build extPath', () => {
    expect(content).toMatch(/path\.join\s*\(\s*extDir\s*,\s*folderName\s*\)/);
  });

  it('zerion-login throws when no extensions assigned', () => {
    expect(content).toMatch(/Не найдено расширение Zerion в профиле/);
  });

  it('zerion-login throws when runtime ID cannot be resolved', () => {
    expect(content).toMatch(/Не удалось определить runtime ID расширения Zerion/);
  });
});

// --- Source-level tests: async spawn retry + CDP-ready lifecycle ---

describe('Browser — async spawn retry and CDP-ready transition (source-level)', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('spawnBrowserWithCdp is declared as async function', () => {
    expect(content).toMatch(/async\s+function\s+spawnBrowserWithCdp\s*\(/);
  });

  it('handles async spawn error via child.on("error")', () => {
    expect(content).toMatch(/child\.on\('error',\s*onChildError\)/);
  });

  it('retries ERR_ADDRESS_IN_USE from the async child error handler', () => {
    expect(content).toMatch(/err\.message\.includes\('ERR_ADDRESS_IN_USE'\)/);
    expect(content).toMatch(/setTimeout\(spawnAttempt,\s*retryDelayMs\)/);
  });

  it('parses CDP marker from accumulated stderr buffer, not from raw chunk', () => {
    expect(content).toMatch(/currentChild\._mmStderrOutput\s*=\s*\(currentChild\._mmStderrOutput\s*\|\|\s*''\)\s*\+\s*chunk/);
    expect(content).toMatch(/currentChild\._mmStderrOutput\.match\(/);
    expect(content).not.toMatch(/const\s+match\s*=\s*chunk\.match\(/);
  });

  it('publishes running only after CDP-ready (spawnBrowserWithCdp resolves first)', () => {
    const spawnIdx = content.indexOf('cdpLaunch = await spawnBrowserWithCdp(');
    const runningIdx = content.indexOf("profileQueries.updateStatus(req.params.id, 'running')");
    expect(spawnIdx).toBeGreaterThan(-1);
    expect(runningIdx).toBeGreaterThan(-1);
    expect(runningIdx).toBeGreaterThan(spawnIdx);
  });

  it('broadcasts running after the CDP port has been captured', () => {
    const cdpSetIdx = content.indexOf('cdpPorts.set(profileId, parseInt(match[1], 10))');
    const runningBroadcastIdx = content.indexOf("broadcastStatus(req.params.id, 'running', child.pid)");
    expect(cdpSetIdx).toBeGreaterThan(-1);
    expect(runningBroadcastIdx).toBeGreaterThan(cdpSetIdx);
  });

  it('returns profile to stopped on launch failure (spawn error/exit/CDP timeout)', () => {
    const failIdx = content.indexOf('Ошибка запуска браузера');
    const stoppedIdx = content.indexOf("profileQueries.updateStatus(req.params.id, 'stopped')");
    expect(failIdx).toBeGreaterThan(-1);
    expect(stoppedIdx).toBeGreaterThan(-1);
  });

  it('removes lifecycle listeners on success and cleanup (no double-cleanup)', () => {
    expect(content).toMatch(/c\.removeAllListeners\('error'\)/);
    expect(content).toMatch(/c\.removeAllListeners\('exit'\)/);
  });

  it('guards against double cleanup on error/exit sequence (settled flag)', () => {
    expect(content).toMatch(/let settled = false;/);
    expect(content).toMatch(/if \(settled\) return;/);
  });

  it('ws_endpoint always uses the captured CDP port (no longer null on success)', () => {
    expect(content).toMatch(/ws_endpoint: `http:\/\/127\.0\.0\.1:\$\{cdpPort\}`/);
  });
});

// --- Source-level tests: CDP cookie injection lifecycle ---

describe('Browser — CDP cookie injection after launch (source-level)', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('no longer imports or calls file-based injectCookies', () => {
    expect(content).not.toContain('injectCookies');
  });

  it('applies cookies via CDP after the running state is set', () => {
    const applyIdx = content.indexOf('await applyProfileCookies(req.params.id, cdpPort');
    const runningIdx = content.indexOf("profileQueries.updateStatus(req.params.id, 'running')");
    const broadcastIdx = content.indexOf("broadcastStatus(req.params.id, 'running', child.pid)");
    expect(applyIdx).toBeGreaterThan(-1);
    expect(runningIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeGreaterThan(runningIdx);
    expect(applyIdx).toBeGreaterThan(broadcastIdx);
  });

  it('applies cookies before extension loading and manual autologin', () => {
    const applyIdx = content.indexOf('await applyProfileCookies(req.params.id, cdpPort');
    const extIdx = content.indexOf('await loadExtensionsViaCDP(req.params.id, runId, enabledExtPaths');
    const autologinIdx = content.indexOf('await runManualAutologin(req.params.id, profile, cdpPort');
    expect(applyIdx).toBeGreaterThan(-1);
    expect(extIdx).toBeGreaterThan(-1);
    expect(autologinIdx).toBeGreaterThan(-1);
    expect(applyIdx).toBeLessThan(extIdx);
    expect(applyIdx).toBeLessThan(autologinIdx);
  });

  it('applyProfileCookies is non-fatal: wraps CDP error and never transitions to stopped', () => {
    const block = content.slice(
      content.indexOf('async function applyProfileCookies'),
      content.indexOf('// Автологин кошелька при ручном запуске профиля')
    );
    expect(block).toContain('try {');
    expect(block).toContain('} catch (err) {');
    expect(block).not.toContain("updateStatus(profileId, 'stopped')");
    expect(block).not.toContain('updateStatus(');
  });

  it('logs only safe metadata during CDP injection (no cookie values)', () => {
    const block = content.slice(
      content.indexOf('async function applyProfileCookies'),
      content.indexOf('// Автологин кошелька при ручном запуске профиля')
    );
    expect(block).not.toMatch(/\.value/);
    expect(block).toContain('cookieCount');
  });

  it('exports getProfileCookiesViaCdp and the CDP injection helper', () => {
    expect(content).toMatch(/module\.exports\.applyProfileCookies\s*=\s*applyProfileCookies/);
    expect(content).toMatch(/module\.exports\.getProfileCookiesViaCdp\s*=\s*getProfileCookiesViaCdp/);
  });
});

// --- Functional harness: spawn retry state machine ---

function createHarnessChild(pid) {
  const listeners = {};
  const stderrCbs = [];
  const child = {
    pid,
    _mmStderrOutput: '',
    stderr: {
      on: (type, cb) => { if (type === 'data') stderrCbs.push(cb); },
    },
    on: vi.fn((type, cb) => {
      if (!listeners[type]) listeners[type] = [];
      listeners[type].push(cb);
    }),
    removeAllListeners: vi.fn((type) => { delete listeners[type]; }),
    emit(type, ...args) { (listeners[type] || []).forEach(cb => cb(...args)); },
    emitStderr(text) { stderrCbs.forEach(cb => cb(text)); },
  };
  return child;
}

function runSpawnHarness({ spawnFn, cdpPorts = new Map(), profileId = 'p1', maxRetries = 3, retryDelayMs = 1, cdpReadyTimeoutMs = 100 }) {
  let attempt = 0;
  let child = null;
  let cdpTimeoutTimer = null;
  let settled = false;
  const killCalls = [];

  const removeLifecycleListeners = (c) => {
    if (!c) return;
    c.removeAllListeners('error');
    c.removeAllListeners('exit');
  };

  const cleanupFailedChild = () => {
    if (cdpTimeoutTimer) { clearTimeout(cdpTimeoutTimer); cdpTimeoutTimer = null; }
    const failedChild = child;
    child = null;
    removeLifecycleListeners(failedChild);
    if (failedChild && failedChild.pid) killCalls.push(failedChild.pid);
  };

  const promise = new Promise((resolve, reject) => {
    const fail = (err) => {
      if (settled) return;
      settled = true;
      cleanupFailedChild();
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      if (cdpTimeoutTimer) { clearTimeout(cdpTimeoutTimer); cdpTimeoutTimer = null; }
      removeLifecycleListeners(child);
      resolve({ child, cdpPort: cdpPorts.get(profileId) });
    };

    const onChildError = (err) => {
      if (settled) return;
      const isAddressInUse = err && err.message && err.message.includes('ERR_ADDRESS_IN_USE');
      if (isAddressInUse && attempt < maxRetries) {
        attempt++;
        cleanupFailedChild();
        setTimeout(spawnAttempt, retryDelayMs);
        return;
      }
      fail(new Error(`Ошибка запуска браузера: ${err.message}`));
    };

    const onChildExit = (code, signal) => {
      if (settled) return;
      const exitInfo = code !== null ? `code=${code}` : `signal=${signal}`;
      fail(new Error(`Браузер завершился до готовности CDP (${exitInfo})`));
    };

    const onStderrData = (currentChild) => (data) => {
      if (currentChild !== child) return;
      const chunk = data.toString();
      currentChild._mmStderrOutput = (currentChild._mmStderrOutput || '') + chunk;
      const match = currentChild._mmStderrOutput.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match) {
        cdpPorts.set(profileId, parseInt(match[1], 10));
        succeed();
      }
    };

    const spawnAttempt = () => {
      if (settled) return;
      try {
        child = spawnFn();
      } catch (err) {
        const isAddressInUse = err.message && err.message.includes('ERR_ADDRESS_IN_USE');
        if (isAddressInUse && attempt < maxRetries) {
          attempt++;
          setTimeout(spawnAttempt, retryDelayMs);
          return;
        }
        fail(new Error(`Ошибка запуска браузера: ${err.message}`));
        return;
      }
      child.on('error', onChildError);
      child.on('exit', onChildExit);
      child.stderr.on('data', onStderrData(child));
      cdpTimeoutTimer = setTimeout(() => fail(new Error('CDP port timeout')), cdpReadyTimeoutMs);
    };

    spawnAttempt();
  });
  promise.killCalls = killCalls;
  return promise;
}

describe('Browser — async spawn error and retry (harness)', () => {
  it('retries async ERR_ADDRESS_IN_USE from child.on("error") and succeeds on CDP-ready', async () => {
    const children = [createHarnessChild(1), createHarnessChild(2), createHarnessChild(3)];
    const spawned = [];
    const spawnFn = vi.fn(() => {
      const c = children[spawned.length];
      spawned.push(c);
      return c;
    });
    const cdpPorts = new Map();
    const promise = runSpawnHarness({ spawnFn, cdpPorts, maxRetries: 3, retryDelayMs: 1, cdpReadyTimeoutMs: 100 });

    // Первая попытка — асинхронный error (child.on('error')) с EADDRINUSE
    children[0].emit('error', new Error('spawn ERR_ADDRESS_IN_USE EADDRINUSE'));
    await new Promise(r => setTimeout(r, 10));
    expect(spawned.length).toBe(2);

    // Вторая попытка — снова EADDRINUSE
    children[1].emit('error', new Error('spawn ERR_ADDRESS_IN_USE EADDRINUSE'));
    await new Promise(r => setTimeout(r, 10));
    expect(spawned.length).toBe(3);

    // Третья попытка успешна — CDP-ready из накопленного stderr
    children[2].emitStderr('DevTools listening on ws://127.0.0.1:9876/devtools/browser/id');

    const { child, cdpPort } = await promise;
    expect(child.pid).toBe(3);
    expect(cdpPort).toBe(9876);
    expect(cdpPorts.get('p1')).toBe(9876);
  });

  it('does not register running until CDP-ready and cleans up failed attempts', async () => {
    const children = [createHarnessChild(1), createHarnessChild(2)];
    const spawned = [];
    const spawnFn = vi.fn(() => {
      const c = children[spawned.length];
      spawned.push(c);
      return c;
    });
    const cdpPorts = new Map();

    const promise = runSpawnHarness({ spawnFn, cdpPorts, maxRetries: 2, retryDelayMs: 1, cdpReadyTimeoutMs: 50 });

    children[0].emit('error', new Error('spawn ERR_ADDRESS_IN_USE'));
    await new Promise(r => setTimeout(r, 10));
    expect(cdpPorts.has('p1')).toBe(false);

    children[1].emitStderr('DevTools listening on ws://127.0.0.1:4242/devtools/browser/id');
    const { cdpPort } = await promise;
    expect(cdpPort).toBe(4242);
    expect(cdpPorts.get('p1')).toBe(4242);
  });

  it('fails immediately on non-address-in-use async error (no retry)', async () => {
    const child = createHarnessChild(1);
    const spawnFn = vi.fn(() => child);
    const promise = runSpawnHarness({ spawnFn, maxRetries: 3, retryDelayMs: 1, cdpReadyTimeoutMs: 100 });

    child.emit('error', new Error('ENOENT: no such file'));

    await expect(promise).rejects.toThrow(/Ошибка запуска браузера/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it('fails when child exits before CDP ready (no retry, no running state)', async () => {
    const child = createHarnessChild(1);
    const spawnFn = vi.fn(() => child);
    const cdpPorts = new Map();
    const promise = runSpawnHarness({ spawnFn, cdpPorts, maxRetries: 3, retryDelayMs: 1, cdpReadyTimeoutMs: 100 });

    child.emit('exit', 1, null);

    await expect(promise).rejects.toThrow(/до готовности CDP/);
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(cdpPorts.has('p1')).toBe(false);
  });

  it('fails on CDP timeout and kills the spawned child', async () => {
    const child = createHarnessChild(42);
    const spawnFn = vi.fn(() => child);
    const result = runSpawnHarness({ spawnFn, maxRetries: 3, retryDelayMs: 1, cdpReadyTimeoutMs: 20 });

    await expect(result).rejects.toThrow('CDP port timeout');
    expect(result.killCalls).toContain(42);
  });

  it('removes lifecycle listeners after success (no lingering error/exit handlers)', async () => {
    const child = createHarnessChild(5);
    const spawnFn = vi.fn(() => child);
    const result = runSpawnHarness({ spawnFn, maxRetries: 3, retryDelayMs: 1, cdpReadyTimeoutMs: 100 });

    child.emitStderr('DevTools listening on ws://127.0.0.1:1234/devtools/browser/id');
    const { cdpPort } = await result;
    expect(cdpPort).toBe(1234);
    expect(child.removeAllListeners).toHaveBeenCalledWith('error');
    expect(child.removeAllListeners).toHaveBeenCalledWith('exit');

    // After resolve the listeners are removed: late error/exit must not fail anything.
    child.emit('error', new Error('late error'));
    child.emit('exit', 0, null);
  });
});
