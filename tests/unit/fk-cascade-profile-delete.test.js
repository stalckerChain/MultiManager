import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTables, migrateTables } from '../../src/db/schema';

function createMigratedDb() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys = ON');
  createTables(db);

  db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'Test', 'seed1', 'windows', 'ua', '1920x1080', 4, 8);
  db.prepare(`INSERT INTO projects (name, display_name) VALUES (?, ?)`).run('proj1', 'Project 1');
  db.prepare(`INSERT INTO runs (id, status) VALUES (?, ?)`).run('run1', 'completed');
  db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
    VALUES (?, ?, ?, ?)`).run('run1', 'proj1', 'p1', 'success');

  return db;
}

describe('FK Cascade — profile delete with run_tasks', () => {

  it('блокирует DELETE профиля без CASCADE если есть run_tasks', () => {
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE profiles (id TEXT PRIMARY KEY, name TEXT);
      CREATE TABLE run_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT, profile_id TEXT NOT NULL,
        FOREIGN KEY (profile_id) REFERENCES profiles(id)
      );
    `);
    db.prepare('INSERT INTO profiles (id, name) VALUES (?, ?)').run('p1', 'Test');
    db.prepare('INSERT INTO run_tasks (profile_id) VALUES (?)').run('p1');

    expect(() => db.prepare('DELETE FROM profiles WHERE id = ?').run('p1')).toThrow('FOREIGN KEY');
  });

  it('позволяет DELETE профиля с CASCADE даже если есть run_tasks', () => {
    const db = createMigratedDb();
    migrateTables(db);

    db.prepare('DELETE FROM profiles WHERE id = ?').run('p1');
    const remaining = db.prepare('SELECT * FROM run_tasks WHERE profile_id = ?').all('p1');
    expect(remaining.length).toBe(0);
  });

  it('миграция добавляет ON DELETE CASCADE в run_tasks', () => {
    const db = createMigratedDb();
    migrateTables(db);

    const fks = db.pragma('foreign_key_list(run_tasks)');
    const profileFk = fks.find(fk => fk.table === 'profiles');
    expect(profileFk).toBeTruthy();
    expect(profileFk.on_delete).toBe('CASCADE');
  });

  it('миграция не пересоздаёт таблицу если CASCADE уже есть', () => {
    const db = createMigratedDb();
    migrateTables(db);
    const sqlBefore = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='run_tasks'").pluck().get();

    migrateTables(db);
    const sqlAfter = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='run_tasks'").pluck().get();
    expect(sqlAfter).toBe(sqlBefore);
  });
});

describe('API profile DELETE — error handling', () => {
  let db;
  let queries;

  beforeEach(() => {
    db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    createTables(db);
    migrateTables(db);

    db.prepare(`INSERT INTO profiles (id, number, name, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run('p1', 1, 'Test', 'seed1', 'windows', 'ua', '1920x1080', 4, 8);
    db.prepare(`INSERT INTO projects (name, display_name) VALUES (?, ?)`).run('proj1', 'Project 1');
    db.prepare(`INSERT INTO runs (id, status) VALUES (?, ?)`).run('run1', 'completed');
    db.prepare(`INSERT INTO run_tasks (run_id, project_name, profile_id, status)
      VALUES (?, ?, ?, ?)`).run('run1', 'proj1', 'p1', 'success');

    queries = {
      getById: (id) => db.prepare('SELECT * FROM profiles WHERE id = ?').get(id),
      delete: (id) => db.prepare('DELETE FROM profiles WHERE id = ?').run(id),
    };
  });

  it('удаляет профиль с CASCADE — run_tasks очищаются', () => {
    queries.delete('p1');
    const tasks = db.prepare('SELECT * FROM run_tasks WHERE profile_id = ?').all('p1');
    expect(tasks.length).toBe(0);
  });
});