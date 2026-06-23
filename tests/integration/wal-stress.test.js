import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('SQLite WAL Stress Test', () => {
  let db;
  let dbDir;
  let insertStmt;
  let readStmt;

  beforeAll(() => {
    dbDir = mkdtempSync(join(tmpdir(), 'wal-test-'));
    db = new Database(join(dbDir, 'test.db'));
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    db.exec(`
      CREATE TABLE stress_test (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        thread_id INTEGER NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        data TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    insertStmt = db.prepare('INSERT INTO stress_test (thread_id, counter, data) VALUES (?, ?, ?)');
    readStmt = db.prepare('SELECT COUNT(*) as cnt, SUM(counter) as total FROM stress_test');
  });

  afterAll(() => {
    db.close();
    rmSync(dbDir, { recursive: true, force: true });
  });

  it('5 параллельных потоков записи не блокируют БД', async () => {
    const THREADS = 5;
    const WRITES_PER_THREAD = 100;
    const errors = [];

    async function writer(threadId) {
      for (let i = 0; i < WRITES_PER_THREAD; i++) {
        try {
          insertStmt.run(threadId, i, `thread-${threadId}-iter-${i}`);
        } catch (err) {
          errors.push({ threadId, iter: i, error: err.message });
        }
        if (i % 10 === 0) {
          await new Promise(r => setTimeout(r, 1));
        }
      }
    }

    const promises = [];
    for (let t = 0; t < THREADS; t++) {
      promises.push(writer(t));
    }

    await Promise.all(promises);

    expect(errors).toHaveLength(0);

    const result = readStmt.get();
    expect(result.cnt).toBe(THREADS * WRITES_PER_THREAD);
    expect(result.total).toBe((THREADS * (WRITES_PER_THREAD - 1) * WRITES_PER_THREAD) / 2);
  });

  it('параллельные чтения и записи не конфликтуют', async () => {
    db.exec('DELETE FROM stress_test');

    const READERS = 3;
    const WRITERS = 3;
    const OPS = 50;
    const readResults = [];
    const writeErrors = [];

    async function reader(readerId) {
      for (let i = 0; i < OPS; i++) {
        try {
          const result = readStmt.get();
          readResults.push({ readerId, iter: i, count: result.cnt });
        } catch (err) {
          readResults.push({ readerId, iter: i, error: err.message });
        }
        await new Promise(r => setTimeout(r, 1));
      }
    }

    async function writer(writerId) {
      for (let i = 0; i < OPS; i++) {
        try {
          insertStmt.run(writerId + READERS, i, `mixed-${writerId}-${i}`);
        } catch (err) {
          writeErrors.push({ writerId, iter: i, error: err.message });
        }
        await new Promise(r => setTimeout(r, 1));
      }
    }

    const promises = [];
    for (let r = 0; r < READERS; r++) promises.push(reader(r));
    for (let w = 0; w < WRITERS; w++) promises.push(writer(w));

    await Promise.all(promises);

    expect(writeErrors).toHaveLength(0);

    const readErrors = readResults.filter(r => r.error);
    expect(readErrors).toHaveLength(0);
  });

  it('WAL режим активен', () => {
    const result = db.pragma('journal_mode', { simple: true });
    expect(result).toBe('wal');
  });

  it('foreign keys включены', () => {
    const result = db.pragma('foreign_keys', { simple: true });
    expect(result).toBe(1);
  });

  it('ACID транзакция работает корректно', () => {
    db.exec('DELETE FROM stress_test');

    const insertMany = db.transaction((items) => {
      for (const item of items) {
        insertStmt.run(item.thread, item.counter, item.data);
      }
    });

    const items = [];
    for (let i = 0; i < 100; i++) {
      items.push({ thread: 0, counter: i, data: `item-${i}` });
    }

    insertMany(items);

    const result = readStmt.get();
    expect(result.cnt).toBe(100);
  });
});
