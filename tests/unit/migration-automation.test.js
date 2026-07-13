import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTables, migrateTables } from '../../src/db/schema';

describe('migrateTables — automation tables', () => {
  let db;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, number INTEGER, name TEXT);
      CREATE TABLE IF NOT EXISTS proxies (id INTEGER PRIMARY KEY AUTOINCREMENT, host TEXT, port INTEGER);
      CREATE TABLE IF NOT EXISTS system_config (key TEXT PRIMARY KEY, value TEXT);
      CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, name TEXT, script_name TEXT,
        schedule_type TEXT CHECK(schedule_type IN ('once','daily','weekly','manual','archive')), params TEXT DEFAULT '{}');
      CREATE TABLE IF NOT EXISTS task_executions (id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT, profile_id TEXT, status TEXT, exit_code INTEGER, log_file_path TEXT);
    `);
  });

  it('добавляет таблицы projects, project_profile_config, runs, run_tasks если их нет', () => {
    expect(db.pragma('table_info(projects)').length).toBe(0);
    migrateTables(db);
    expect(db.pragma('table_info(projects)').length).toBeGreaterThan(0);
    expect(db.pragma('table_info(project_profile_config)').length).toBeGreaterThan(0);
    expect(db.pragma('table_info(runs)').length).toBeGreaterThan(0);
    expect(db.pragma('table_info(run_tasks)').length).toBeGreaterThan(0);
  });

  it('не трогает существующие таблицы', () => {
    migrateTables(db);
    const profilesCols = db.pragma('table_info(profiles)').length;
    migrateTables(db);
    expect(db.pragma('table_info(profiles)').length).toBe(profilesCols);
  });
});
