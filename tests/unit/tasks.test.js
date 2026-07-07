import { describe, it, expect, beforeEach, vi } from 'vitest';
import Database from 'better-sqlite3';

describe('TaskQueries', () => {
  let db;
  let taskQueries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        script_name TEXT NOT NULL,
        schedule_type TEXT NOT NULL CHECK(schedule_type IN ('once', 'daily', 'weekly', 'manual', 'archive')),
        cron_expression TEXT,
        params TEXT DEFAULT '{}',
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS task_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL,
        profile_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('success', 'failed', 'running')),
        exit_code INTEGER,
        last_run_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        log_file_path TEXT,
        FOREIGN KEY (task_id) REFERENCES tasks(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS profiles (
        id TEXT PRIMARY KEY,
        number INTEGER NOT NULL,
        name TEXT NOT NULL DEFAULT '',
        platform TEXT NOT NULL DEFAULT 'windows',
        fingerprint_seed TEXT NOT NULL DEFAULT '',
        user_agent TEXT NOT NULL DEFAULT '',
        screen_resolution TEXT NOT NULL DEFAULT '1920x1080',
        hardware_cores INTEGER NOT NULL DEFAULT 4,
        hardware_memory INTEGER NOT NULL DEFAULT 8,
        status TEXT DEFAULT 'stopped'
      );
    `);
    db.prepare("INSERT INTO profiles (id, number, name, platform, fingerprint_seed, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES ('p1', 1, 'test', 'windows', 'seed', 'ua', '1920x1080', 4, 8)").run();
    const { createTaskQueries } = require('../../src/db/queries.js');
    taskQueries = createTaskQueries(db);
  });

  afterEach(() => {
    db.close();
  });

  it('create and getById', () => {
    const task = taskQueries.create({
      name: 'Test Quest',
      script_name: 'concrete',
      schedule_type: 'once',
    });
    expect(task).toBeTruthy();
    expect(task.name).toBe('Test Quest');
    expect(task.script_name).toBe('concrete');
    expect(task.schedule_type).toBe('once');
    expect(task.is_active).toBe(1);
    expect(task.id).toBeTruthy();

    const fetched = taskQueries.getById(task.id);
    expect(fetched).toEqual(task);
  });

  it('create with all fields', () => {
    const task = taskQueries.create({
      name: 'Daily Quest',
      script_name: 'paragraph',
      schedule_type: 'daily',
      cron_expression: '0 9 * * *',
      params: { ref: 'abc123' },
      is_active: false,
    });
    expect(task.cron_expression).toBe('0 9 * * *');
    expect(task.params).toBe('{"ref":"abc123"}');
    expect(task.is_active).toBe(0);
  });

  it('getAll returns all tasks', () => {
    taskQueries.create({ name: 'Task 1', script_name: 'a', schedule_type: 'once' });
    taskQueries.create({ name: 'Task 2', script_name: 'b', schedule_type: 'daily' });
    const all = taskQueries.getAll();
    expect(all).toHaveLength(2);
  });

  it('update task fields', () => {
    const task = taskQueries.create({ name: 'Original', script_name: 'a', schedule_type: 'once' });
    const updated = taskQueries.update(task.id, { name: 'Updated', is_active: false });
    expect(updated.name).toBe('Updated');
    expect(updated.is_active).toBe(0);
  });

  it('delete removes task', () => {
    const task = taskQueries.create({ name: 'Delete Me', script_name: 'a', schedule_type: 'once' });
    taskQueries.delete(task.id);
    const fetched = taskQueries.getById(task.id);
    expect(fetched).toBeUndefined();
  });

  it('createExecution and getExecutions', () => {
    const task = taskQueries.create({ name: 'Exec Test', script_name: 'a', schedule_type: 'once' });
    const execId = taskQueries.createExecution(task.id, 'p1', 'running', '/logs/test.log');
    expect(execId).toBeGreaterThan(0);

    const executions = taskQueries.getExecutions(task.id);
    expect(executions).toHaveLength(1);
    expect(executions[0].task_id).toBe(task.id);
    expect(executions[0].profile_id).toBe('p1');
    expect(executions[0].status).toBe('running');
    expect(executions[0].log_file_path).toBe('/logs/test.log');
  });

  it('updateExecutionStatus', () => {
    const task = taskQueries.create({ name: 'Status Test', script_name: 'a', schedule_type: 'once' });
    const execId = taskQueries.createExecution(task.id, 'p1', 'running');
    taskQueries.updateExecutionStatus(execId, 'success', 0);
    const executions = taskQueries.getExecutions(task.id);
    expect(executions[0].status).toBe('success');
    expect(executions[0].exit_code).toBe(0);
  });

  it('getActive returns only active tasks', () => {
    taskQueries.create({ name: 'Active', script_name: 'a', schedule_type: 'once', is_active: true });
    taskQueries.create({ name: 'Inactive', script_name: 'b', schedule_type: 'once', is_active: false });
    const active = taskQueries.getActive();
    expect(active).toHaveLength(1);
    expect(active[0].name).toBe('Active');
  });

  it('throws on missing required fields', () => {
    expect(() => taskQueries.create({ name: 'No Script' })).toThrow();
    expect(() => taskQueries.create({ script_name: 'No Name' })).toThrow();
    expect(() => taskQueries.create({ name: 'N', script_name: 'S' })).toThrow();
  });
});
