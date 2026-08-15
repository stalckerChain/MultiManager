import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import profilesRouter from '../../src/api/profiles';
import { getDatabase, createProfileQueries } from '../../src/db';

let tmpDir;
let originalAppData;
let app;
let profileId;

beforeEach(() => {
  originalAppData = process.env.APPDATA;
  tmpDir = path.join(os.tmpdir(), 'profiles-fp-test-' + Date.now());
  process.env.APPDATA = tmpDir;
  fs.mkdirSync(tmpDir, { recursive: true });

  const { initDatabase, closeDatabase } = require('../../src/db/index.js');
  const db = initDatabase();

  const profile = createProfileQueries(db).create({
    name: 'FP Test',
    platform: 'windows',
    fingerprint_seed: 'e73d9c0c-3960-4d9c-8096-b8359a39fe92',
    user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
    screen_resolution: '1920x1080',
    hardware_cores: 8,
    hardware_memory: 16,
    timezone: 'UTC',
  });
  profileId = profile.id;

  app = express();
  app.use(express.json());
  app.use('/api/profiles', profilesRouter);
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json(err.status ? { error: err.message, code: err.code } : { error: err.message });
  });
});

afterEach(() => {
  const { closeDatabase } = require('../../src/db/index.js');
  closeDatabase();
  process.env.APPDATA = originalAppData;
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

const FULL_SET = {
  fingerprint_seed: 'b1829f45-c541-440e-ac7b-edaded143954',
  user_agent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  screen_resolution: '2560x1440',
  hardware_cores: 12,
  hardware_memory: 32,
  fingerprint_platform: 'windows',
};

describe('Profiles API - fingerprint update', () => {
  it('saves provided fingerprint set on update', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ name: 'Renamed', platform: 'windows', ...FULL_SET });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Renamed');
    expect(res.body.fingerprint_seed).toBe(FULL_SET.fingerprint_seed);
    expect(res.body.user_agent).toBe(FULL_SET.user_agent);
    expect(res.body.screen_resolution).toBe(FULL_SET.screen_resolution);
    expect(res.body.hardware_cores).toBe(12);
    expect(res.body.hardware_memory).toBe(32);
  });

  it('persists the new seed after a subsequent GET', async () => {
    await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ platform: 'windows', ...FULL_SET });

    const res = await request(app).get(`/api/profiles/${profileId}`);
    expect(res.status).toBe(200);
    expect(res.body.fingerprint_seed).toBe(FULL_SET.fingerprint_seed);
    expect(res.body.user_agent).toBe(FULL_SET.user_agent);
    expect(res.body.hardware_cores).toBe(12);
    expect(res.body.hardware_memory).toBe(32);
  });

  it('keeps existing fingerprint values when no set is provided and platform unchanged', async () => {
    const before = await request(app).get(`/api/profiles/${profileId}`);

    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ name: 'Only Name' });

    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Only Name');
    expect(res.body.fingerprint_seed).toBe(before.body.fingerprint_seed);
    expect(res.body.user_agent).toBe(before.body.user_agent);
    expect(res.body.hardware_cores).toBe(before.body.hardware_cores);
    expect(res.body.hardware_memory).toBe(before.body.hardware_memory);
  });

  it('auto-generates a new fingerprint on platform change without a provided set', async () => {
    const before = await request(app).get(`/api/profiles/${profileId}`);

    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ platform: 'macos' });

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('macos');
    expect(res.body.fingerprint_seed).not.toBe(before.body.fingerprint_seed);
    expect(res.body.user_agent).toContain('Macintosh');
    expect(res.body.hardware_cores).toBeGreaterThan(0);
  });

  it('does not regenerate a second seed when a set is provided with a platform change', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ platform: 'linux', ...FULL_SET, fingerprint_platform: 'linux' });

    expect(res.status).toBe(200);
    expect(res.body.platform).toBe('linux');
    expect(res.body.fingerprint_seed).toBe(FULL_SET.fingerprint_seed);
    expect(res.body.user_agent).toBe(FULL_SET.user_agent);
  });

  it('rejects a set whose fingerprint_platform mismatches the selected platform', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ platform: 'windows', ...FULL_SET, fingerprint_platform: 'macos' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/fingerprint_platform/);
  });

  it('rejects a partial fingerprint set without an explicit full set', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ platform: 'windows', user_agent: FULL_SET.user_agent });

    expect(res.status).toBe(400);
  });

  it('rejects a non-UUID fingerprint_seed', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({ platform: 'windows', ...FULL_SET, fingerprint_seed: 'not-a-uuid' });

    expect(res.status).toBe(400);
  });

  it('allows zero hardware values when explicitly provided', async () => {
    const res = await request(app)
      .put(`/api/profiles/${profileId}`)
      .send({
        platform: 'windows',
        ...FULL_SET,
        hardware_cores: 0,
        hardware_memory: 0,
      });

    expect(res.status).toBe(200);
    expect(res.body.hardware_cores).toBe(0);
    expect(res.body.hardware_memory).toBe(0);
  });
});
