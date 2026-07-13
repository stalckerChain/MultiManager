import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema';

describe('Automation tables schema', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables(db);
  });

  afterAll(() => db.close());

  it('creates projects table with all columns', () => {
    const cols = db.pragma('table_info(projects)');
    const names = cols.map(c => c.name);
    expect(names).toContain('name');
    expect(names).toContain('display_name');
    expect(names).toContain('module_path');
    expect(names).toContain('class_name');
    expect(names).toContain('is_active');
    expect(names).toContain('default_config');
    expect(names).toContain('created_at');
    expect(names).toContain('updated_at');
  });

  it('creates project_profile_config with composite PK and FKs', () => {
    const cols = db.pragma('table_info(project_profile_config)');
    const names = cols.map(c => c.name);
    expect(names).toContain('project_name');
    expect(names).toContain('profile_id');
    expect(names).toContain('is_enabled');
    expect(names).toContain('config_override');

    const fks = db.pragma('foreign_key_list(project_profile_config)');
    expect(fks.length).toBe(2);
  });

  it('creates runs table with status CHECK constraint', () => {
    const cols = db.pragma('table_info(runs)');
    const names = cols.map(c => c.name);
    expect(names).toContain('id');
    expect(names).toContain('status');
    expect(names).toContain('parallel_limit');
    expect(names).toContain('total_tasks');
    expect(names).toContain('completed_tasks');
    expect(names).toContain('success_tasks');
    expect(names).toContain('failed_tasks');
    expect(names).toContain('started_at');
    expect(names).toContain('completed_at');
  });

  it('creates run_tasks table with FKs', () => {
    const cols = db.pragma('table_info(run_tasks)');
    const names = cols.map(c => c.name);
    expect(names).toContain('run_id');
    expect(names).toContain('project_name');
    expect(names).toContain('profile_id');
    expect(names).toContain('status');
    expect(names).toContain('exit_code');
    expect(names).toContain('log_file_path');
    expect(names).toContain('attempts');
    expect(names).toContain('started_at');
    expect(names).toContain('completed_at');

    const fks = db.pragma('foreign_key_list(run_tasks)');
    expect(fks.some(fk => fk.table === 'runs')).toBe(true);
    expect(fks.some(fk => fk.table === 'projects')).toBe(true);
    expect(fks.some(fk => fk.table === 'profiles')).toBe(true);
  });

  it('enforces valid status values in runs', () => {
    const id = 'test-run-1';
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(id, 'pending');
    expect(() =>
      db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run('bad-run', 'invalid')
    ).toThrow();
  });

  it('enforces valid status values in run_tasks', () => {
    const runId = 'test-run-2';
    db.prepare('INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('prof-1', 1, 'auto_001', 's1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare('INSERT INTO projects (name, display_name) VALUES (?, ?)').run('test', 'Test Project');
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'pending');
    db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
      VALUES (?, 'test', 'prof-1', 'running')`).run(runId);
    expect(() =>
      db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
        VALUES (?, 'test', 'prof-1', 'bad')`).run(runId)
    ).toThrow();
  });

  it('cascades DELETE from projects to project_profile_config', () => {
    db.prepare('INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('prof-x', 99, 'auto_099', 's99', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare('INSERT INTO projects (name, display_name) VALUES (?, ?)').run('del-proj', 'Delete Test');
    db.prepare(`INSERT INTO project_profile_config (project_name, profile_id, is_enabled)
      VALUES ('del-proj', 'prof-x', 1)`).run();
    db.prepare('DELETE FROM projects WHERE name = ?').run('del-proj');
    const rows = db.prepare('SELECT * FROM project_profile_config WHERE project_name = ?').all('del-proj');
    expect(rows.length).toBe(0);
  });

  it('cascades DELETE from runs to run_tasks', () => {
    const runId = 'test-cascade';
    db.prepare('INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run('prof-a', 98, 'auto_098', 's98', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare('INSERT INTO projects (name, display_name) VALUES (?, ?)').run('p1', 'Project One');
    db.prepare('INSERT INTO runs (id, status) VALUES (?, ?)').run(runId, 'pending');
    db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
      VALUES (?, 'p1', 'prof-a', 'pending')`).run(runId);
    db.prepare('DELETE FROM runs WHERE id = ?').run(runId);
    const rows = db.prepare('SELECT * FROM run_tasks WHERE run_id = ?').all(runId);
    expect(rows.length).toBe(0);
  });

  it('creates indexes for performance', () => {
    const indexes = db.pragma('index_list(run_tasks)');
    const names = indexes.map(i => i.name);
    expect(names.some(n => n.includes('run_id'))).toBe(true);
  });
});
