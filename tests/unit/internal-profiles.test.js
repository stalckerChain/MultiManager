import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { router as internalRouter } from '../../src/api/internal.js';

const dbMod = require('../../src/db/index.js');

function parseRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const parts = rangeStr.split('-');
  if (parts.length !== 2) return null;
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end) || start > end) return null;
  const names = [];
  for (let i = start; i <= end; i++) {
    names.push(`auto_${String(i).padStart(3, '0')}`);
  }
  return names;
}

describe('Internal Profiles - Range Parsing', () => {
  it('parses valid range 001-003', () => {
    const result = parseRange('001-003');
    expect(result).toEqual(['auto_001', 'auto_002', 'auto_003']);
  });

  it('parses single range 001-001', () => {
    const result = parseRange('001-001');
    expect(result).toEqual(['auto_001']);
  });

  it('parses range 010-012', () => {
    const result = parseRange('010-012');
    expect(result).toEqual(['auto_010', 'auto_011', 'auto_012']);
  });

  it('returns null for invalid format', () => {
    expect(parseRange('')).toBeNull();
    expect(parseRange(null)).toBeNull();
    expect(parseRange(undefined)).toBeNull();
    expect(parseRange('abc')).toBeNull();
    expect(parseRange('001')).toBeNull();
    expect(parseRange('001-')).toBeNull();
    expect(parseRange('-010')).toBeNull();
  });

  it('returns null when start > end', () => {
    expect(parseRange('010-005')).toBeNull();
  });

  it('handles large ranges', () => {
    const result = parseRange('050-052');
    expect(result).toEqual(['auto_050', 'auto_051', 'auto_052']);
  });
});

describe('Internal Profiles - Router', () => {
  it('router exposes GET /profiles', () => {
    expect(internalRouter).toBeTruthy();
    expect(typeof internalRouter).toBe('function');
  });
});

describe('Internal Profiles - GET /profiles/:id/zerion-extension', () => {
  // Существующее расширение Zerion: имя каталога == старому fallback ID,
  // который НЕ должен возвращаться; endpoint обязан вернуть runtime ID из resolver.
  const FOLDER_NAME = 'klghhnkeealcohjjanjjdaeeggmfmlpl';
  const RUNTIME_ID = 'lfoeajgcchlidpicbabpmckkejpckcfb';
  let tmpDir;
  let app;
  let originalAppData;

  function extensionsDir() {
    return path.join(tmpDir, 'MultiManager', 'extensions');
  }

  function writeExtension(folderName, manifest) {
    const extPath = path.join(extensionsDir(), folderName);
    fs.mkdirSync(extPath, { recursive: true });
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify(manifest));
    return extPath;
  }

  function writeSecurePrefs(profileDir, runtimeId, extPath) {
    const defaultDir = path.join(profileDir, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(
      path.join(defaultDir, 'Secure Preferences'),
      JSON.stringify({ extensions: { settings: { [runtimeId]: { path: extPath } } } })
    );
  }

  function insertProfile(profile) {
    const db = dbMod.getDatabase();
    const defaults = {
      id: 'p1',
      name: 'auto_001',
      extensions: JSON.stringify([FOLDER_NAME]),
      number: 1,
      fingerprint_seed: 'seed-1',
      platform: 'windows',
      user_agent: 'Mozilla/5.0',
      screen_resolution: '1920x1080',
      hardware_cores: 4,
      hardware_memory: 8,
      profile_path: null,
      ...profile,
    };
    db.prepare(`
      INSERT INTO profiles
        (id, name, extensions, number, fingerprint_seed, platform, user_agent,
         screen_resolution, hardware_cores, hardware_memory, profile_path)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      defaults.id,
      defaults.name,
      defaults.extensions,
      defaults.number,
      defaults.fingerprint_seed,
      defaults.platform,
      defaults.user_agent,
      defaults.screen_resolution,
      defaults.hardware_cores,
      defaults.hardware_memory,
      defaults.profile_path
    );
  }

  beforeEach(() => {
    originalAppData = process.env.APPDATA;
    tmpDir = path.join(os.tmpdir(), 'internal-profile-test-' + Date.now());
    process.env.APPDATA = tmpDir;
    fs.mkdirSync(extensionsDir(), { recursive: true });

    dbMod.initDatabase();

    app = express();
    app.use('/api/internal', internalRouter);
    app.use((err, req, res, next) => {
      const status = err.status || 500;
      res.status(status).json(err.status ? { error: err.message, code: err.code } : { error: err.message });
    });
  });

  afterEach(() => {
    dbMod.closeDatabase();
    process.env.APPDATA = originalAppData;
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('returns runtime ID from resolver for the assigned extension', async () => {
    const extPath = writeExtension(FOLDER_NAME, { key: 'not-a-real-key' });
    const profilePath = path.join(tmpDir, 'profiles', 'prof-1');
    writeSecurePrefs(profilePath, RUNTIME_ID, extPath);
    insertProfile({ id: 'prof-1', profile_path: profilePath });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ id: RUNTIME_ID });
  });

  it('regression: folder named klghhnkeealcohjjanjjdaeeggmfmlpl resolves to runtime ID, not the folder name', async () => {
    const extPath = writeExtension(FOLDER_NAME, { manifest: 'x' });
    const profilePath = path.join(tmpDir, 'profiles', 'prof-1');
    writeSecurePrefs(profilePath, RUNTIME_ID, extPath);
    insertProfile({ id: 'prof-1', profile_path: profilePath });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(RUNTIME_ID);
    expect(res.body.id).not.toBe(FOLDER_NAME);
  });

  it('returns 404 when the profile does not exist', async () => {
    const res = await request(app).get('/api/internal/profiles/nonexistent/zerion-extension');

    expect(res.status).toBe(404);
    expect(res.body.error).toMatch(/Профиль/);
  });

  it('returns 400 when profile.extensions is an empty array', async () => {
    insertProfile({ id: 'prof-1', extensions: JSON.stringify([]) });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Не найдено расширение Zerion в профиле');
  });

  it('returns 400 when the first element of profile.extensions is not a string', async () => {
    insertProfile({ id: 'prof-1', extensions: JSON.stringify([123]) });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Не найдено расширение Zerion в профиле');
  });

  it('returns 400 for invalid JSON in profile.extensions', async () => {
    insertProfile({ id: 'prof-1', extensions: '{ not valid json' });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Невалидный список расширений в профиле');
  });

  it('returns 400 when the runtime ID cannot be determined', async () => {
    // manifest без key и Secure Preferences — resolver вернет null.
    writeExtension(FOLDER_NAME, { name: 'zerion' });
    insertProfile({ id: 'prof-1', profile_path: null });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Не удалось определить runtime ID расширения Zerion');
  });

  it('returns 400 when the runtime ID fails the format check', async () => {
    const extPath = writeExtension(FOLDER_NAME, { name: 'zerion' });
    const profilePath = path.join(tmpDir, 'profiles', 'prof-bad-format');
    writeSecurePrefs(profilePath, 'NOT_VALID_32', extPath);
    insertProfile({ id: 'prof-bad-format', profile_path: profilePath });

    const res = await request(app).get('/api/internal/profiles/prof-bad-format/zerion-extension');

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Runtime ID расширения Zerion имеет неверный формат');
  });

  it('returns 500 without stack trace on unexpected filesystem error', async () => {
    writeExtension(FOLDER_NAME, { name: 'zerion' });
    insertProfile({ id: 'prof-1', profile_path: 'relative-path-causes-throw' });

    const res = await request(app).get('/api/internal/profiles/prof-1/zerion-extension');

    expect(res.status).toBe(500);
    expect(res.body.error).toBe('Не удалось определить runtime ID расширения Zerion');
    expect(res.body).not.toHaveProperty('stack');
  });
});