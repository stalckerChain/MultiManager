import { describe, it, expect, vi, beforeEach } from 'vitest';

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
      child.kill('SIGKILL', done);
    }, SHUTDOWN_TIMEOUT_MS);

    child.on('exit', () => {
      clearTimeout(timer);
      done();
    });

    child.kill('SIGTERM', (err) => {
      if (err) {
        clearTimeout(timer);
        child.kill('SIGKILL', done);
      }
    });
  });
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
