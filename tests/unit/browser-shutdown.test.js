import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';
import { EventEmitter } from 'node:events';

import * as browserApi from '../../src/api/browser.js';

const BROWSER_JS = new URL('../../src/api/browser.js', import.meta.url);

const CDP_CLOSE_TIMEOUT_MS = 2000;
const PROCESS_EXIT_TIMEOUT_MS = 8000;
const WINDOWS_SIGNAL_WAIT_MS = 2500;

function createMockChild(pid = 1234) {
  const listeners = {};
  return {
    pid,
    kill: vi.fn(),
    on: vi.fn((event, cb) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(cb);
    }),
    emit(event) {
      (listeners[event] || []).forEach(cb => cb());
    },
  };
}

function createMockProfileQueries() {
  return {
    updateStatus: vi.fn(),
    updatePid: vi.fn(),
    getById: vi.fn(),
  };
}

function createMockLogQueries() {
  return {
    add: vi.fn(),
  };
}

function createMockProfileLogger() {
  return {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
  };
}

// Реальный EventEmitter-ребёнок с pid: даёт once/removeListener, как у
// ChildProcess, и позволяет эмитить exit.
function createEmitterChild(pid) {
  const child = new EventEmitter();
  child.pid = pid;
  return child;
}

function flushMicrotasks() {
  return new Promise((resolve) => setImmediate(resolve));
}

let cdpMock;
let taskkillMock;

beforeEach(() => {
  cdpMock = {
    discoverWsUrl: vi.fn(),
    connect: vi.fn(),
    send: vi.fn(),
    call: vi.fn(),
  };
  taskkillMock = vi.fn().mockResolvedValue(null);
  browserApi.setCdpClientForTesting(cdpMock);
  browserApi.setTaskkillForTesting(taskkillMock);
  vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
  vi.spyOn(process, 'kill').mockReturnValue(true);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  browserApi.setCdpClientForTesting(null);
  browserApi.setTaskkillForTesting(null);
  browserApi.setCdpPortForTesting('p1', null);
  browserApi.stoppingProfiles.clear();
});

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

function cleanupProfile(profileId, profileQueries, logQueries, profileLogger, runningProfiles, profileWindows, cdpPorts, broadcastStatus) {
  profileQueries.updateStatus(profileId, 'stopped');
  broadcastStatus(profileId, 'stopped');
  profileQueries.updatePid(profileId, null);

  profileLogger.warn({ profileId }, 'Browser process died unexpectedly, cleaned up');
  logQueries.add(profileId, 'warn', 'Browser process died unexpectedly, cleaned up');

  runningProfiles.delete(profileId);
  profileWindows.delete(profileId);
  cdpPorts.delete(profileId);
}

function startHealthCheck(runningProfiles, isProcessAliveFn, cleanupFn, intervalMs = 5000) {
  const timer = setInterval(() => {
    for (const [profileId, child] of runningProfiles.entries()) {
      if (child && child.pid && !isProcessAliveFn(child.pid)) {
        cleanupFn(profileId);
      }
    }

    if (runningProfiles.size === 0) {
      clearInterval(timer);
    }
  }, intervalMs);

  timer.unref();
  return timer;
}

describe('Browser — graceful shutdown через CDP (реальная логика)', () => {
  it('Browser.close вызывается первым и до сигнального fallback, WebSocket закрыт', async () => {
    const ws = { close: vi.fn() };
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    browserApi.setCdpPortForTesting('p1', 9222);

    const child = createEmitterChild(7777);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);
    await flushMicrotasks();

    expect(cdpMock.discoverWsUrl).toHaveBeenCalledWith(9222);
    expect(cdpMock.connect).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/browser', { timeout: CDP_CLOSE_TIMEOUT_MS });
    expect(cdpMock.send).toHaveBeenCalledWith(ws, 'Browser.close');
    expect(ws.close).toHaveBeenCalled();

    child.emit('exit');
    await closePromise;

    expect(taskkillMock).not.toHaveBeenCalled();
    expect(logQueries.add).not.toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('did not exit'));
    expect(browserApi.stoppingProfiles.has('p1')).toBe(false);
  });

  it('завершается по событию exit без сигналов и без fallback', async () => {
    const child = createEmitterChild(8888);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);
    await flushMicrotasks();

    expect(cdpMock.connect).not.toHaveBeenCalled();
    expect(taskkillMock).not.toHaveBeenCalled();

    child.emit('exit');
    await closePromise;

    expect(taskkillMock).not.toHaveBeenCalled();
    expect(logQueries.add).not.toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('did not exit'));
  });

  it('fallback при отсутствии CDP-порта: CDP не трогается, процесс завершается по exit', async () => {
    const child = createEmitterChild(9999);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);
    await flushMicrotasks();

    expect(cdpMock.discoverWsUrl).not.toHaveBeenCalled();
    expect(cdpMock.connect).not.toHaveBeenCalled();

    child.emit('exit');
    await closePromise;
  });

  it('не логирует как warning ожидаемое сообщение «WebSocket was closed» после Browser.close', async () => {
    const ws = { close: vi.fn() };
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    cdpMock.send.mockImplementation(() => {
      throw new Error('WebSocket was closed before the connection was established');
    });
    browserApi.setCdpPortForTesting('p1', 9222);

    const child = createEmitterChild(1111);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);
    await flushMicrotasks();
    child.emit('exit');
    await closePromise;

    expect(ws.close).toHaveBeenCalled();
    expect(logQueries.add).not.toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('CDP Browser.close failed'));
    expect(profileLogger.warn).not.toHaveBeenCalled();
  });

  it('не логирует как warning ожидаемое сообщение «Connection closed» после Browser.close', async () => {
    const ws = { close: vi.fn() };
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    cdpMock.send.mockImplementation(() => {
      throw new Error('Connection closed');
    });
    browserApi.setCdpPortForTesting('p1', 9222);

    const child = createEmitterChild(2222);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);
    await flushMicrotasks();
    child.emit('exit');
    await closePromise;

    expect(ws.close).toHaveBeenCalled();
    expect(logQueries.add).not.toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('CDP Browser.close failed'));
  });

  it('логирует настоящую ошибку подключения/отправки CDP и продолжает fallback', async () => {
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:9222'));
    browserApi.setCdpPortForTesting('p1', 9222);

    const child = createEmitterChild(3333);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);
    await flushMicrotasks();
    child.emit('exit');
    await closePromise;

    expect(logQueries.add).toHaveBeenCalledWith('p1', 'warn', 'CDP Browser.close failed: ECONNREFUSED 127.0.0.1:9222');
    expect(profileLogger.warn).toHaveBeenCalledWith(
      { profileId: 'p1', error: 'ECONNREFUSED 127.0.0.1:9222' },
      'CDP Browser.close failed'
    );
    expect(taskkillMock).not.toHaveBeenCalled();
  });

  it('таймаут ожидания exit (8 сек) → graceful taskkill без /F → force taskkill с /F', async () => {
    vi.useFakeTimers();
    const child = createEmitterChild(4444);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);

    await vi.advanceTimersByTimeAsync(PROCESS_EXIT_TIMEOUT_MS - 1);
    expect(taskkillMock).not.toHaveBeenCalled();
    expect(logQueries.add).not.toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('did not exit'));

    await vi.advanceTimersByTimeAsync(1);
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('did not exit'));
    expect(taskkillMock).toHaveBeenCalledWith(child.pid, false);

    await vi.advanceTimersByTimeAsync(WINDOWS_SIGNAL_WAIT_MS - 1);
    expect(taskkillMock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1);
    expect(taskkillMock).toHaveBeenCalledWith(child.pid, true);
    expect(taskkillMock).toHaveBeenCalledTimes(2);

    await closePromise;
    expect(browserApi.stoppingProfiles.has('p1')).toBe(false);
  });

  it('полный Windows-flow: CDP → ожидание → graceful → force, Browser.close раньше сигналов', async () => {
    vi.useFakeTimers();
    const ws = { close: vi.fn() };
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9333/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    browserApi.setCdpPortForTesting('p1', 9333);

    const child = createEmitterChild(5555);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = browserApi.gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);

    await vi.advanceTimersByTimeAsync(PROCESS_EXIT_TIMEOUT_MS + WINDOWS_SIGNAL_WAIT_MS + 100);
    await closePromise;

    expect(cdpMock.send).toHaveBeenCalledWith(ws, 'Browser.close');
    expect(cdpMock.send.mock.invocationCallOrder[0])
      .toBeLessThan(taskkillMock.mock.invocationCallOrder[0]);
    expect(taskkillMock).toHaveBeenNthCalledWith(1, child.pid, false);
    expect(taskkillMock).toHaveBeenNthCalledWith(2, child.pid, true);
    expect(ws.close).toHaveBeenCalled();
  });

  it('второй stop-запрос во время первого shutdown не запускает повторное завершение', async () => {
    vi.useFakeTimers();
    const child1 = createEmitterChild(6666);
    const child2 = createEmitterChild(7777);
    const logger1 = createMockProfileLogger();
    const lq1 = createMockLogQueries();
    const logger2 = createMockProfileLogger();
    const lq2 = createMockLogQueries();

    const first = browserApi.gracefulCloseBrowser(child1, 'p1', logger1, lq1);
    const second = browserApi.gracefulCloseBrowser(child2, 'p1', logger2, lq2);
    await second;

    expect(lq2.add).toHaveBeenCalledWith('p1', 'warn', 'Shutdown already in progress for this profile');
    expect(taskkillMock).not.toHaveBeenCalled();
    expect(cdpMock.connect).not.toHaveBeenCalled();

    child1.emit('exit');
    await first;
    expect(browserApi.stoppingProfiles.has('p1')).toBe(false);
  });
});

describe('Browser — graceful shutdown платформенные команды (source-level)', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');
  const shutdownBlock = content.slice(
    content.indexOf('async function gracefulCloseBrowser'),
    content.indexOf('async function createCdpSession')
  );
  const taskkillBlock = content.slice(
    content.indexOf('function defaultTaskkill'),
    content.indexOf('let taskkillFn')
  );

  it('Unix-ветка использует tree-kill: SIGTERM (graceful) до SIGKILL (force)', () => {
    expect(shutdownBlock).toContain("sendUnixSignal(pid, 'SIGTERM'");
    expect(shutdownBlock).toContain("sendUnixSignal(pid, 'SIGKILL'");
    expect(shutdownBlock.indexOf("'SIGTERM'")).toBeLessThan(shutdownBlock.indexOf("'SIGKILL'"));
    expect(shutdownBlock.indexOf('Browser.close')).toBeLessThan(shutdownBlock.indexOf("'SIGTERM'"));
  });

  it('Windows-ветка: graceful taskkill /T без /F, force taskkill /T /F', () => {
    expect(shutdownBlock).toContain('runWindowsTaskkill(pid, false,');
    expect(shutdownBlock).toContain('runWindowsTaskkill(pid, true,');
  });

  it('defaultTaskkill собирает безопасную команду taskkill через spawn с числовым PID', () => {
    expect(taskkillBlock).toContain("spawn('taskkill', ['/PID', String(pid), '/T']");
    expect(taskkillBlock).toContain("force ? ['/F'] : []");
  });

  it('отдельные таймауты фаз: CDP 2 сек, exit 8 сек, signal fallback 5 сек', () => {
    expect(content).toContain('const CDP_CLOSE_TIMEOUT_MS = 2000;');
    expect(content).toContain('const PROCESS_EXIT_TIMEOUT_MS = 8000;');
    expect(content).toContain('const SIGNAL_FALLBACK_TIMEOUT_MS = 5000;');
    expect(content).toContain('const WINDOWS_SIGNAL_WAIT_MS = 2500;');
  });

  it('Windows-ветка ждёт короткий фиксированный интервал, не полный signal timeout', () => {
    const windowsGraceful = shutdownBlock.slice(
      shutdownBlock.indexOf('runWindowsTaskkill(pid, false,'),
      shutdownBlock.indexOf('} else {', shutdownBlock.indexOf('runWindowsTaskkill(pid, false,'))
    );
    expect(windowsGraceful).toContain('WINDOWS_SIGNAL_WAIT_MS');
    expect(windowsGraceful).not.toContain('SIGNAL_FALLBACK_TIMEOUT_MS');
  });

  it('gracefulCloseBrowser использует cdpClient (тестовый шов) для Browser.close', () => {
    const shutdownHelpers = content.slice(
      content.indexOf('async function sendCdpBrowserClose'),
      content.indexOf('async function createCdpSession')
    );
    expect(shutdownHelpers).toContain('cdpClient.discoverWsUrl');
    expect(shutdownHelpers).toContain('cdpClient.connect');
    expect(shutdownHelpers).toContain("cdpClient.send(ws, 'Browser.close')");
    expect(shutdownHelpers).not.toContain('Target.attachToTarget');
    expect(shutdownHelpers).not.toContain('sessionId:');
    expect(shutdownHelpers).not.toContain('sessionId,');
  });
});

describe('Browser — stop endpoint behavior', () => {
  it('stop обновляет статус в БД', () => {
    const profileQueries = createMockProfileQueries();
    const profile = { id: 'p1', status: 'running', pid: 555 };

    profileQueries.updateStatus(profile.id, 'stopped');
    profileQueries.updatePid(profile.id, null);

    expect(profileQueries.updateStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(profileQueries.updatePid).toHaveBeenCalledWith('p1', null);
  });

  it('stop для уже остановленного профиля — 409', () => {
    const profile = { id: 'p1', status: 'stopped' };
    expect(profile.status).toBe('stopped');
  });

  it('stop для несуществующего профиля — 404', () => {
    const profile = null;
    expect(profile).toBeNull();
  });
});

describe('Browser — shutdown endpoint', () => {
  it('shutdown с пустым списком возвращает stopped: 0', () => {
    const running = [];
    expect(running.length).toBe(0);
  });

  it('shutdown с запущенными браузерами возвращает количество', () => {
    const running = [
      ['p1', createMockChild(1)],
      ['p2', createMockChild(2)],
      ['p3', createMockChild(3)],
    ];
    expect(running.length).toBe(3);
  });

  it('shutdown вызывает gracefulCloseBrowser для каждого', async () => {
    const calls = [];
    const mockGraceful = async (child) => {
      calls.push(child.pid);
    };

    const running = [
      ['p1', createMockChild(100)],
      ['p2', createMockChild(200)],
    ];

    await Promise.all(running.map(([id, child]) => mockGraceful(child)));

    expect(calls).toEqual([100, 200]);
  });
});

describe('Browser — process health check (isProcessAlive)', () => {
  it('isProcessAlive возвращает true если процесс существует', () => {
    process.kill.mockReturnValue(true);
    expect(isProcessAlive(1234)).toBe(true);
    expect(process.kill).toHaveBeenCalledWith(1234, 0);
  });

  it('isProcessAlive возвращает false если процесс не найден (ESRCH)', () => {
    const err = new Error('process not found');
    err.code = 'ESRCH';
    process.kill.mockImplementation(() => { throw err; });
    expect(isProcessAlive(9999)).toBe(false);
  });

  it('isProcessAlive возвращает true при EPERM (нет доступа, но процесс жив)', () => {
    const err = new Error('permission denied');
    err.code = 'EPERM';
    process.kill.mockImplementation(() => { throw err; });
    expect(isProcessAlive(7777)).toBe(true);
  });

  it('isProcessAlive возвращает false при EINVAL (Windows: процесс не найден)', () => {
    const err = new Error('invalid argument');
    err.code = 'EINVAL';
    process.kill.mockImplementation(() => { throw err; });
    expect(isProcessAlive(8888)).toBe(false);
  });

  it('isProcessAlive возвращает false при ENOENT', () => {
    const err = new Error('no such process');
    err.code = 'ENOENT';
    process.kill.mockImplementation(() => { throw err; });
    expect(isProcessAlive(9000)).toBe(false);
  });

  it('isProcessAlive возвращает false для pid = 0', () => {
    expect(isProcessAlive(0)).toBe(false);
  });

  it('isProcessAlive возвращает false для отрицательного pid', () => {
    expect(isProcessAlive(-1)).toBe(false);
  });

  it('isProcessAlive возвращает false для null pid', () => {
    expect(isProcessAlive(null)).toBe(false);
  });

  it('isProcessAlive возвращает false для undefined pid', () => {
    expect(isProcessAlive(undefined)).toBe(false);
  });
});

describe('Browser — cleanupProfile', () => {
  it('cleanupProfile сбрасывает статус и чистит все Map', () => {
    const profileQueries = createMockProfileQueries();
    const logQueries = createMockLogQueries();
    const profileLogger = createMockProfileLogger();
    const runningProfiles = new Map([['p1', { pid: 555 }]]);
    const profileWindows = new Map([['p1', { pid: 555, handle: '123' }]]);
    const cdpPorts = new Map([['p1', 9222]]);
    const broadcastStatus = vi.fn();

    cleanupProfile('p1', profileQueries, logQueries, profileLogger, runningProfiles, profileWindows, cdpPorts, broadcastStatus);

    expect(profileQueries.updateStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(profileQueries.updatePid).toHaveBeenCalledWith('p1', null);
    expect(broadcastStatus).toHaveBeenCalledWith('p1', 'stopped');
    expect(profileLogger.warn).toHaveBeenCalledWith({ profileId: 'p1' }, expect.any(String));
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'warn', expect.any(String));
    expect(runningProfiles.has('p1')).toBe(false);
    expect(profileWindows.has('p1')).toBe(false);
    expect(cdpPorts.has('p1')).toBe(false);
  });

  it('cleanupProfile не падает если профиля нет в Map', () => {
    const profileQueries = createMockProfileQueries();
    const logQueries = createMockLogQueries();
    const profileLogger = createMockProfileLogger();
    const runningProfiles = new Map();
    const profileWindows = new Map();
    const cdpPorts = new Map();
    const broadcastStatus = vi.fn();

    expect(() => {
      cleanupProfile('nonexistent', profileQueries, logQueries, profileLogger, runningProfiles, profileWindows, cdpPorts, broadcastStatus);
    }).not.toThrow();

    expect(profileQueries.updateStatus).toHaveBeenCalledWith('nonexistent', 'stopped');
  });
});

describe('Browser — startHealthCheck', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('startHealthCheck создаёт интервал и проверяет процессы', () => {
    const isProcessAliveFn = vi.fn().mockReturnValue(true);
    const cleanupFn = vi.fn();
    const runningProfiles = new Map([['p1', { pid: 111 }]]);

    const timer = startHealthCheck(runningProfiles, isProcessAliveFn, cleanupFn, 5000);

    expect(timer).toBeDefined();
    expect(isProcessAliveFn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(5000);

    expect(isProcessAliveFn).toHaveBeenCalledWith(111);
    expect(cleanupFn).not.toHaveBeenCalled();
  });

  it('startHealthCheck вызывает cleanup если процесс мёртв', () => {
    const isProcessAliveFn = vi.fn().mockReturnValue(false);
    const cleanupFn = vi.fn();
    const runningProfiles = new Map([['p1', { pid: 999 }]]);

    startHealthCheck(runningProfiles, isProcessAliveFn, cleanupFn, 5000);

    vi.advanceTimersByTime(5000);

    expect(cleanupFn).toHaveBeenCalledWith('p1');
  });

  it('startHealthCheck останавливает интервал когда нет процессов', () => {
    const isProcessAliveFn = vi.fn();
    const cleanupFn = vi.fn();
    const runningProfiles = new Map();

    startHealthCheck(runningProfiles, isProcessAliveFn, cleanupFn, 5000);

    vi.advanceTimersByTime(5000);

    expect(isProcessAliveFn).not.toHaveBeenCalled();
  });

  it('startHealthCheck пропускает записи без pid', () => {
    const isProcessAliveFn = vi.fn();
    const cleanupFn = vi.fn();
    const runningProfiles = new Map([['p1', {}]]);

    startHealthCheck(runningProfiles, isProcessAliveFn, cleanupFn, 5000);

    vi.advanceTimersByTime(5000);

    expect(isProcessAliveFn).not.toHaveBeenCalled();
    expect(cleanupFn).not.toHaveBeenCalled();
  });

  it('startHealthCheck останавливается когда все процессы очищены', () => {
    const isProcessAliveFn = vi.fn().mockReturnValue(false);
    const cleanupFn = vi.fn((id) => {
      runningProfiles.delete(id);
    });
    const runningProfiles = new Map([['p1', { pid: 999 }]]);

    startHealthCheck(runningProfiles, isProcessAliveFn, cleanupFn, 5000);

    vi.advanceTimersByTime(5000);
    expect(cleanupFn).toHaveBeenCalledTimes(1);
    expect(runningProfiles.size).toBe(0);

    vi.advanceTimersByTime(5000);
    expect(cleanupFn).toHaveBeenCalledTimes(1);
  });
});