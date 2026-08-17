import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import { readFileSync } from 'fs';
import fs from 'fs';
import path from 'path';
import os from 'os';

const dbMod = require('../../src/db/index.js');
const profileInfoRouter = require('../../src/api/profile-info.js');

const PROFILE_INFO_JS = new URL('../../src/api/profile-info.js', import.meta.url);
const APP_JS = new URL('../../src/core/app.js', import.meta.url);

function insertProfile(overrides = {}) {
  const db = dbMod.getDatabase();
  const defaults = {
    id: 'p1',
    number: 1,
    name: 'Test Account',
    email: 'user@example.com',
    email_password: 'email-secret-xyz',
    wallet_evm_address: '0x1234567890abcdef1234567890abcdef12345678',
    wallet_sol_address: 'SOL_ADDRESS_XYZ',
    twitter_username: 'x_user',
    twitter_password: 'twitter-secret-xyz',
    twitter_auth_token: 'twitter-auth-token-xyz',
    twitter_email: 'tw@example.com',
    discord_username: 'disc_user',
    discord_password: 'discord-secret-xyz',
    discord_token: 'discord-token-xyz',
    discord_email: 'dc@example.com',
    wallet_password: 'wallet-secret-xyz',
    fingerprint_seed: 'seed-1',
    platform: 'windows',
    user_agent: 'Mozilla/5.0',
    screen_resolution: '1920x1080',
    hardware_cores: 4,
    hardware_memory: 8,
    proxy_id: null,
    profile_path: null,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO profiles
      (id, number, name, email, email_password, wallet_evm_address, wallet_sol_address,
       twitter_username, twitter_password, twitter_auth_token, twitter_email,
       discord_username, discord_password, discord_token, discord_email,
       wallet_password, fingerprint_seed, platform, user_agent, screen_resolution,
       hardware_cores, hardware_memory, proxy_id, profile_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaults.id,
    defaults.number,
    defaults.name,
    defaults.email,
    defaults.email_password,
    defaults.wallet_evm_address,
    defaults.wallet_sol_address,
    defaults.twitter_username,
    defaults.twitter_password,
    defaults.twitter_auth_token,
    defaults.twitter_email,
    defaults.discord_username,
    defaults.discord_password,
    defaults.discord_token,
    defaults.discord_email,
    defaults.wallet_password,
    defaults.fingerprint_seed,
    defaults.platform,
    defaults.user_agent,
    defaults.screen_resolution,
    defaults.hardware_cores,
    defaults.hardware_memory,
    defaults.proxy_id,
    defaults.profile_path
  );
  return defaults;
}

function insertProxy(overrides = {}) {
  const db = dbMod.getDatabase();
  const defaults = {
    type: 'http',
    host: 'proxy.example.com',
    port: 8080,
    username: 'proxy-user-xyz',
    password: 'proxy-pass-xyz',
    proxy_rotation_url: null,
    last_ip: '1.2.3.4',
    location: 'DE(Germany)',
    ...overrides,
  };
  db.prepare(`
    INSERT INTO proxies (type, host, port, username, password, proxy_rotation_url, last_ip, location)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaults.type,
    defaults.host,
    defaults.port,
    defaults.username,
    defaults.password,
    defaults.proxy_rotation_url,
    defaults.last_ip,
    defaults.location
  );
  return db.prepare('SELECT last_insert_rowid() AS id').get().id;
}

describe('GET /profile-info/:profileId', () => {
  let tmpDir;
  let originalAppData;
  let app;

  beforeEach(() => {
    originalAppData = process.env.APPDATA;
    tmpDir = path.join(os.tmpdir(), 'profile-info-test-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    process.env.APPDATA = tmpDir;

    dbMod.initDatabase();
    dbMod.getDatabase().exec('DELETE FROM profiles');
    dbMod.getDatabase().exec('DELETE FROM proxies');

    app = express();
    app.use('/profile-info', profileInfoRouter);
  });

  afterEach(() => {
    dbMod.closeDatabase();
    process.env.APPDATA = originalAppData;
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns HTML with the account name in <title> and page header', async () => {
    insertProfile();
    const res = await request(app).get('/profile-info/p1');

    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/html/);
    expect(res.text).toContain('<title>Test Account</title>');
    expect(res.text).toMatch(/<h1>Test Account<\/h1>/);
  });

  it('shows all agreed field groups from profile and proxy', async () => {
    const proxyId = insertProxy();
    insertProfile({ proxy_id: proxyId });

    const res = await request(app).get('/profile-info/p1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('user@example.com');
    expect(res.text).toContain('0x1234567890abcdef1234567890abcdef12345678');
    expect(res.text).toContain('SOL_ADDRESS_XYZ');
    expect(res.text).toContain('x_user');
    expect(res.text).toContain('disc_user');
    expect(res.text).toContain('1.2.3.4');
    expect(res.text).toContain('DE(Germany)');
    expect(res.text).toContain('X username');
    expect(res.text).toContain('Локация прокси');
  });

  it('returns 404 with JSON error for an unknown profileId', async () => {
    const res = await request(app).get('/profile-info/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Профиль/);
  });

  it('never includes secret fields or credentials in the HTML', async () => {
    const proxyId = insertProxy();
    insertProfile({ proxy_id: proxyId });

    const res = await request(app).get('/profile-info/p1');

    const secrets = [
      'email-secret-xyz',
      'twitter-secret-xyz',
      'twitter-auth-token-xyz',
      'discord-secret-xyz',
      'discord-token-xyz',
      'wallet-secret-xyz',
      'proxy-user-xyz',
      'proxy-pass-xyz',
      'seed-1',
    ];
    for (const secret of secrets) {
      expect(res.text).not.toContain(secret);
    }
    // Пароль и токены не появляются даже как ключи/подписи.
    expect(res.text).not.toContain('password');
    expect(res.text).not.toContain('token');
  });

  it('escapes user values so markup cannot be injected', async () => {
    insertProfile({
      name: `<script>alert('xss')</script>`,
      email: `<img src=x onerror=alert(1)>`,
      twitter_username: `"><b>bold</b>`,
      wallet_evm_address: `a&b"c'`,
    });

    const res = await request(app).get('/profile-info/p1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('&lt;script&gt;');
    expect(res.text).not.toContain(`<script>alert('xss')`);
    expect(res.text).toContain('&lt;img');
    expect(res.text).toContain('&lt;b&gt;bold&lt;/b&gt;');
    expect(res.text).toContain('a&amp;b&quot;c&#39;');
    // Ни один неэкранированный тег не прошёл в разметку.
    expect(res.text).not.toMatch(/<script>/);
    expect(res.text).not.toMatch(/<img/);
    expect(res.text).not.toMatch(/<b>bold<\/b>/);
  });

  it('shows a uniform placeholder for missing fields', async () => {
    insertProfile({
      email: null,
      wallet_evm_address: '',
      wallet_sol_address: null,
      twitter_username: '',
      discord_username: null,
    });

    const res = await request(app).get('/profile-info/p1');

    expect(res.status).toBe(200);
    // Единообразный placeholder для всех пустых значений.
    const occurrences = res.text.match(/Не указано/g);
    expect(occurrences).not.toBeNull();
    // email, EVM, SOL, X, Discord, IP, location — 7 полей без значения.
    expect(occurrences.length).toBe(7);
  });

  it('missing proxy does not break the page and shows placeholders for IP/location', async () => {
    // Прямой профиль со ссылкой на несуществующий прокси: страница обязана
    // отработать без ошибки, IP/location показать placeholder.
    const db = dbMod.getDatabase();
    db.pragma('foreign_keys = OFF');
    insertProfile({ proxy_id: 999 });
    db.pragma('foreign_keys = ON');

    const res = await request(app).get('/profile-info/p1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Test Account');
    expect(res.text).toContain('Не указано');
    expect(res.text).toContain('IP прокси');
    expect(res.text).toContain('Локация прокси');
  });

  it('shows placeholder when proxy has no last_ip or location', async () => {
    const proxyId = insertProxy({ last_ip: null, location: null });
    insertProfile({ proxy_id: proxyId });

    const res = await request(app).get('/profile-info/p1');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Не указано');
  });
});

describe('Profile info — source-level safety', () => {
  it('profile-info.js does not reference any secret field', () => {
    const content = readFileSync(PROFILE_INFO_JS, 'utf-8');
    for (const secret of [
      'email_password',
      'wallet_password',
      'twitter_password',
      'twitter_auth_token',
      'twitter_email',
      'discord_password',
      'discord_token',
      'discord_email',
      'fingerprint_seed',
    ]) {
      expect(content).not.toContain(secret);
    }
    expect(content).not.toContain('.username');
    expect(content).not.toContain('.password');
    expect(content).not.toContain('proxy_rotation_url');
  });

  it('profile-info.js exports the router directly (no factory)', () => {
    const content = readFileSync(PROFILE_INFO_JS, 'utf-8');
    expect(content).toMatch(/module\.exports\s*=\s*router/);
  });

  it('app.js mounts /profile-info before authMiddleware (public loopback endpoint)', () => {
    const content = readFileSync(APP_JS, 'utf-8');
    const profileInfoIdx = content.indexOf("app.use('/profile-info', profileInfoRouter)");
    const authIdx = content.indexOf('app.use(authMiddleware)');
    expect(profileInfoIdx).toBeGreaterThan(-1);
    expect(profileInfoIdx).toBeLessThan(authIdx);
    // Endpoint монтируется вне /api/ префикса, поэтому apiLimiter к нему не применяется.
    expect(content).toMatch(/app\.use\('\/api\/', apiLimiter\)/);
  });
});