import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { createTables } from '../../src/db/schema.js';
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
