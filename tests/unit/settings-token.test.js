import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const { createSystemConfigQueries } = require('../../src/db/queries');
const { setToken, getToken } = require('../../src/api/auth');
const { authMiddleware } = require('../../src/api/auth');
const { initDatabase } = require('../../src/db');

initDatabase();

const app = express();
app.use(express.json());
app.use(authMiddleware);
app.use('/api/settings', require('../../src/api/settings'));

const INITIAL = `initial-token-${Date.now()}`;
let systemConfig;

describe('POST /api/settings/api-token/regenerate', () => {
  beforeAll(() => {
    const db = require('../../src/db').getDatabase();
    systemConfig = createSystemConfigQueries(db);
  });

  afterAll(() => {
    process.send = undefined;
  });

  beforeEach(() => {
    vi.clearAllMocks();
    setToken(INITIAL);
    process.send = undefined;
  });

  it('отклоняет запрос без Bearer-токена', async () => {
    const res = await request(app).post('/api/settings/api-token/regenerate');
    expect(res.status).toBe(401);
  });

  it('генерирует новый токен, сохраняет в БД и меняет активный', async () => {
    const res = await request(app)
      .post('/api/settings/api-token/regenerate')
      .set('Authorization', `Bearer ${INITIAL}`);

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf('string');
    expect(res.body.token).not.toBe(INITIAL);

    const stored = systemConfig.get('api_token');
    const active = getToken();
    expect(stored).toBe(res.body.token);
    expect(active).toBe(res.body.token);
    expect(active.length).toBe(64);
  });

  it('старый Bearer-токен отклоняется, новый проходит после регенерации', async () => {
    const res = await request(app)
      .post('/api/settings/api-token/regenerate')
      .set('Authorization', `Bearer ${INITIAL}`);

    const newToken = res.body.token;

    const oldRes = await request(app)
      .get('/api/settings/crypto-status')
      .set('Authorization', `Bearer ${INITIAL}`);

    expect(oldRes.status).toBe(401);

    const goodRes = await request(app)
      .get('/api/settings/crypto-status')
      .set('Authorization', `Bearer ${newToken}`);

    expect(goodRes.status).toBe(200);
  });
});