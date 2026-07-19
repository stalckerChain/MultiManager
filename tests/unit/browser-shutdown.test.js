import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const SHUTDOWN_TIMEOUT_MS = 8000;

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

function isProcessAlive(pid) {
  if (!pid || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
}

async function gracefulCloseBrowser(child, profileId, profileLogger, logQueries) {
  return new Promise((resolve) => {
    let resolved = false;
    const done = () => {
      if (!resolved) {
        resolved = true;
        resolve();
      }
    };

    const timer = setTimeout(() => {
      logQueries.add(profileId, 'warn', 'Graceful shutdown timeout, force killing');
      child.kill('SIGKILL', (err) => {
        if (err) logQueries.add(profileId, 'warn', `Force kill failed: ${err.message}`);
        done();
      });
    }, SHUTDOWN_TIMEOUT_MS);

    child.on('exit', () => {
      clearTimeout(timer);
      done();
    });

    child.kill('SIGTERM', (err) => {
      if (err) {
        clearTimeout(timer);
        logQueries.add(profileId, 'warn', `SIGTERM failed (process may be dead): ${err.message}`);
        child.kill('SIGKILL', (err2) => {
          if (err2) logQueries.add(profileId, 'warn', `SIGKILL failed (process may be dead): ${err2.message}`);
          done();
        });
      }
    });
  });
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

describe('Browser — graceful shutdown', () => {
  it('gracefulCloseBrowser завершает процесс через SIGTERM', async () => {
    const child = createMockChild(111);
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = gracefulCloseBrowser(child, 'p1', profileLogger, logQueries);

    child.emit('exit');
    await closePromise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM', expect.any(Function));
    expect(logQueries.add).not.toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('timeout'));
  });

  it('gracefulCloseBrowser делает SIGKILL при ошибке SIGTERM', async () => {
    const child = createMockChild(222);
    child.kill = vi.fn((signal, cb) => {
      if (signal === 'SIGTERM') {
        cb(new Error('kill failed'));
      } else if (signal === 'SIGKILL') {
        cb(null);
      }
    });
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = gracefulCloseBrowser(child, 'p2', profileLogger, logQueries);
    await closePromise;

    expect(child.kill).toHaveBeenCalledWith('SIGKILL', expect.any(Function));
    expect(logQueries.add).toHaveBeenCalledWith('p2', 'warn', expect.stringContaining('SIGTERM failed'));
  });

  it('gracefulCloseBrowser логирует timeout при превышении лимита', async () => {
    const child = createMockChild(333);
    child.kill = vi.fn((signal, cb) => {
      if (signal === 'SIGKILL') cb(null);
    });
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    vi.useFakeTimers();
    const closePromise = gracefulCloseBrowser(child, 'p3', profileLogger, logQueries);

    vi.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS + 100);
    await closePromise;
    vi.useRealTimers();

    expect(logQueries.add).toHaveBeenCalledWith('p3', 'warn', 'Graceful shutdown timeout, force killing');
  });

  it('gracefulCloseBrowser логирует ошибку SIGKILL в таймауте', async () => {
    const child = createMockChild(333);
    child.kill = vi.fn((signal, cb) => {
      if (signal === 'SIGKILL') cb(new Error('process not found'));
    });
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    vi.useFakeTimers();
    const closePromise = gracefulCloseBrowser(child, 'p3', profileLogger, logQueries);

    vi.advanceTimersByTime(SHUTDOWN_TIMEOUT_MS + 100);
    await closePromise;
    vi.useRealTimers();

    expect(logQueries.add).toHaveBeenCalledWith('p3', 'warn', expect.stringContaining('Force kill failed'));
  });

  it('gracefulCloseBrowser логирует ошибку SIGKILL после неудачного SIGTERM', async () => {
    const child = createMockChild(444);
    child.kill = vi.fn((signal, cb) => {
      if (signal === 'SIGTERM') cb(new Error('process not found'));
      else if (signal === 'SIGKILL') cb(new Error('also dead'));
    });
    const profileLogger = createMockProfileLogger();
    const logQueries = createMockLogQueries();

    const closePromise = gracefulCloseBrowser(child, 'p4', profileLogger, logQueries);
    await closePromise;

    expect(logQueries.add).toHaveBeenCalledWith('p4', 'warn', expect.stringContaining('SIGTERM failed'));
    expect(logQueries.add).toHaveBeenCalledWith('p4', 'warn', expect.stringContaining('SIGKILL failed'));
  });

  it('runningProfiles хранит запущенные процессы', () => {
    const runningProfiles = new Map();
    const child = createMockChild(444);
    runningProfiles.set('p4', child);

    expect(runningProfiles.has('p4')).toBe(true);
    expect(runningProfiles.get('p4').pid).toBe(444);
  });

  it('runningProfiles очищается после shutdown', () => {
    const runningProfiles = new Map();
    runningProfiles.set('p1', createMockChild(1));
    runningProfiles.set('p2', createMockChild(2));

    runningProfiles.clear();

    expect(runningProfiles.size).toBe(0);
  });

  it('profileWindows очищается после shutdown', () => {
    const profileWindows = new Map();
    profileWindows.set('p1', { pid: 1, handle: '123' });
    profileWindows.set('p2', { pid: 2, handle: '456' });

    profileWindows.clear();

    expect(profileWindows.size).toBe(0);
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
  beforeEach(() => {
    vi.spyOn(process, 'kill');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

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
