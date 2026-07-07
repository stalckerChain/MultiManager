import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { createTables, migrateTables } from '../../src/db/schema.js';
import { createProfileQueries, createProxyQueries, createCookieQueries, createLogQueries } from '../../src/db/queries.js';

describe('Database Queries', () => {
  let db;

  beforeAll(() => {
    db = new Database(':memory:');
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    createTables(db);
  });

  afterAll(() => {
    db.close();
  });

  describe('Profiles', () => {
    beforeEach(() => {
      db.exec('DELETE FROM profiles');
    });

    it('создаёт профиль', () => {
      const queries = createProfileQueries(db);
      const profile = queries.create({
        name: 'Test Profile',
        platform: 'windows',
        fingerprint_seed: 'seed-123',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
      });

      expect(profile.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(profile.name).toBe('Test Profile');
      expect(profile.status).toBe('stopped');
    });

    it('получает профиль по ID', () => {
      const queries = createProfileQueries(db);
      const created = queries.create({
        name: 'Get Test',
        platform: 'macos',
        fingerprint_seed: 'seed-456',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '2560x1600',
        hardware_cores: 10,
        hardware_memory: 24,
      });

      const found = queries.getById(created.id);
      expect(found).toBeTruthy();
      expect(found.name).toBe('Get Test');
    });

    it('обновляет статус профиля', () => {
      const queries = createProfileQueries(db);
      const created = queries.create({
        name: 'Status Test',
        platform: 'linux',
        fingerprint_seed: 'seed-789',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 4,
        hardware_memory: 8,
      });

      queries.updateStatus(created.id, 'running');
      const updated = queries.getById(created.id);
      expect(updated.status).toBe('running');
    });

    it('удаляет профиль', () => {
      const queries = createProfileQueries(db);
      const created = queries.create({
        name: 'Delete Test',
        platform: 'windows',
        fingerprint_seed: 'seed-delete',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
      });

      queries.delete(created.id);
      const found = queries.getById(created.id);
      expect(found).toBeUndefined();
    });
  });

  describe('Proxies', () => {
    beforeEach(() => {
      db.exec('DELETE FROM proxies');
    });

    it('создаёт прокси', () => {
      const queries = createProxyQueries(db);
      const proxy = queries.create({
        type: 'socks5',
        host: 'proxy.com',
        port: 1080,
        username: 'user',
        password: 'pass',
      });

      expect(proxy.id).toBeGreaterThan(0);
      expect(proxy.type).toBe('socks5');
    });

    it('получает прокси по ID', () => {
      const queries = createProxyQueries(db);
      const created = queries.create({
        type: 'http',
        host: 'test.com',
        port: 8080,
      });

      const found = queries.getById(created.id);
      expect(found.host).toBe('test.com');
    });

    it('обновляет last_ip', () => {
      const queries = createProxyQueries(db);
      const created = queries.create({
        type: 'socks5',
        host: 'proxy.com',
        port: 1080,
      });

      queries.updateLastIp(created.id, '1.2.3.4');
      const updated = queries.getById(created.id);
      expect(updated.last_ip).toBe('1.2.3.4');
    });
  });

  describe('Cookies', () => {
    let profileId;

    beforeEach(() => {
      db.exec('DELETE FROM cookies');
      db.exec('DELETE FROM profiles');
      const profileQueries = createProfileQueries(db);
      const profile = profileQueries.create({
        name: 'Cookie Test',
        platform: 'windows',
        fingerprint_seed: 'seed-cookie',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
      });
      profileId = profile.id;
    });

    it('импортирует куки', () => {
      const queries = createCookieQueries(db);
      queries.import(profileId, [
        { name: 'session', value: 'abc', domain: '.example.com' },
        { name: 'token', value: 'xyz', domain: '.test.com' },
      ]);

      const cookies = queries.getByProfileId(profileId);
      expect(cookies).toHaveLength(2);
    });

    it('удаляет куки профиля', () => {
      const queries = createCookieQueries(db);
      queries.import(profileId, [
        { name: 'session', value: 'abc', domain: '.example.com' },
      ]);

      queries.deleteByProfileId(profileId);
      const cookies = queries.getByProfileId(profileId);
      expect(cookies).toHaveLength(0);
    });
  });

  describe('New Profile Fields', () => {
    beforeEach(() => {
      db.exec('DELETE FROM profiles');
    });

    it('создаёт профиль с новыми полями', () => {
      const queries = createProfileQueries(db);
      const profile = queries.create({
        name: 'Full Profile',
        platform: 'windows',
        fingerprint_seed: 'seed-full',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
        timezone: 'Europe/Berlin',
        email: 'user@example.com',
        email_password: 'secret123',
        twitter_username: 'tw_user',
        twitter_password: 'tw_pass',
        twitter_auth_token: 'tw_token',
        twitter_email: 'tw@example.com',
        discord_username: 'dc_user',
        discord_password: 'dc_pass',
        discord_token: 'dc_token',
        discord_email: 'dc@example.com',
        wallet_evm_address: '0x1234567890abcdef1234567890abcdef12345678',
        wallet_sol_address: 'AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd',
        wallet_password: 'wallet_pass',
      });

      expect(profile.timezone).toBe('Europe/Berlin');
      expect(profile.email).toBe('user@example.com');
      expect(profile.email_password).toBe('secret123');
      expect(profile.twitter_username).toBe('tw_user');
      expect(profile.twitter_password).toBe('tw_pass');
      expect(profile.twitter_auth_token).toBe('tw_token');
      expect(profile.twitter_email).toBe('tw@example.com');
      expect(profile.discord_username).toBe('dc_user');
      expect(profile.discord_password).toBe('dc_pass');
      expect(profile.discord_token).toBe('dc_token');
      expect(profile.discord_email).toBe('dc@example.com');
      expect(profile.wallet_evm_address).toBe('0x1234567890abcdef1234567890abcdef12345678');
      expect(profile.wallet_sol_address).toBe('AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd');
      expect(profile.wallet_password).toBe('wallet_pass');
    });

    it('применяет дефолты для новых полей', () => {
      const queries = createProfileQueries(db);
      const profile = queries.create({
        name: 'Defaults Profile',
        platform: 'macos',
        fingerprint_seed: 'seed-defaults',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '2560x1600',
        hardware_cores: 10,
        hardware_memory: 24,
      });

      expect(profile.timezone).toBe('Asia/Bishkek');
      expect(profile.email).toBeNull();
      expect(profile.email_password).toBeNull();
      expect(profile.wallet_password).toBe('asdfj*KK');
    });

    it('обновляет новые поля', () => {
      const queries = createProfileQueries(db);
      const created = queries.create({
        name: 'Update Test',
        platform: 'windows',
        fingerprint_seed: 'seed-upd',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
        timezone: 'Asia/Bishkek',
      });

      const updated = queries.update(created.id, {
        timezone: 'America/New_York',
        email: 'updated@example.com',
        twitter_username: 'new_tw',
        wallet_evm_address: '0xabcdef1234567890abcdef1234567890abcdef12',
      });

      expect(updated.timezone).toBe('America/New_York');
      expect(updated.email).toBe('updated@example.com');
      expect(updated.twitter_username).toBe('new_tw');
      expect(updated.wallet_evm_address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
    });
  });

  describe('Tasks & Task Executions', () => {
    beforeEach(() => {
      db.exec('DELETE FROM task_executions');
      db.exec('DELETE FROM tasks');
    });

    it('создаёт задачу', () => {
      const id = uuidv4();
      db.prepare(`
        INSERT INTO tasks (id, name, script_name, schedule_type, params, is_active)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(id, 'Test Task', 'script.py', 'daily', JSON.stringify({ key: 'val' }), 1);

      const task = db.prepare('SELECT * FROM tasks WHERE id = ?').get(id);
      expect(task.name).toBe('Test Task');
      expect(task.script_name).toBe('script.py');
      expect(task.schedule_type).toBe('daily');
      expect(task.is_active).toBe(1);
    });

    it('создаёт запись выполнения задачи', () => {
      const taskId = uuidv4();
      const profileQueries = createProfileQueries(db);
      const profile = profileQueries.create({
        name: 'Exec Test',
        platform: 'windows',
        fingerprint_seed: 'seed-exec',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
      });

      db.prepare(`
        INSERT INTO tasks (id, name, script_name, schedule_type, is_active)
        VALUES (?, ?, ?, ?, ?)
      `).run(taskId, 'Task', 'test.py', 'manual', 1);

      db.prepare(`
        INSERT INTO task_executions (task_id, profile_id, status, exit_code, last_run_at, log_file_path)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(taskId, profile.id, 'success', 0, new Date().toISOString(), '/tmp/log.txt');

      const exec = db.prepare('SELECT * FROM task_executions WHERE task_id = ?').all(taskId);
      expect(exec).toHaveLength(1);
      expect(exec[0].status).toBe('success');
      expect(exec[0].exit_code).toBe(0);
    });

    it('каскадно удаляет выполнения при удалении задачи', () => {
      const taskId = uuidv4();
      const profileQueries = createProfileQueries(db);
      const profile = profileQueries.create({
        name: 'Cascade Test',
        platform: 'windows',
        fingerprint_seed: 'seed-cascade',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
      });

      db.prepare(`
        INSERT INTO tasks (id, name, script_name, schedule_type, is_active)
        VALUES (?, ?, ?, ?, ?)
      `).run(taskId, 'Task', 'test.py', 'manual', 1);

      db.prepare(`
        INSERT INTO task_executions (task_id, profile_id, status)
        VALUES (?, ?, ?)
      `).run(taskId, profile.id, 'running');

      db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);
      const execs = db.prepare('SELECT * FROM task_executions WHERE task_id = ?').all(taskId);
      expect(execs).toHaveLength(0);
    });
  });

  describe('Migration', () => {
    it('migrateTables добавляет новые колонки в существующую таблицу', () => {
      const migDb = new Database(':memory:');
      migDb.pragma('journal_mode = WAL');
      migDb.exec(`
        CREATE TABLE profiles (
          id TEXT PRIMARY KEY,
          name TEXT,
          platform TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
      `);
      migDb.exec(`
        INSERT INTO profiles (id, name, platform) VALUES ('test-id', 'Legacy', 'windows')
      `);

      migrateTables(migDb);

      const cols = migDb.prepare('PRAGMA table_info(profiles)').all().map(c => c.name);
      expect(cols).toContain('timezone');
      expect(cols).toContain('email');
      expect(cols).toContain('email_password');
      expect(cols).toContain('twitter_username');
      expect(cols).toContain('discord_username');
      expect(cols).toContain('wallet_evm_address');
      expect(cols).toContain('wallet_password');

      const profile = migDb.prepare('SELECT * FROM profiles WHERE id = ?').get('test-id');
      expect(profile.timezone).toBe('Asia/Bishkek');
      expect(profile.name).toBe('Legacy');
      migDb.close();
    });

    it('создаёт таблицы tasks и task_executions', () => {
      const migDb = new Database(':memory:');
      migDb.pragma('journal_mode = WAL');
      createTables(migDb);

      const tables = migDb.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
      ).all().map(t => t.name);
      expect(tables).toContain('tasks');
      expect(tables).toContain('task_executions');

      migDb.close();
    });
  });

  describe('Logs', () => {
    let profileId;

    beforeEach(() => {
      db.exec('DELETE FROM profile_logs');
      db.exec('DELETE FROM profiles');
      const profileQueries = createProfileQueries(db);
      const profile = profileQueries.create({
        name: 'Log Test',
        platform: 'windows',
        fingerprint_seed: 'seed-log',
        user_agent: 'Mozilla/5.0',
        screen_resolution: '1920x1080',
        hardware_cores: 8,
        hardware_memory: 16,
      });
      profileId = profile.id;
    });

    it('добавляет лог', () => {
      const queries = createLogQueries(db);
      queries.add(profileId, 'info', 'Тестовое сообщение');

      const logs = queries.getByProfileId(profileId);
      expect(logs).toHaveLength(1);
      expect(logs[0].message).toBe('Тестовое сообщение');
      expect(logs[0].level).toBe('info');
    });

    it('ограничивает количество логов', () => {
      const queries = createLogQueries(db);
      for (let i = 0; i < 10; i++) {
        queries.add(profileId, 'info', `Лог ${i}`);
      }

      const logs = queries.getByProfileId(profileId, 5);
      expect(logs).toHaveLength(5);
    });
  });
});
