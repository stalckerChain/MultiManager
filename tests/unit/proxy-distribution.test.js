import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import http from 'http';
import https from 'https';
import { SocksClient } from 'socks';
import { EventEmitter } from 'events';

import proxiesRouter from '../../src/api/proxies.js';

const dbMod = require('../../src/db/index.js');

const PROXY_KEYS = [
  'distributeUsed',
  'distributeAll',
  'distributeConfirmTitle',
  'distributeConfirmMessage',
  'distributeChecked',
  'distributeWorking',
  'distributeFailed',
  'distributeProfiles',
  'distributeCheckbox',
  'distributeNoWorking',
  'distributePreviewError',
  'distributeSuccess',
  'distributeError',
];

let tmpDir;
let app;
let ipifyCalls;
let rotationCalls;

const origHttpRequest = http.request;
const origHttpGet = http.get;
const origHttpsGet = https.get;
const origSocksCreate = SocksClient.createConnection;

function makeRequestMock() {
  const req = new EventEmitter();
  req.end = vi.fn();
  req.destroy = vi.fn();
  req.setTimeout = vi.fn().mockImplementation((ms, cb) => { if (cb) req.once('timeout', cb); return req; });
  req.abort = vi.fn();
  req.emit = EventEmitter.prototype.emit.bind(req);
  return req;
}

function fakeResponse(body, statusCode = 200) {
  return {
    statusCode,
    on: (event, handler) => {
      if (event === 'data') handler(Buffer.from(typeof body === 'string' ? body : JSON.stringify(body)));
      if (event === 'end') process.nextTick(handler);
      return fakeResponse(body, statusCode);
    },
  };
}

function mockNetwork() {
  const realHttpRequest = http.request;
  http.request = vi.fn((opts, cb) => {
    // Supertest сам использует http.request для тестовых запросов — пропускаем их.
    if (opts.method !== 'CONNECT') {
      return realHttpRequest(opts, cb);
    }
    // CONNECT через http.request: успех для всех хостов, кроме 'bad.com'
    const req = makeRequestMock();
    if (opts.host === 'bad.com') {
      process.nextTick(() => req.emit('error', new Error('ECONNREFUSED')));
    } else {
      process.nextTick(() => req.emit('connect', { statusCode: 200 }, new EventEmitter()));
    }
    return req;
  });

  https.get = vi.fn((url, opts, cb) => {
    if (String(url).includes('api.ipify.org')) ipifyCalls++;
    if (String(url).includes('/rotate')) rotationCalls.push(String(url));
    const body = String(url).includes('api.ipify.org') ? { ip: '1.2.3.4' } : { ok: true, data: 'rotated' };
    process.nextTick(() => cb(fakeResponse(body)));
    return { on: vi.fn() };
  });

  http.get = vi.fn((url, opts, cb) => {
    if (String(url).includes('/rotate')) rotationCalls.push(String(url));
    process.nextTick(() => cb(fakeResponse({ status: 'success', timezone: 'Europe/Berlin', countryCode: 'DE', country: 'Germany' })));
    return { on: vi.fn() };
  });

  SocksClient.createConnection = vi.fn().mockRejectedValue(new Error('refused'));
}

function insertProxy({ host, port, type = 'http', proxy_rotation_url = null }) {
  const db = dbMod.getDatabase();
  const proxyQueries = dbMod.createProxyQueries(db);
  return proxyQueries.create({ type, host, port, proxy_rotation_url });
}

function insertProfile({ number, proxy_id = null, status = 'stopped' }) {
  const db = dbMod.getDatabase();
  const defaults = {
    id: `p${number}`,
    number,
    name: `auto_${String(number).padStart(3, '0')}`,
    proxy_id,
    fingerprint_seed: `seed-${number}`,
    platform: 'windows',
    user_agent: 'Mozilla/5.0',
    screen_resolution: '1920x1080',
    hardware_cores: 4,
    hardware_memory: 8,
    status,
    profile_path: null,
  };
  db.prepare(`
    INSERT INTO profiles
      (id, number, name, proxy_id, fingerprint_seed, platform, user_agent,
       screen_resolution, hardware_cores, hardware_memory, status, profile_path)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    defaults.id, defaults.number, defaults.name, defaults.proxy_id,
    defaults.fingerprint_seed, defaults.platform, defaults.user_agent,
    defaults.screen_resolution, defaults.hardware_cores, defaults.hardware_memory,
    defaults.status, defaults.profile_path
  );
}

function getProfiles() {
  const db = dbMod.getDatabase();
  return dbMod.createProfileQueries(db).getAll();
}

function getProxyById(id) {
  const db = dbMod.getDatabase();
  return dbMod.createProxyQueries(db).getById(id);
}

beforeEach(() => {
  ipifyCalls = 0;
  rotationCalls = [];
  mockNetwork();

  tmpDir = path.join(os.tmpdir(), 'proxy-distribution-test-' + Date.now());
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
  http.request = origHttpRequest;
  http.get = origHttpGet;
  https.get = origHttpsGet;
  SocksClient.createConnection = origSocksCreate;
  vi.restoreAllMocks();
});

describe('preview: выборка прокси по режиму', () => {
  it('used: берёт только уникальные прокси, назначенные профилям', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProxy({ host: 'p3.com', port: 1003 });
    insertProfile({ number: 1, proxy_id: 1 });
    insertProfile({ number: 2, proxy_id: 1 });
    insertProfile({ number: 3, proxy_id: 2 });

    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'used' });

    expect(res.status).toBe(200);
    expect(res.body.mode).toBe('used');
    expect(res.body.checked_count).toBe(2);
    expect(res.body.working_count).toBe(2);
    expect(res.body.failed_count).toBe(0);
    expect(res.body.working_proxy_ids).toEqual([1, 2]);
    expect(ipifyCalls).toBe(2);
  });

  it('all: берёт все прокси из таблицы независимо от использования', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProxy({ host: 'p3.com', port: 1003 });
    insertProfile({ number: 1, proxy_id: 1 });

    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.checked_count).toBe(3);
    expect(res.body.working_proxy_ids).toEqual([1, 2, 3]);
    expect(ipifyCalls).toBe(3);
  });

  it('невалидный mode → 400', async () => {
    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'bogus' });
    expect(res.status).toBe(400);
  });
});

describe('preview: проверка и результаты', () => {
  it('нерабочие прокси исключаются из рабочего набора', async () => {
    insertProxy({ host: 'ok1.com', port: 1001 });
    insertProxy({ host: 'bad.com', port: 1002 });
    insertProxy({ host: 'ok3.com', port: 1003 });

    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.checked_count).toBe(3);
    expect(res.body.working_count).toBe(2);
    expect(res.body.failed_count).toBe(1);
    expect(res.body.working_proxy_ids).toEqual([1, 3]);
  });

  it('ошибка одного check не прерывает остальные', async () => {
    insertProxy({ host: 'ok1.com', port: 1001 });
    insertProxy({ host: 'boom.com', port: 1002, proxy_rotation_url: 'http://10.0.0.1/rotate' });
    insertProxy({ host: 'ok3.com', port: 1003 });

    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.checked_count).toBe(3);
    expect(res.body.working_proxy_ids).toEqual([1, 3]);
    expect(res.body.failed_count).toBe(1);
    expect(ipifyCalls).toBe(2);
  });

  it('ротация выполняется до проверки соединения', async () => {
    insertProxy({ host: 'rot.com', port: 1001, proxy_rotation_url: 'https://api.rot.com/rotate' });
    insertProxy({ host: 'plain.com', port: 1002 });

    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.working_proxy_ids).toEqual([1, 2]);
    expect(rotationCalls).toEqual(['https://api.rot.com/rotate']);
    expect(https.get.mock.calls[0][0]).toContain('/rotate');
  });

  it('обновляет технические поля проверки', async () => {
    insertProxy({ host: 'ok.com', port: 1001 });
    insertProxy({ host: 'bad.com', port: 1002 });

    await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    const ok = getProxyById(1);
    expect(ok.is_active).toBe(1);
    expect(ok.last_ip).toBe('1.2.3.4');
    expect(ok.location).toBe('DE(Germany)');

    const bad = getProxyById(2);
    expect(bad.is_active).toBe(0);
  });

  it('preview не изменяет proxy_id профилей', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProfile({ number: 1, proxy_id: 1 });
    insertProfile({ number: 2, proxy_id: 2 });
    insertProfile({ number: 3, proxy_id: null });

    await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    const profiles = getProfiles();
    expect(profiles.map(p => p.proxy_id)).toEqual([1, 2, null]);
  });

  it('возвращает profiles_count без записей при пустом списке профилей', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });

    const res = await request(app).post('/api/proxies/distribute/preview').send({ mode: 'all' });

    expect(res.status).toBe(200);
    expect(res.body.profiles_count).toBe(0);
  });
});

describe('single check: точность сообщений об ошибках', () => {
  it('ошибка ротации → 502 «Ошибка ротации»', async () => {
    insertProxy({ host: 'rot.com', port: 1001, proxy_rotation_url: 'http://10.0.0.1/rotate' });

    const res = await request(app).post('/api/proxies/1/check');

    expect(res.status).toBe(502);
    expect(res.body.error).toBe('Ошибка ротации');
  });

  it('рабочий прокси без ротации → 200 ok:true', async () => {
    insertProxy({ host: 'ok.com', port: 1001 });

    const res = await request(app).post('/api/proxies/1/check');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.ip).toBe('1.2.3.4');
  });

  it('нерабочий прокси без ротации → 200 ok:false (не 502)', async () => {
    insertProxy({ host: 'bad.com', port: 1002 });

    const res = await request(app).post('/api/proxies/1/check');

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(false);
  });
});

describe('distribute: валидация', () => {
  it('рабочие ID не из допустимого источника режима → 400 и назначения не меняются', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProfile({ number: 1, proxy_id: 1 });

    const res = await request(app).post('/api/proxies/distribute').send({
      mode: 'used',
      working_proxy_ids: [2],
    });

    expect(res.status).toBe(400);
    expect(getProfiles()[0].proxy_id).toBe(1);
  });

  it('пустой список рабочих прокси → 400 и назначения сохраняются', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProfile({ number: 1, proxy_id: 1 });

    const res = await request(app).post('/api/proxies/distribute').send({
      mode: 'all',
      working_proxy_ids: [],
    });

    expect(res.status).toBe(400);
    expect(getProfiles()[0].proxy_id).toBe(1);
  });

  it('рабочие ID из допустимого источника проходят валидацию', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProfile({ number: 1, proxy_id: 1 });
    insertProfile({ number: 2, proxy_id: 2 });

    const res = await request(app).post('/api/proxies/distribute').send({
      mode: 'used',
      working_proxy_ids: [1, 2],
    });

    expect(res.status).toBe(200);
  });
});

describe('distribute: алгоритм распределения', () => {
  it('назначает всем профилям только рабочие прокси, без повторов внутри цикла и с перезапуском цикла', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProfile({ number: 1, proxy_id: null });
    insertProfile({ number: 2, proxy_id: null });
    insertProfile({ number: 3, proxy_id: null });

    const res = await request(app).post('/api/proxies/distribute').send({
      mode: 'all',
      working_proxy_ids: [1, 2],
    });

    expect(res.status).toBe(200);
    const assignments = getProfiles().map(p => p.proxy_id);
    expect(assignments).toEqual([1, 2, 1]);
    for (const id of assignments) {
      expect([1, 2]).toContain(id);
    }
  });

  it('включает профили без прокси и запущенные профили', async () => {
    vi.spyOn(Math, 'random').mockReturnValue(0);
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProfile({ number: 1, proxy_id: 1 });
    insertProfile({ number: 2, proxy_id: null });
    insertProfile({ number: 3, proxy_id: 2, status: 'running' });

    const res = await request(app).post('/api/proxies/distribute').send({
      mode: 'used',
      working_proxy_ids: [1, 2],
    });

    expect(res.status).toBe(200);
    const profiles = getProfiles();
    expect(profiles.map(p => p.proxy_id)).toEqual([1, 2, 1]);
    expect(profiles[2].status).toBe('running');
  });

  it('успешный ответ содержит итоговые количества', async () => {
    insertProxy({ host: 'p1.com', port: 1001 });
    insertProxy({ host: 'p2.com', port: 1002 });
    insertProxy({ host: 'p3.com', port: 1003 });
    insertProfile({ number: 1, proxy_id: null });
    insertProfile({ number: 2, proxy_id: null });

    const res = await request(app).post('/api/proxies/distribute').send({
      mode: 'all',
      working_proxy_ids: [1, 2, 3],
    });

    expect(res.status).toBe(200);
    expect(res.body.assigned_profiles).toBe(2);
    expect(res.body.used_proxies).toBe(3);
  });
});

describe('i18n: ключи распределения есть во всех локалях', () => {
  it.each(['ru', 'en', 'zh'])('%s.json содержит ключи popup и ошибок', (locale) => {
    const file = path.join(__dirname, '..', '..', 'gui', 'src', 'renderer', 'i18n', `${locale}.json`);
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const key of PROXY_KEYS) {
      expect(json.proxies).toHaveProperty(key);
      expect(typeof json.proxies[key]).toBe('string');
      expect(json.proxies[key].length).toBeGreaterThan(0);
    }
  });
});
