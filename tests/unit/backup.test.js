import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import os from 'os';

const { performBackup, cleanupOldBackups, getBackupDir } = await vi.importActual('../../src/backup/index.js');

// We need to mock getAppDir to use a temp directory
let tmpDir, db, appDir;

function createTestEnv() {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'backup-test-'));
  appDir = path.join(tmpDir, 'CloakManager');
  fs.mkdirSync(appDir, { recursive: true });

  const dbPath = path.join(appDir, 'app.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE IF NOT EXISTS test (id INTEGER PRIMARY KEY, val TEXT)');
  db.prepare('INSERT INTO test (val) VALUES (?)').run('hello-world');
  return { tmpDir, appDir, db, dbPath };
}

describe('Backup Module', () => {
  beforeEach(() => {
    const env = createTestEnv();
    tmpDir = env.tmpDir;
    appDir = env.appDir;
    db = env.db;
  });

  afterEach(() => {
    if (db) {
      try { db.close(); } catch {}
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('performBackup creates a valid .db file', async () => {
    const backupPath = await performBackup(db);
    expect(backupPath).toBeTruthy();
    expect(fs.existsSync(backupPath)).toBe(true);

    const backupDb = new Database(backupPath);
    const row = backupDb.prepare('SELECT val FROM test WHERE id = 1').get();
    expect(row.val).toBe('hello-world');
    backupDb.close();
  });

  it('performBackup creates file in backups/ subdirectory', async () => {
    const backupPath = await performBackup(db);
    expect(backupPath).toMatch(/backups[\\/]app_\d{8}_\d{6}\.db$/);
  });

  it('backup filename contains timestamp', async () => {
    const before = Date.now();
    const backupPath = await performBackup(db);
    const after = Date.now();
    const match = backupPath.match(/app_(\d{8})_(\d{6})\.db$/);
    expect(match).toBeTruthy();
    expect(match[1].length).toBe(8);
    expect(match[2].length).toBe(6);
  });

  it('cleanupOldBackups removes files older than 7 days', async () => {
    const backupDir = path.join(appDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const oldFile = path.join(backupDir, 'app_20200101_120000.db');
    fs.writeFileSync(oldFile, 'old');
    const oldTime = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    fs.utimesSync(oldFile, oldTime, oldTime);

    const recentFile = path.join(backupDir, 'app_20260708_120000.db');
    fs.writeFileSync(recentFile, 'recent');

    cleanupOldBackups(backupDir);

    expect(fs.existsSync(oldFile)).toBe(false);
    expect(fs.existsSync(recentFile)).toBe(true);
  });

  it('cleanupOldBackups ignores non-backup files', async () => {
    const backupDir = path.join(appDir, 'backups');
    fs.mkdirSync(backupDir, { recursive: true });

    const otherFile = path.join(backupDir, 'something-else.txt');
    fs.writeFileSync(otherFile, 'keep me');

    cleanupOldBackups(backupDir);
    expect(fs.existsSync(otherFile)).toBe(true);
  });

  it('performBackup does not throw on empty database', async () => {
    db.close();
    const emptyDbPath = path.join(appDir, 'app.db');
    fs.unlinkSync(emptyDbPath);
    db = new Database(emptyDbPath);
    db.pragma('journal_mode = WAL');
    db.exec('CREATE TABLE IF NOT EXISTS foo (id INTEGER PRIMARY KEY)');

    const backupPath = await performBackup(db);
    expect(fs.existsSync(backupPath)).toBe(true);
  });

  it('backup is a valid and readable SQLite file', async () => {
    const backupPath = await performBackup(db);
    const backupDb = new Database(backupPath);
    backupDb.pragma('integrity_check');
    const tables = backupDb.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
    expect(tables.length).toBeGreaterThan(0);
    backupDb.close();
  });

  it('getBackupDir returns path ending with backups', () => {
    const dir = getBackupDir();
    expect(dir).toBeTruthy();
    expect(path.basename(dir)).toBe('backups');
  });
});
