import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import crypto from 'crypto';

const TEST_TOKEN = crypto.randomBytes(16).toString('hex');
const PORT = 3999;

let server;
let db;

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method,
      headers: {
        'Authorization': `Bearer ${TEST_TOKEN}`,
        'Content-Type': 'application/json',
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
    }, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(body) });
        } catch {
          resolve({ status: res.statusCode, body });
        }
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function rawRequest(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({
      hostname: '127.0.0.1',
      port: PORT,
      path,
      method: 'GET',
      headers,
    }, (res) => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => resolve({ status: res.statusCode, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  const { setToken } = require('../../src/api/auth');
  const { initDatabase } = require('../../src/db');
  const { app } = require('../../src/core/app');

  setToken(TEST_TOKEN);
  db = initDatabase();
  await new Promise(resolve => { server = app.listen(PORT, '127.0.0.1', resolve); });
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  db.close();
});

describe('Health Check', () => {
  it('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });
});

describe('Authentication', () => {
  it('rejects request without token', async () => {
    const res = await rawRequest('/health');
    expect(res.status).toBe(401);
  });

  it('rejects wrong token', async () => {
    const res = await rawRequest('/health', { 'Authorization': 'Bearer wrong-token' });
    expect(res.status).toBe(401);
  });
});

describe('Profiles', () => {
  let createdProfileId;

  it('POST /api/profiles creates profile', async () => {
    const res = await request('POST', '/api/profiles', {
      name: 'Test Profile',
      platform: 'windows',
      tags: ['test'],
      notes: 'Automated test',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Test Profile');
    expect(res.body.platform).toBe('windows');
    expect(res.body.status).toBe('stopped');
    expect(res.body.fingerprint_seed).toBeTruthy();
    expect(res.body.user_agent).toBeTruthy();
    createdProfileId = res.body.id;
  });

  it('POST /api/profiles returns 400 without platform', async () => {
    const res = await request('POST', '/api/profiles', { name: 'Bad' });
    expect(res.status).toBe(400);
  });

  it('GET /api/profiles returns list', async () => {
    const res = await request('GET', '/api/profiles');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/profiles/:id returns profile', async () => {
    const res = await request('GET', `/api/profiles/${createdProfileId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdProfileId);
    expect(res.body.name).toBe('Test Profile');
  });

  it('GET /api/profiles/:id returns 404 for unknown', async () => {
    const res = await request('GET', '/api/profiles/nonexistent');
    expect(res.status).toBe(404);
  });

  it('PUT /api/profiles/:id updates profile', async () => {
    const res = await request('PUT', `/api/profiles/${createdProfileId}`, {
      name: 'Updated Profile',
      tags: ['updated'],
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Profile');
  });

  it('POST /api/profiles/:id/regenerate changes fingerprint', async () => {
    const before = await request('GET', `/api/profiles/${createdProfileId}`);
    const res = await request('POST', `/api/profiles/${createdProfileId}/regenerate`);
    expect(res.status).toBe(200);
    expect(res.body.fingerprint_seed).not.toBe(before.body.fingerprint_seed);
  });
});

describe('Proxies', () => {
  let createdProxyId;

  it('POST /api/proxies creates proxy', async () => {
    const res = await request('POST', '/api/proxies', {
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.host).toBe('proxy.example.com');
    expect(res.body.port).toBe(1080);
    createdProxyId = res.body.id;
  });

  it('POST /api/proxies/import bulk imports', async () => {
    const res = await request('POST', '/api/proxies/import', {
      text: 'socks5://u1:p1@host1:1080\nhttp://host2:8080\nhttps://user:pass@host3:443',
    });
    expect(res.status).toBe(201);
    expect(res.body.count).toBe(3);
    expect(res.body.proxies.length).toBe(3);
  });

  it('GET /api/proxies returns list', async () => {
    const res = await request('GET', '/api/proxies');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(4);
  });

  it('PUT /api/proxies/:id updates proxy', async () => {
    const res = await request('PUT', `/api/proxies/${createdProxyId}`, {
      host: 'new-proxy.com',
      port: 9090,
    });
    expect(res.status).toBe(200);
    expect(res.body.host).toBe('new-proxy.com');
  });
});

describe('Cookies', () => {
  let profileId;

  beforeAll(async () => {
    const res = await request('POST', '/api/profiles', {
      name: 'Cookie Test Profile',
      platform: 'windows',
    });
    profileId = res.body.id;
  });

  afterAll(async () => {
    await request('DELETE', `/api/profiles/${profileId}`);
  });

  it('POST /api/cookies/:profileId/import imports cookies', async () => {
    const res = await request('POST', `/api/cookies/${profileId}/import`, {
      format: 'json',
      content: JSON.stringify([
        { name: 'session', value: 'abc123', domain: '.example.com' },
        { name: 'token', value: 'xyz', domain: '.test.com' },
      ]),
    });
    expect(res.status).toBe(200);
    expect(res.body.count).toBe(2);
  });

  it('GET /api/cookies/:profileId returns cookies', async () => {
    const res = await request('GET', `/api/cookies/${profileId}`);
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(2);
  });

  it('GET /api/cookies/:profileId/export?format=netscape returns text', async () => {
    const res = await rawRequest(
      `/api/cookies/${profileId}/export?format=netscape`,
      { 'Authorization': `Bearer ${TEST_TOKEN}` }
    );
    expect(res.status).toBe(200);
    expect(res.body).toContain('.example.com');
    expect(res.body).toContain('session');
    expect(res.body).toContain('\t');
  });

  it('DELETE /api/cookies/:profileId clears cookies', async () => {
    const res = await request('DELETE', `/api/cookies/${profileId}`);
    expect(res.status).toBe(204);
    const check = await request('GET', `/api/cookies/${profileId}`);
    expect(check.body.length).toBe(0);
  });
});

describe('Browser', () => {
  let profileId;

  beforeAll(async () => {
    const res = await request('POST', '/api/profiles', {
      name: 'Browser Test Profile',
      platform: 'windows',
    });
    profileId = res.body.id;
  });

  afterAll(async () => {
    await request('DELETE', `/api/profiles/${profileId}`);
  });

  it('GET /api/browser/:id/status returns status', async () => {
    const res = await request('GET', `/api/browser/${profileId}/status`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');
  });

  it('POST /api/browser/:id/clean works when stopped', async () => {
    const res = await request('POST', `/api/browser/${profileId}/clean`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cleaned');
  });

  it('POST /api/browser/:id/stop returns 409 when already stopped', async () => {
    const res = await request('POST', `/api/browser/${profileId}/stop`);
    expect(res.status).toBe(409);
  });
});

describe('Multi-Control', () => {
  let profileId;

  beforeAll(async () => {
    const res = await request('POST', '/api/profiles', {
      name: 'MultiControl Test Profile',
      platform: 'windows',
    });
    profileId = res.body.id;
  });

  afterAll(async () => {
    await request('POST', '/api/multi-control/stop').catch(() => {});
    await request('DELETE', `/api/profiles/${profileId}`).catch(() => {});
  });

  it('GET /api/multi-control/status returns inactive', async () => {
    const res = await request('GET', '/api/multi-control/status');
    expect(res.status).toBe(200);
    expect(res.body.active).toBe(false);
  });

  it('POST /api/multi-control/start activates', async () => {
    const res = await request('POST', '/api/multi-control/start', {
      masterId: profileId,
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('active');
  });

  it('POST /api/multi-control/slave/add adds slave', async () => {
    const res = await request('POST', '/api/multi-control/slave/add', {
      profileId: 'slave-uuid-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.slaveCount).toBe(1);
  });

  it('GET /api/multi-control/status shows slaves', async () => {
    const res = await request('GET', '/api/multi-control/status');
    expect(res.body.slaveCount).toBe(1);
    expect(res.body.slaves).toContain('slave-uuid-1');
  });

  it('POST /api/multi-control/slave/remove removes slave', async () => {
    const res = await request('POST', '/api/multi-control/slave/remove', {
      profileId: 'slave-uuid-1',
    });
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('removed');
  });

  it('POST /api/multi-control/stop deactivates', async () => {
    const res = await request('POST', '/api/multi-control/stop');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('stopped');
  });

  it('POST /api/multi-control/slave/add returns 409 when inactive', async () => {
    const res = await request('POST', '/api/multi-control/slave/add', {
      profileId: 'slave-uuid-2',
    });
    expect(res.status).toBe(409);
  });
});

describe('Cleanup', () => {
  it('DELETE /api/profiles/:id deletes profile', async () => {
    const create = await request('POST', '/api/profiles', {
      name: 'To Delete',
      platform: 'linux',
    });
    const id = create.body.id;

    const res = await request('DELETE', `/api/profiles/${id}`);
    expect(res.status).toBe(204);

    const check = await request('GET', `/api/profiles/${id}`);
    expect(check.status).toBe(404);
  });

  it('DELETE /api/profiles/:id returns 404 for unknown', async () => {
    const res = await request('DELETE', '/api/profiles/nonexistent');
    expect(res.status).toBe(404);
  });
});
