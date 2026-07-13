import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RunExecutor } from '../../src/executor';
import { EventEmitter } from 'events';

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
});
