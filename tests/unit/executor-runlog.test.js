import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { createRequire } from 'module';
import { EventEmitter } from 'events';

let RunExecutor;
let loggerDir;
let appDir;
let runSeq = 0;

beforeAll(() => {
  appDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-execrunlog-'));
  process.env.APPDATA = appDir;
  const require = createRequire(import.meta.url);
  ({ RunExecutor } = require('../../src/executor'));
  loggerDir = require('../../src/logger').getRunLogsDir();
});

afterAll(() => {
  try { fs.rmSync(appDir, { recursive: true, force: true }); } catch { /* ignore */ }
});

// Эмуляция БД run_tasks с COALESCE-семантикой (как в updateStatusStmt).
function createExecutor(overrides = {}) {
  const runId = `run-${++runSeq}`;
  const proc = new EventEmitter();
  proc.stdout = { pipe: vi.fn() };
  proc.stderr = { pipe: vi.fn() };
  proc.pid = 12345;
  const spawn = overrides.spawn || vi.fn(() => {
    setTimeout(() => proc.emit('close', 0, null), 5);
    return proc;
  });

  const rows = new Map();
  const initial = overrides.initialTasks || [
    { id: 1, project_name: 'concrete', profile_id: 'p1', status: 'pending' },
  ];
  for (const t of initial) rows.set(t.id, { ...t });

  const updateRunTaskStatus = vi.fn((taskId, status, exitCode, logPath, attempts, errorMessage) => {
    const row = rows.get(taskId) || {};
    rows.set(taskId, {
      ...row,
      status: status ?? row.status,
      exit_code: exitCode ?? row.exit_code,
      log_file_path: logPath ?? row.log_file_path,
      error_message: errorMessage ?? row.error_message,
    });
  });

  const executor = new RunExecutor({ id: runId, status: 'running', parallel_limit: 2 }, {
    stAuto0Path: 'C:\\stAuto0',
    pythonPath: 'python',
    apiToken: 'tok_secret',
    mmPort: 3000,
    spawn,
    getRunTasks: () => Promise.resolve(Array.from(rows.values())),
    updateRunTaskStatus,
    updateRun: vi.fn(),
    incrementRun: vi.fn(),
    getProfileById: () => Promise.resolve({ id: 'p1', name: 'auto_001', extensions: JSON.stringify(['zerion']) }),
    ...overrides,
  });

  return { executor, updateRunTaskStatus, rows, runId };
}

function expectedLogFile(runId) {
  return path.join(loggerDir, runId, 'auto_001.log');
}

function readStages(runId) {
  const raw = fs.readFileSync(expectedLogFile(runId), 'utf8');
  return raw.trim().split('\n').map(l => JSON.parse(l));
}

describe('RunExecutor — безусловное создание run-лога', () => {
  it('создаёт файл лога до resolveRuntimeId и pre-flight операций', async () => {
    const { executor, runId } = createExecutor();
    await executor.start();

    const file = expectedLogFile(runId);
    expect(fs.existsSync(file)).toBe(true);
    const order = readStages(runId).map(s => s.stage);
    expect(order.indexOf('profile_preflight_started')).toBe(0);
    expect(order.indexOf('profile_preflight_started')).toBeLessThan(order.indexOf('runtime_id_resolution'));
    expect(order.indexOf('profile_preflight_started')).toBeLessThan(order.indexOf('python_spawn'));
  });

  it('run-лог уже создан, даже когда resolveRuntimeId не найден', async () => {
    const { executor, runId } = createExecutor();
    await executor.start();

    const file = expectedLogFile(runId);
    expect(fs.existsSync(file)).toBe(true);
    const stages = readStages(runId);
    expect(stages.some(s => s.stage === 'profile_preflight_started')).toBe(true);
    expect(stages.some(s => s.stage === 'runtime_id_resolution')).toBe(true);
  });

  it('run_tasks.log_file_path заполнен существующим путём во всех статусах', async () => {
    const { executor, updateRunTaskStatus, runId } = createExecutor();
    await executor.start();

    const expected = expectedLogFile(runId);
    expect(fs.existsSync(expected)).toBe(true);
    const calls = updateRunTaskStatus.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      // (taskId, status, exitCode, logPath, attempts, errorMessage)
      expect(call[3]).toBe(expected);
    }
  });

  it('ошибка spawn содержит этап в error_message', async () => {
    const failingSpawn = vi.fn(() => { throw new Error('ENOENT launch'); });
    const { executor, updateRunTaskStatus, runId } = createExecutor({ spawn: failingSpawn });
    await executor.start();

    const failedCall = updateRunTaskStatus.mock.calls.find(c => c[1] === 'failed');
    expect(failedCall).toBeDefined();
    expect(failedCall[3]).toBe(expectedLogFile(runId));
    expect(failedCall[5]).toContain('Python spawn: ENOENT launch');
  });

  it('ранняя ошибка записывается в run-лог этапом run_error', async () => {
    const failingSpawn = vi.fn(() => { throw new Error('ENOENT boom'); });
    const { executor, runId } = createExecutor({ spawn: failingSpawn });
    await executor.start();

    const err = readStages(runId).find(s => s.stage === 'run_error');
    expect(err).toBeDefined();
    expect(err.error).toContain('ENOENT');
  });

  it('не перезаписывает информативную исходную ошибку общей фразой', async () => {
    const failingSpawn = vi.fn(() => { throw new Error('spawn boom'); });
    const { executor, rows } = createExecutor({ spawn: failingSpawn });
    await executor.start();

    expect(rows.get(1).status).toBe('failed');
    expect(rows.get(1).error_message).toContain('Python spawn: spawn boom');
    // общая фраза "Profile execution failed:" не перезаписала специфичную
    expect(rows.get(1).error_message).not.toContain('Profile execution failed');
  });
});