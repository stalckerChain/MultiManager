import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'path';
import fs from 'fs';
import { initDatabase, createProfileQueries, createCookieQueries } from '../../src/db';
import { generateFingerprint } from '../../src/fingerprint';
import { getProfileDir } from '../../src/cookie/inject';
import { createProfileLogger, getAppDir } from '../../src/logger';

function cookiesToNetscape(cookies) {
  const lines = ['# Netscape HTTP Cookie File'];
  for (const c of cookies) {
    lines.push([
      c.domain,
      c.http_only ? 'TRUE' : 'FALSE',
      c.path || '/',
      c.secure ? 'TRUE' : 'FALSE',
      c.expires || 0,
      c.name,
      c.value,
    ].join('\t'));
  }
  return lines.join('\n');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

let db;
let profileQueries;
let cookieQueries;
let profile;

beforeAll(() => {
  db = initDatabase();
  db.pragma('foreign_keys = OFF');
  profileQueries = createProfileQueries(db);
  cookieQueries = createCookieQueries(db);

  db.exec('DELETE FROM run_tasks');
  db.exec('DELETE FROM runs');
  db.exec('DELETE FROM project_profile_config');
  db.exec('DELETE FROM projects');
  db.exec('DELETE FROM profiles');
  db.exec('DELETE FROM cookies');
  db.exec('DELETE FROM profile_logs');
  db.pragma('foreign_keys = ON');
});

afterAll(() => {
  db.close();
});

describe('Profile Launch Flow', () => {
  it('creates profile with fingerprint', () => {
    const fingerprint = generateFingerprint('macos');
    profile = profileQueries.create({
      name: 'Test Profile',
      platform: fingerprint.platform,
      fingerprint_seed: fingerprint.fingerprint_seed,
      user_agent: fingerprint.user_agent,
      screen_resolution: fingerprint.screen_resolution,
      hardware_cores: fingerprint.hardware_cores,
      hardware_memory: fingerprint.hardware_memory,
    });
    expect(profile.id).toBeTruthy();
    expect(profile.name).toBe('Test Profile');
    expect(profile.fingerprint_seed).toBeTruthy();
  });

  it('imports cookies', () => {
    const testCookies = [
      { name: 'session_id', value: 'abc123xyz', domain: '.example.com', path: '/', httpOnly: true, secure: true },
      { name: 'user_pref', value: 'dark_mode', domain: '.example.com', path: '/settings', httpOnly: false, secure: false, expires: Math.floor(Date.now() / 1000) + 86400 },
      { name: 'token', value: 'jwt_token_here', domain: '.api.example.com', path: '/auth', httpOnly: true, secure: true },
    ];
    cookieQueries.import(profile.id, testCookies);
    const savedCookies = cookieQueries.getByProfileId(profile.id);
    expect(savedCookies.length).toBe(3);
  });

  it('injects cookies into profile directory', () => {
    const cookies = cookieQueries.getByProfileId(profile.id);
    expect(cookies.length).toBe(3);

    const profileDir = getProfileDir(profile.id);
    ensureDir(path.join(profileDir, 'Default'));

    const cookieFile = path.join(profileDir, 'Default', 'Cookies');
    fs.writeFileSync(cookieFile, cookiesToNetscape(cookies), 'utf-8');

    expect(fs.existsSync(cookieFile)).toBe(true);

    const content = fs.readFileSync(cookieFile, 'utf-8');
    const lines = content.split('\n').filter(l => l && !l.startsWith('#'));
    expect(lines.length).toBe(3);
    expect(content).toContain('.example.com');
    expect(content).toContain('session_id');
  });

  it('creates profile logger writing to file', async () => {
    const profileLogger = createProfileLogger(profile.id);
    profileLogger.info({ profileId: profile.id }, 'Профиль запущен');
    profileLogger.info({ cookieCount: 3 }, 'Куки инжектированы');

    await new Promise(r => setTimeout(r, 200));

    const appDir = getAppDir();
    const logFile = path.join(appDir, 'logs', `profile_${profile.id}.log`);
    expect(fs.existsSync(logFile)).toBe(true);

    const logContent = fs.readFileSync(logFile, 'utf-8');
    expect(logContent).toContain('Профиль запущен');
    expect(logContent).toContain('Куки инжектированы');
  });
});
