import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';
import path from 'path';
import os from 'os';
import fs from 'fs';

import * as browserApi from '../../src/api/browser.js';

const BROWSER_JS = new URL('../../src/api/browser.js', import.meta.url);

// Восстановление тестовых швов после каждого теста: подменённые модули не
// должны «протекать» в последующие тесты.
afterEach(() => {
  browserApi.setProfileTabsForTesting(null);
  browserApi.setCdpClientForTesting(null);
  browserApi.setExtensionsApiForTesting(null);
});

describe('Browser — автологин кошелька (source-level)', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');

  it('run_id определяется из body и query', () => {
    expect(content).toContain('const runId = req.body?.run_id || req.query?.run_id || null;');
  });

  it('start handler вызывает runManualAutologin только при ручном запуске (без run_id)', () => {
    const startBlock = content.slice(content.indexOf("router.post('/:id/start'"));
    expect(startBlock).toMatch(/if \(!runId\)\s*\{[\s\S]*runManualAutologin/);
  });

  it('runManualAutologin проверяет wallet-поля без логирования их значений', () => {
    const block = content.slice(
      content.indexOf('async function runManualAutologin'),
      content.indexOf('async function zerionLogin')
    );
    expect(block).toContain('profile.wallet_evm_address');
    expect(block).toContain('profile.wallet_password');
    expect(block).not.toMatch(/logger\.(info|warn|error)\(\{[^}]*wallet_password/);
    expect(block).not.toMatch(/logger\.(info|warn|error)\(\{[^}]*wallet_evm_address/);
  });

  it('runManualAutologin не останавливает браузер при ошибке (нет stopped-переходов)', () => {
    const block = content.slice(
      content.indexOf('async function runManualAutologin'),
      content.indexOf('async function zerionLogin')
    );
    expect(block).not.toContain("updateStatus(profileId, 'stopped')");
    expect(block).not.toContain('updateStatus(');
  });

  it('runManualAutologin нормализует вкладки в finally через resetToSingleBlankTab', () => {
    const block = content.slice(
      content.indexOf('async function runManualAutologin'),
      content.indexOf('async function zerionLogin')
    );
    expect(block).toContain('finally');
    expect(block).toContain('resetToSingleBlankTab');
  });

  it('zerionLogin не логирует полные URL (loginUrl/wsUrl)', () => {
    expect(content).not.toMatch(/logger\.(info|debug|error|warn)\(\{[^}]*loginUrl/);
    expect(content).not.toMatch(/logger\.(info|debug|error|warn)\(\{[^}]*wsUrl/);
  });

  it('экспортирует швы для тестов и runManualAutologin', () => {
    expect(browserApi.runManualAutologin).toBeTypeOf('function');
    expect(browserApi.setProfileTabsForTesting).toBeTypeOf('function');
    expect(browserApi.setCdpClientForTesting).toBeTypeOf('function');
    expect(browserApi.setExtensionsApiForTesting).toBeTypeOf('function');
  });
});

describe('Browser — runManualAutologin (functional)', () => {
  let ws;
  let resetToSingleBlankTab;
  let cdpMock;
  let extensionsApi;

  const makeProfile = (overrides = {}) => ({
    id: 'p1',
    wallet_evm_address: '0x1234567890abcdef1234567890abcdef12345678',
    wallet_password: 'super-secret-pass',
    extensions: JSON.stringify(['zerion-folder']),
    ...overrides,
  });

  const makeLogger = () => ({
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  });

  const successEvalExpression = (params) => {
    const expr = params.expression || '';
    if (expr.includes('!== null')) return { result: { value: true } };
    if (expr.includes('el===null')) return { result: { value: true } };
    return { result: {} };
  };

  const installSuccessLogin = () => {
    ws = { close: vi.fn() };
    extensionsApi.resolveRuntimeId.mockResolvedValue('zerion-ext-id');
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    cdpMock.call.mockImplementation(async (w, method, params = {}) => {
      if (method === 'Target.getTargets') {
        return {
          targetInfos: [{
            targetId: 'zerion-tab',
            type: 'page',
            url: 'chrome-extension://zerion-ext-id/popup.8e8f209b.html?windowType=dialog#/login',
          }],
        };
      }
      if (method === 'Target.attachToTarget') return { sessionId: 's1' };
      if (method === 'Runtime.evaluate') return successEvalExpression(params);
      return {};
    });
  };

  beforeEach(() => {
    vi.clearAllMocks();

    resetToSingleBlankTab = vi.fn().mockResolvedValue({ closed: 0, kept: 1, errors: [] });
    browserApi.setProfileTabsForTesting({ resetToSingleBlankTab });

    cdpMock = {
      call: vi.fn(),
      send: vi.fn(),
      connect: vi.fn(),
      discoverWsUrl: vi.fn(),
      getHttpTabs: vi.fn(),
    };
    browserApi.setCdpClientForTesting(cdpMock);

    extensionsApi = {
      getExtensionsDir: vi.fn().mockReturnValue('C:/mm/extensions'),
      getManifest: vi.fn(),
      resolveMSG: vi.fn(),
      resolveRuntimeId: vi.fn(),
    };
    browserApi.setExtensionsApiForTesting(extensionsApi);
  });

  it('ручной запуск с обоими wallet-полями вызывает автологин и нормализацию вкладок', async () => {
    installSuccessLogin();
    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await browserApi.runManualAutologin('p1', makeProfile(), 9222, profileLogger, logQueries);

    expect(extensionsApi.resolveRuntimeId).toHaveBeenCalled();
    // нормализация до и после логина (finally)
    expect(resetToSingleBlankTab).toHaveBeenCalledTimes(2);
    expect(resetToSingleBlankTab).toHaveBeenCalledWith('p1');
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'info', 'Автологин кошелька успешен');
    // WebSocket сессия закрыта после логина
    expect(ws.close).toHaveBeenCalled();
  });

  it('ручной запуск без EVM-адреса не вызывает автологин, но очищает вкладки', async () => {
    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await browserApi.runManualAutologin('p1', makeProfile({ wallet_evm_address: '' }), 9222, profileLogger, logQueries);

    expect(extensionsApi.resolveRuntimeId).not.toHaveBeenCalled();
    expect(cdpMock.connect).not.toHaveBeenCalled();
    expect(resetToSingleBlankTab).toHaveBeenCalledTimes(1);
    expect(resetToSingleBlankTab).toHaveBeenCalledWith('p1');
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'info', 'Автологин кошелька пропущен: данные кошелька не заданы');
  });

  it('ручной запуск без пароля не вызывает автологин, но очищает вкладки', async () => {
    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await browserApi.runManualAutologin('p1', makeProfile({ wallet_password: null }), 9222, profileLogger, logQueries);

    expect(extensionsApi.resolveRuntimeId).not.toHaveBeenCalled();
    expect(cdpMock.connect).not.toHaveBeenCalled();
    expect(resetToSingleBlankTab).toHaveBeenCalledTimes(1);
  });

  it('после ошибки логина браузер не падает: ошибка логируется, вкладки очищаются', async () => {
    ws = { close: vi.fn() };
    extensionsApi.resolveRuntimeId.mockResolvedValue('zerion-ext-id');
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    cdpMock.call.mockImplementation(async (w, method) => {
      if (method === 'Target.getTargets') return { targetInfos: [] };
      if (method === 'Target.createTarget') return { targetId: 'zerion-tab' };
      if (method === 'Target.attachToTarget') throw new Error('attach failed');
      return {};
    });

    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await expect(
      browserApi.runManualAutologin('p1', makeProfile(), 9222, profileLogger, logQueries)
    ).resolves.toBeUndefined();

    expect(profileLogger.error).toHaveBeenCalled();
    expect(logQueries.add).toHaveBeenCalledWith(
      expect.any(String),
      'error',
      expect.stringContaining('Автологин кошелька не выполнен')
    );
    // нормализация в finally даже при ошибке
    expect(resetToSingleBlankTab).toHaveBeenCalledTimes(2);
    expect(ws.close).toHaveBeenCalled();
  });

  it('отсутствие runtime ID Zerion считается ошибкой автологина без остановки запуска', async () => {
    extensionsApi.resolveRuntimeId.mockResolvedValue(null);

    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await expect(
      browserApi.runManualAutologin('p1', makeProfile(), 9222, profileLogger, logQueries)
    ).resolves.toBeUndefined();

    expect(profileLogger.error).toHaveBeenCalled();
    expect(resetToSingleBlankTab).toHaveBeenCalledTimes(2);
    expect(cdpMock.connect).not.toHaveBeenCalled();
  });

  it('секреты (пароль и EVM-адрес) не попадают в логи', async () => {
    installSuccessLogin();
    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await browserApi.runManualAutologin('p1', makeProfile({
      wallet_evm_address: '0xSECRETEVMA',
      wallet_password: 'SECRET_PASSWORD_XYZ',
    }), 9222, profileLogger, logQueries);

    const allCalls = JSON.stringify([
      ...profileLogger.info.mock.calls,
      ...profileLogger.error.mock.calls,
      ...profileLogger.warn.mock.calls,
      ...logQueries.add.mock.calls,
    ]);
    expect(allCalls).not.toContain('SECRET_PASSWORD_XYZ');
    expect(allCalls).not.toContain('0xSECRETEVMA');
  });

  it('ошибка resetToSingleBlankTab после логина не роняет автологин', async () => {
    installSuccessLogin();
    resetToSingleBlankTab
      .mockResolvedValueOnce({ closed: 0, kept: 1, errors: [] })
      .mockRejectedValueOnce(new Error('CDP port is unavailable'));

    const profileLogger = makeLogger();
    const logQueries = { add: vi.fn() };

    await expect(
      browserApi.runManualAutologin('p1', makeProfile(), 9222, profileLogger, logQueries)
    ).resolves.toBeUndefined();

    expect(logQueries.add).toHaveBeenCalledWith('p1', 'info', 'Автологин кошелька успешен');
    expect(profileLogger.warn).toHaveBeenCalled();
  });
});

describe('Browser — диспетчеризация автологина в start handler (source-level)', () => {
  it('manual autologin происходит после загрузки расширений и определения CDP-порта', () => {
    const content = readFileSync(BROWSER_JS, 'utf-8');
    const loadExtIdx = content.indexOf('await loadExtensionsViaCDP(');
    const autologinIdx = content.indexOf('await runManualAutologin(');
    expect(loadExtIdx).toBeGreaterThan(-1);
    expect(autologinIdx).toBeGreaterThan(loadExtIdx);
  });

  it('ответ start handler не содержит wallet-полей', () => {
    const content = readFileSync(BROWSER_JS, 'utf-8');
    const startBlock = content.slice(content.indexOf("router.post('/:id/start'"));
    const responseBlock = startBlock.slice(0, startBlock.indexOf("router.post('/:id/stop'"));
    expect(responseBlock).not.toContain('wallet_password');
    expect(responseBlock).not.toContain('wallet_evm_address');
  });
});

describe('Browser — resetToSingleBlankTab контракт (profile-tabs)', () => {
  it('profile-tabs экспортирует resetToSingleBlankTab', () => {
    // eslint-disable-next-line global-require
    const profileTabs = require('../../src/cdp/profile-tabs.js');
    expect(profileTabs.resetToSingleBlankTab).toBeTypeOf('function');
  });
});

describe('Browser — импорт без инициализации БД', () => {
  let tmpDir;
  let originalAppData;

  beforeEach(() => {
    originalAppData = process.env.APPDATA;
    tmpDir = path.join(os.tmpdir(), 'mm-autologin-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    process.env.APPDATA = tmpDir;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it('browser.js загружается без инициализации БД', () => {
    expect(browserApi).toBeDefined();
    expect(browserApi.getCdpPort).toBeTypeOf('function');
    expect(fs.existsSync(path.join(tmpDir, 'app.db'))).toBe(false);
  });
});
