import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { spawn } from 'child_process';
import kill from 'tree-kill';
import { initDatabase, createProfileQueries, createCookieQueries, createLogQueries } from '../../src/db';
import { generateFingerprint } from '../../src/fingerprint';
import { getBrowserDataDir } from '../../src/core/profile-path';
import { createProfileLogger, getAppDir } from '../../src/logger';
import * as cdp from '../../src/cdp/client';
import * as profileTabs from '../../src/cdp/profile-tabs';
import * as cookieInject from '../../src/cookie/inject';

let db;
let profileQueries;
let cookieQueries;
let profile;

beforeAll(() => {
  db = initDatabase();
  db.pragma('foreign_keys = OFF');
  profileQueries = createProfileQueries(db);
  cookieQueries = createCookieQueries(db);

  db.exec('DELETE FROM run_tasks');
  db.exec('DELETE FROM runs');
  db.exec('DELETE FROM project_profile_config');
  db.exec('DELETE FROM projects');
  db.exec('DELETE FROM profiles');
  db.exec('DELETE FROM cookies');
  db.exec('DELETE FROM profile_logs');
  db.pragma('foreign_keys = ON');
});

afterAll(() => {
  db.close();
});

describe('Profile Launch Flow', () => {
  it('creates profile with fingerprint', () => {
    const fingerprint = generateFingerprint('macos');
    profile = profileQueries.create({
      name: 'Test Profile',
      platform: fingerprint.platform,
      fingerprint_seed: fingerprint.fingerprint_seed,
      user_agent: fingerprint.user_agent,
      screen_resolution: fingerprint.screen_resolution,
      hardware_cores: fingerprint.hardware_cores,
      hardware_memory: fingerprint.hardware_memory,
    });
    expect(profile.id).toBeTruthy();
    expect(profile.name).toBe('Test Profile');
    expect(profile.fingerprint_seed).toBeTruthy();
  });

  it('imports cookies', () => {
    const testCookies = [
      { name: 'session_id', value: 'abc123xyz', domain: '.example.com', path: '/', httpOnly: true, secure: true },
      { name: 'user_pref', value: 'dark_mode', domain: '.example.com', path: '/settings', httpOnly: false, secure: false, expires: Math.floor(Date.now() / 1000) + 86400 },
      { name: 'token', value: 'jwt_token_here', domain: '.api.example.com', path: '/auth', httpOnly: true, secure: true },
    ];
    cookieQueries.import(profile.id, testCookies);
    const savedCookies = cookieQueries.getByProfileId(profile.id);
    expect(savedCookies.length).toBe(3);
  });

  it('не создаёт Netscape-файл Default/Cookies и удаляет подтверждённые записи из очереди', async () => {
    const imported = cookieQueries.getByProfileId(profile.id);
    expect(imported.length).toBe(3);

    const userDataDir = getBrowserDataDir(profile);
    const cookieFile = path.join(userDataDir, 'Default', 'Cookies');

    const fakeWs = { close: vi.fn() };
    const fakeCdp = {
      discoverWsUrl: vi.fn().mockResolvedValue('ws://127.0.0.1:9222/devtools/browser'),
      connect: vi.fn().mockResolvedValue(fakeWs),
      call: vi.fn(async (ws, method) => {
        if (method === 'Network.setCookies') return {};
        if (method === 'Network.getAllCookies') {
          // Chromium подтверждает по ключу (domain, path, name); value может
          // быть нормализовано.
          return {
            cookies: imported.map(c => ({
              name: c.name,
              value: `normalized-${c.value}`,
              domain: c.domain,
              path: c.path || '/',
              expires: c.expires,
              httpOnly: c.http_only === 1,
              secure: c.secure === 1,
              sameSite: c.same_site,
            })),
          };
        }
        return {};
      }),
    };
    cookieInject.setCdpClientForTesting(fakeCdp);
    cookieInject.setDatabaseForTesting(db);
    try {
      const applied = await cookieInject.applyCookiesToCdp(profile.id, 9222);
      expect(applied).toBe(3);
      expect(fakeCdp.call).toHaveBeenCalledWith(
        fakeWs,
        'Network.setCookies',
        expect.objectContaining({ cookies: expect.any(Array) })
      );
      expect(fakeCdp.call).toHaveBeenCalledWith(fakeWs, 'Network.getAllCookies');
      // Chromium-хранилище cookies не трогается файловой записью.
      expect(fs.existsSync(cookieFile)).toBe(false);
      // Подтверждённые записи удалены из очереди.
      expect(cookieQueries.getByProfileId(profile.id)).toHaveLength(0);
    } finally {
      cookieInject.setCdpClientForTesting(null);
      cookieInject.setDatabaseForTesting(null);
    }
  });

  it('creates profile logger writing to file', async () => {
    const profileLogger = createProfileLogger(profile.id);
    profileLogger.info({ profileId: profile.id }, 'Профиль запущен');
    profileLogger.info({ cookieCount: 3 }, 'Куки инжектированы');

    await new Promise(r => setTimeout(r, 200));

    const appDir = getAppDir();
    const logFile = path.join(appDir, 'logs', `profile_${profile.id}.log`);
    expect(fs.existsSync(logFile)).toBe(true);

    const logContent = fs.readFileSync(logFile, 'utf-8');
    expect(logContent).toContain('Профиль запущен');
    expect(logContent).toContain('Куки инжектированы');
  });
});

// --- Opt-in real CloakBrowser lifecycle test ---
// Включается только при CLOAKBROWSER_INTEGRATION_TEST=1.
// Путь к бинарнику: CLOAKBROWSER_PATH или существующий resolver (~/.cloakbrowser).
// Без бинарника тест пропускается и не ломает обычный `npm test`.

const isCloakOptIn = process.env.CLOAKBROWSER_INTEGRATION_TEST === '1';

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function resolveCloakBrowserPath() {
  const explicit = process.env.CLOAKBROWSER_PATH;
  if (explicit && fs.existsSync(explicit)) {
    const isDir = fs.statSync(explicit).isDirectory();
    if (!isDir) return explicit;
    const win = process.platform === 'win32';
    const inDir = path.join(explicit, win ? 'chrome.exe' : 'chrome');
    if (fs.existsSync(inDir)) return inDir;
  }
  if (explicit) return null;

  const home = process.env.USERPROFILE || process.env.HOME || '';
  if (!home) return null;
  const win = process.platform === 'win32';
  const cacheDir = path.join(home, '.cloakbrowser');
  try {
    const versions = (await fs.promises.readdir(cacheDir))
      .filter(d => d.startsWith('chromium-'))
      .sort()
      .reverse();
    for (const ver of versions) {
      const bin = path.join(cacheDir, ver, win ? 'chrome.exe' : 'chrome');
      try {
        await fs.promises.access(bin);
        return bin;
      } catch { /* skip */ }
    }
  } catch { /* no cache dir */ }
  return null;
}

function launchCloakBrowser(binPath, userDataDir) {
  return new Promise((resolve, reject) => {
    const args = [
      '--remote-debugging-port=0',
      `--user-data-dir=${userDataDir}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--disable-session-crashed-bubble',
      '--lang=en-US',
    ];
    const child = spawn(binPath, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderrOutput = '';
    let settled = false;

    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        try { kill(child.pid, 'SIGKILL'); } catch { /* dead */ }
        reject(new Error('CloakBrowser CDP port timeout'));
      }
    }, 30000);

    child.on('error', (err) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(err);
      }
    });

    child.on('exit', (code, signal) => {
      if (!settled) {
        settled = true;
        clearTimeout(timer);
        reject(new Error(`CloakBrowser exited before CDP ready (code=${code}, signal=${signal})`));
      }
    });

    child.stderr.on('data', (data) => {
      stderrOutput += data.toString();
      const match = stderrOutput.match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/);
      if (match && !settled) {
        settled = true;
        clearTimeout(timer);
        resolve({ child, cdpPort: parseInt(match[1], 10) });
      }
    });
  });
}

async function stopCloakBrowser(child) {
  if (!child || !child.pid || child.exitCode !== null) return;
  await new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (!done) { done = true; resolve(); }
    };
    const timer = setTimeout(() => {
      try { kill(child.pid, 'SIGKILL'); } catch { /* dead */ }
      finish();
    }, 10000);
    child.on('exit', () => {
      clearTimeout(timer);
      finish();
    });
    try {
      kill(child.pid, 'SIGTERM');
    } catch {
      clearTimeout(timer);
      finish();
    }
  });
}

describe.skipIf(!isCloakOptIn)('CloakBrowser real lifecycle (opt-in: CLOAKBROWSER_INTEGRATION_TEST=1)', () => {
  let browserPath;
  let child;
  let cdpPort;
  let userDataDir;

  beforeAll(async () => {
    browserPath = await resolveCloakBrowserPath();
    if (!browserPath) {
      throw new Error('CloakBrowser binary not found. Install it or set CLOAKBROWSER_PATH.');
    }
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-cloak-test-'));
  });

  afterAll(async () => {
    // Браузер останавливается даже при падении промежуточного шага.
    try { await stopCloakBrowser(child); } catch { /* ignore */ }
    profileTabs.setCdpPortProviderForTesting(null);
    if (child) {
      const gone = !isProcessAlive(child.pid);
      expect(gone).toBe(true);
    }
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('launches real CloakBrowser, connects to CDP, opens/closes a page and stops cleanly', async () => {
    const launched = await launchCloakBrowser(browserPath, userDataDir);
    child = launched.child;
    cdpPort = launched.cdpPort;
    expect(cdpPort).toBeGreaterThan(0);
    expect(child.pid).toBeGreaterThan(0);
    expect(isProcessAlive(child.pid)).toBe(true);

    // 3. Подключение к CDP
    const wsUrl = await cdp.discoverWsUrl(cdpPort);
    const ws = await cdp.connect(wsUrl);
    try {
      // 4. Получение target
      const { targetInfos } = await cdp.call(ws, 'Target.getTargets');
      expect(Array.isArray(targetInfos)).toBe(true);

      // 5. Открыть и закрыть страницу
      const { targetId } = await cdp.call(ws, 'Target.createTarget', { url: 'about:blank' });
      expect(targetId).toBeTruthy();
      await cdp.call(ws, 'Target.closeTarget', { targetId });
    } finally {
      ws.close();
    }
  });

  it('resetToSingleBlankTab приводит профиль к одной about:blank вкладке', async () => {
    // Открыть несколько рабочих вкладок, включая не-page и devtools-like targets.
    const ws = await cdp.connect(await cdp.discoverWsUrl(cdpPort));
    try {
      await cdp.call(ws, 'Target.createTarget', { url: 'about:blank' });
      await cdp.call(ws, 'Target.createTarget', { url: 'about:blank' });
    } finally {
      ws.close();
    }

    // Тестовый шов: направляем resetToSingleBlankTab на реальный CDP-порт.
    profileTabs.setCdpPortProviderForTesting(() => cdpPort);

    const result = await profileTabs.resetToSingleBlankTab(profile.id);
    expect(result.kept).toBe(1);

    // Закрытие вкладок в Chromium асинхронно: дожидаемся стабилизации до 1 page-target.
    const checkWs = await cdp.connect(await cdp.discoverWsUrl(cdpPort));
    try {
      let pages = [];
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        const { targetInfos } = await cdp.call(checkWs, 'Target.getTargets');
        pages = targetInfos.filter(
          t => t.type === 'page' && !(t.url || '').startsWith('devtools://')
        );
        if (pages.length === 1) break;
        await new Promise(r => setTimeout(r, 250));
      }
      expect(pages).toHaveLength(1);
      expect(pages[0].url).toBe('about:blank');
    } finally {
      checkWs.close();
    }
  }, 30000);

  it('Network.setCookies → Network.getAllCookies в default browser context', async () => {
    const ws = await cdp.connect(await cdp.discoverWsUrl(cdpPort));
    try {
      await cdp.call(ws, 'Network.setCookies', {
        cookies: [{
          name: 'mm_cdp_test',
          value: 'mm_cdp_val',
          domain: '.example.com',
          path: '/',
          httpOnly: true,
          secure: true,
          sameSite: 'Lax',
          expires: Math.floor(Date.now() / 1000) + 86400,
        }],
      });

      const { cookies } = await cdp.call(ws, 'Network.getAllCookies');
      const found = cookies.find(c => c.name === 'mm_cdp_test');
      expect(found).toBeTruthy();
      expect(found.value).toBe('mm_cdp_val');
      expect(found.httpOnly).toBe(true);
      expect(found.secure).toBe(true);
      expect(found.sameSite).toBe('Lax');
    } finally {
      ws.close();
    }
  }, 30000);

  it('cookies сохраняются между остановкой и повторным запуском (persistent storage)', async () => {
    // Останавливаем браузер и перезапускаем с тем же user-data-dir.
    await stopCloakBrowser(child);
    child = null;

    const relaunched = await launchCloakBrowser(browserPath, userDataDir);
    child = relaunched.child;
    cdpPort = relaunched.cdpPort;
    expect(isProcessAlive(child.pid)).toBe(true);

    const checkWs = await cdp.connect(await cdp.discoverWsUrl(cdpPort));
    try {
      const { cookies } = await cdp.call(checkWs, 'Network.getAllCookies');
      const found = cookies.find(c => c.name === 'mm_cdp_test');
      expect(found).toBeTruthy();
      expect(found.value).toBe('mm_cdp_val');
    } finally {
      checkWs.close();
    }
  }, 60000);

  it('создаёт информационную вкладку профиля и страница доступна по HTTP', async () => {
    // eslint-disable-next-line global-require
    const express = require('express');
    // eslint-disable-next-line global-require
    const request = require('supertest');
    // eslint-disable-next-line global-require
    const profileInfoRouter = require('../../src/api/profile-info.js');
    // eslint-disable-next-line global-require
    const browserApi = require('../../src/api/browser.js');

    const app = express();
    app.use('/profile-info', profileInfoRouter);
    const server = await new Promise((resolve) => {
      const s = app.listen(0, '127.0.0.1', () => resolve(s));
    });
    const serverPort = server.address().port;

    const profileLogger = createProfileLogger(profile.id);
    const logQueries = createLogQueries(db);

    try {
      await browserApi.openProfileInfoTab(profile.id, cdpPort, serverPort, profileLogger, logQueries);

      // Вкладка реально появилась (или существующая about:blank перенаправлена) с
      // URL информационной страницы именно этого профиля. Навигация через
      // Page.navigate применяется асинхронно — опрашиваем target до появления URL.
      const expectedUrl = `http://127.0.0.1:${serverPort}/profile-info/${profile.id}`;
      const checkWs = await cdp.connect(await cdp.discoverWsUrl(cdpPort));
      let found = false;
      try {
        const deadline = Date.now() + 10000;
        while (Date.now() < deadline && !found) {
          const { targetInfos } = await cdp.call(checkWs, 'Target.getTargets');
          found = targetInfos.some(
            (t) => t.type === 'page' && t.url === expectedUrl
          );
          if (!found) await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        checkWs.close();
      }
      expect(found).toBe(true);

      // Страница доступна по HTTP, заголовок равен имени аккаунта.
      const page = await request(server).get(`/profile-info/${profile.id}`);
      expect(page.status).toBe(200);
      expect(page.headers['content-type']).toMatch(/text\/html/);
      expect(page.text).toContain(`<title>${profile.name}</title>`);
    } finally {
      server.close();
      if (typeof server.closeAllConnections === 'function') server.closeAllConnections();
    }
  }, 30000);
});
