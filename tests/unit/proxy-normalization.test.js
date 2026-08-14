import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';

import proxiesRouter from '../../src/api/proxies.js';

const dbMod = require('../../src/db/index.js');

let tmpDir;
let app;

beforeEach(() => {
  tmpDir = path.join(os.tmpdir(), 'proxy-normalization-test-' + Date.now());
  fs.mkdirSync(tmpDir, { recursive: true });
  process.env.MULTIMANAGER_DATA_DIR = tmpDir;
  dbMod.initDatabase();

  app = express();
  app.use(express.json());
  app.use('/api/proxies', proxiesRouter);
  app.use((err, req, res, next) => {
    const status = err.status || 500;
    res.status(status).json(err.status ? { error: err.message, code: err.code } : { error: err.message });
  });
});

afterEach(() => {
  dbMod.closeDatabase();
  delete process.env.MULTIMANAGER_DATA_DIR;
  if (tmpDir) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
  }
});

function getProxies() {
  const db = dbMod.getDatabase();
  return dbMod.createProxyQueries(db).getAll();
}

function getProxyById(id) {
  const db = dbMod.getDatabase();
  return dbMod.createProxyQueries(db).getById(id);
}

function insertRawProxy({ host, port }) {
  const db = dbMod.getDatabase();
  return dbMod.createProxyQueries(db).create({ type: 'http', host, port });
}

describe('POST /api/proxies: нормализация host', () => {
  it('сохраняет host.trim().toLowerCase()', async () => {
    const res = await request(app).post('/api/proxies').send({
      type: 'http', host: '  Proxy.Example.COM  ', port: 8080,
    });
    expect(res.status).toBe(201);
    expect(res.body.host).toBe('proxy.example.com');
    expect(getProxies()[0].host).toBe('proxy.example.com');
  });

  it('отклоняет host с отличающимся регистром как дубль (409)', async () => {
    await request(app).post('/api/proxies').send({ type: 'http', host: 'proxy.com', port: 8080 });
    const res = await request(app).post('/api/proxies').send({ type: 'socks5', host: 'PROXY.COM', port: 8080 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Прокси с таким host:port уже существует');
  });

  it('корректно обрабатывает пробелы вокруг host', async () => {
    await request(app).post('/api/proxies').send({ type: 'http', host: 'proxy.com', port: 8080 });
    const res = await request(app).post('/api/proxies').send({ type: 'http', host: '  proxy.com  ', port: 8080 });
    expect(res.status).toBe(409);
  });
});

describe('POST /api/proxies/import: нормализация и дедупликация', () => {
  it('сохраняет нормализованные host', async () => {
    const res = await request(app).post('/api/proxies/import').send({
      text: 'http://HOST1.COM:8080\nhttp://host2.com:8080',
    });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    const hosts = getProxies().map(p => p.host);
    expect(hosts).toContain('host1.com');
    expect(hosts).toContain('host2.com');
  });

  it('отбрасывает дубликаты существующих записей', async () => {
    await request(app).post('/api/proxies').send({ type: 'http', host: 'host1.com', port: 8080 });
    const res = await request(app).post('/api/proxies/import').send({
      text: 'http://HOST1.COM:8080\nhttp://new.com:8080',
    });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(1);
    expect(res.body.duplicate_count).toBe(1);
  });

  it('отбрасывает повторяющиеся строки в одном входном списке', async () => {
    const res = await request(app).post('/api/proxies/import').send({
      text: 'http://host1.com:8080\nhttp://HOST1.COM:8080\nhttp://host2.com:8080',
    });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(2);
    expect(res.body.duplicate_count).toBe(1);
    expect(getProxies()).toHaveLength(2);
  });
});

describe('PUT /api/proxies/:id: проверка конфликта', () => {
  async function createProxy(host, port, extra = {}) {
    const res = await request(app).post('/api/proxies').send({ type: 'http', host, port, ...extra });
    return res.body;
  }

  it('отклоняет host/port, занятые другой записью, с HTTP 409 и текущим сообщением', async () => {
    const a = await createProxy('a.com', 8080);
    const b = await createProxy('b.com', 8080);
    const res = await request(app).put(`/api/proxies/${b.id}`).send({ host: 'A.com', port: 8080 });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe('Прокси с таким host:port уже существует');
  });

  it('при конфликтном PUT исходная запись остается неизменной', async () => {
    const a = await createProxy('a.com', 8080);
    const b = await createProxy('b.com', 8080);
    await request(app).put(`/api/proxies/${b.id}`).send({ host: 'a.com', port: 8080, username: 'should-not-save' });
    const after = getProxyById(b.id);
    expect(after.host).toBe('b.com');
    expect(after.port).toBe(8080);
    expect(after.username).toBeNull();
  });

  it('разрешает сохранение той же записи без ложного конфликта', async () => {
    const a = await createProxy('a.com', 8080);
    const res = await request(app).put(`/api/proxies/${a.id}`).send({ host: 'a.com', port: 8080 });
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('a.com');
  });

  it('разрешает обновление старой ненормализованной записи на нормализованное значение', async () => {
    const raw = insertRawProxy({ host: 'A.COM', port: 8080 });
    const res = await request(app).put(`/api/proxies/${raw.id}`).send({ host: 'a.com', port: 8080 });
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('a.com');
  });

  it('обновление на host с другим регистром приводит к нормализованному значению', async () => {
    const a = await createProxy('a.com', 8080);
    const res = await request(app).put(`/api/proxies/${a.id}`).send({ host: 'A.COM' });
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('a.com');
    expect(getProxyById(a.id).host).toBe('a.com');
  });

  it('обычный не конфликтующий PUT продолжает работать', async () => {
    const a = await createProxy('a.com', 8080);
    const res = await request(app).put(`/api/proxies/${a.id}`).send({ host: 'c.com', port: 9090 });
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('c.com');
    expect(res.body.port).toBe(9090);
  });
});
