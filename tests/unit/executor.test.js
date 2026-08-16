import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RunExecutor } from '../../src/executor';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';

const mockStream = () => ({ pipe: vi.fn() });

describe('RunExecutor', () => {
  let executor, mockRun, mockSpawn;

  beforeEach(() => {
    mockRun = {
      id: 'run-001',
      status: 'running',
      parallel_limit: 2,
      total_tasks: 4,
    };

    mockSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = mockStream();
      proc.stderr = mockStream();
      proc.pid = 12345;
      setTimeout(() => proc.emit('close', 0, null), 10);
      return proc;
    });

    executor = new RunExecutor(mockRun, {
      stAuto0Path: 'C:\\stAuto0',
      pythonPath: 'python',
      apiToken: 'tok_xxx',
      mmPort: 3000,
      spawn: mockSpawn,
      getRunTasks: () => Promise.resolve([
        { id: 1, project_name: 'concrete', profile_id: 'p1', status: 'pending' },
        { id: 2, project_name: 'allscale', profile_id: 'p1', status: 'pending' },
        { id: 3, project_name: 'concrete', profile_id: 'p2', status: 'pending' },
        { id: 4, project_name: 'allscale', profile_id: 'p2', status: 'pending' },
      ]),
      updateRunTaskStatus: vi.fn(),
      updateRun: vi.fn(),
      incrementRun: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('groupByProfile groups tasks by profile_id', () => {
    executor._tasks = [
      { id: 1, project_name: 'concrete', profile_id: 'p1', status: 'pending' },
      { id: 2, project_name: 'allscale', profile_id: 'p1', status: 'pending' },
      { id: 3, project_name: 'concrete', profile_id: 'p2', status: 'pending' },
      { id: 4, project_name: 'allscale', profile_id: 'p2', status: 'pending' },
    ];
    const grouped = executor._groupByProfile();
    expect(Object.keys(grouped).length).toBe(2);
    expect(grouped['p1'].length).toBe(2);
    expect(grouped['p2'].length).toBe(2);
  });

  it('spawns with correct arguments', async () => {
    await executor.start();
    expect(mockSpawn).toHaveBeenCalledTimes(2);

    const callArgs = mockSpawn.mock.calls[0];
    expect(callArgs[0]).toBe('python');
    expect(callArgs[1].join(' ')).toContain('--project=');
    expect(callArgs[1].join(' ')).toContain('--run-id=run-001');
    expect(callArgs[1].join(' ')).toContain('--token=tok_xxx');
    expect(callArgs[2].env.MM_TOKEN).toBe('tok_xxx');
    expect(callArgs[2].cwd).toBe('C:\\stAuto0');
  });

  it('parallel_limit limits concurrent processes', async () => {
    const slowSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = mockStream();
      proc.stderr = mockStream();
      proc.pid = 99999;
      return proc;
    });

    const exec = new RunExecutor(mockRun, {
      ...executor.options,
      spawn: slowSpawn,
    });

    const startPromise = exec.start();
    await new Promise(r => setTimeout(r, 50));
    expect(slowSpawn).toHaveBeenCalledTimes(2);
    exec.cancel();
  });

  it('updates run_tasks status on start', async () => {
    await executor.start();
    expect(executor.options.updateRunTaskStatus).toHaveBeenCalled();
  });

  it('cancel kills processes and updates statuses', async () => {
    const killMock = vi.fn();
    const slowSpawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = mockStream();
      proc.stderr = mockStream();
      proc.pid = 99999;
      proc.kill = killMock;
      return proc;
    });

    const exec = new RunExecutor(mockRun, {
      ...executor.options,
      spawn: slowSpawn,
    });

    exec.start();
    await new Promise(r => setTimeout(r, 30));
    exec.cancel();
    expect(killMock).toHaveBeenCalled();
    expect(exec.options.updateRun).toHaveBeenCalledWith('run-001', 'cancelled');
  });

  it('close handler re-reads tasks from DB before marking failed', async () => {
    let callCount = 0;
    const getRunTasks = vi.fn(() => {
      callCount++;
      if (callCount === 1) {
        return Promise.resolve([
          { id: 1, project_name: 'concrete', profile_id: 'p1', status: 'pending' },
        ]);
      }
      // Second call (from close handler) — task already updated by Python
      return Promise.resolve([
        { id: 1, project_name: 'concrete', profile_id: 'p1', status: 'success' },
      ]);
    });

    const exec = new RunExecutor(
      { id: 'run-close', status: 'running', parallel_limit: 1 },
      {
        ...executor.options,
        getRunTasks,
      }
    );

    await exec.start();
    // Should NOT mark task as failed because DB shows success
    expect(executor.options.updateRunTaskStatus).not.toHaveBeenCalledWith(1, 'failed');
  });
});

describe('RunExecutor.cancel — остановка браузеров профилей через MM lifecycle', () => {
  function createLiveExecutor(profileIds, overrides = {}) {
    const spawn = vi.fn(() => {
      const proc = new EventEmitter();
      proc.stdout = mockStream();
      proc.stderr = mockStream();
      proc.pid = Math.floor(10000 + Math.random() * 90000);
      proc.kill = vi.fn();
      return proc;
    });

    const tasks = profileIds.flatMap((pid, i) => [
      { id: i * 2 + 1, project_name: 'concrete', profile_id: pid, status: 'pending' },
      { id: i * 2 + 2, project_name: 'allscale', profile_id: pid, status: 'pending' },
    ]);

    const stopProfile = vi.fn().mockResolvedValue({ status: 'stopped' });
    const updateRun = vi.fn();

    const exec = new RunExecutor(
      { id: 'run-cancel', status: 'running', parallel_limit: 4 },
      {
        stAuto0Path: 'C:\\stAuto0',
        pythonPath: 'python',
        apiToken: 'tok',
        mmPort: 3000,
        spawn,
        getRunTasks: () => Promise.resolve(tasks),
        updateRunTaskStatus: vi.fn(),
        updateRun,
        getProfileById: () => Promise.resolve({ id: 'p1', name: 'auto_001' }),
        stopProfile,
        ...overrides,
      }
    );
    return { exec, spawn, stopProfile, updateRun };
  }

  it('cancel вызывает stopProfile для каждого профиля с запущенным Python-процессом', async () => {
    const { exec, spawn, stopProfile } = createLiveExecutor(['p1', 'p2']);
    exec.start();
    await new Promise(r => setTimeout(r, 30));

    expect(spawn).toHaveBeenCalledTimes(2);
    expect(exec.processes.size).toBe(2);

    await exec.cancel();
    expect(stopProfile).toHaveBeenCalledTimes(2);
    expect(stopProfile).toHaveBeenCalledWith('p1');
    expect(stopProfile).toHaveBeenCalledWith('p2');
  });

  it('cancel инициирует остановку браузера ДО принудительного child.kill()', async () => {
    const { exec, spawn, stopProfile } = createLiveExecutor(['p1']);
    exec.start();
    await new Promise(r => setTimeout(r, 30));

    const child = exec.processes.get('p1');
    await exec.cancel();

    expect(stopProfile).toHaveBeenCalledWith('p1');
    expect(child.kill).toHaveBeenCalled();
  });

  it('cancel завершает Python-процессы и очищает this.processes', async () => {
    const { exec, spawn } = createLiveExecutor(['p1', 'p2']);
    exec.start();
    await new Promise(r => setTimeout(r, 30));

    await exec.cancel();
    expect(exec.processes.size).toBe(0);
  });

  it('cancel сохраняет статус run (cancelled)', async () => {
    const { exec, updateRun } = createLiveExecutor(['p1']);
    exec.start();
    await new Promise(r => setTimeout(r, 30));

    await exec.cancel();
    expect(updateRun).toHaveBeenCalledWith('run-cancel', 'cancelled');
  });

  it('cancel переживает ошибку stopProfile одного профиля и продолжает остальные', async () => {
    const stopProfile = vi.fn()
      .mockResolvedValueOnce({ status: 'stopped' })
      .mockRejectedValueOnce(new Error('MM API down'));
    const { exec, spawn } = createLiveExecutor(['p1', 'p2'], { stopProfile });
    exec.start();
    await new Promise(r => setTimeout(r, 30));

    await expect(exec.cancel()).resolves.toBeDefined();
    expect(stopProfile).toHaveBeenCalledTimes(2);
  });
});

// --- ZERION_ID: runtime ID resolution regression tests ---

const EXECUTOR_JS = new URL('../../src/executor/index.js', import.meta.url);

describe('Executor — ZERION_ID resolves runtime ID', () => {
  const content = readFileSync(EXECUTOR_JS, 'utf-8');

  it('uses resolveRuntimeId instead of directly using extensions[0]', () => {
    expect(content).toMatch(/resolveRuntimeId\s*\(/);
  });

  it('does NOT pass extensions[0] directly as ZERION_ID', () => {
    expect(content).not.toMatch(/zerionId\s*=\s*extensions\[0\]/);
  });

  it('passes resolved runtime ID to env ZERION_ID', () => {
    expect(content).toContain('ZERION_ID');
  });

  it('imports resolveRuntimeId from extensions', () => {
    expect(content).toMatch(/require\s*\(\s*['"]\.\.\/api\/extensions['"]\s*\)/);
  });
});
