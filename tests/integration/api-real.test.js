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

  it('POST /api/profiles creates profile with legacy fields', async () => {
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

  it('POST /api/profiles creates profile with new fields', async () => {
    const res = await request('POST', '/api/profiles', {
      name: 'Full Profile',
      platform: 'macos',
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
    expect(res.status).toBe(201);
    expect(res.body.timezone).toBe('Europe/Berlin');
    expect(res.body.email).toBe('user@example.com');
    expect(res.body.email_password).toBe('secret123');
    expect(res.body.twitter_username).toBe('tw_user');
    expect(res.body.twitter_password).toBe('tw_pass');
    expect(res.body.twitter_auth_token).toBe('tw_token');
    expect(res.body.twitter_email).toBe('tw@example.com');
    expect(res.body.discord_username).toBe('dc_user');
    expect(res.body.discord_password).toBe('dc_pass');
    expect(res.body.discord_token).toBe('dc_token');
    expect(res.body.discord_email).toBe('dc@example.com');
    expect(res.body.wallet_evm_address).toBe('0x1234567890abcdef1234567890abcdef12345678');
    expect(res.body.wallet_sol_address).toBe('AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd');
    expect(res.body.wallet_password).toBe('wallet_pass');

    await request('DELETE', `/api/profiles/${res.body.id}`);
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

  it('GET /api/profiles/:id returns profile with new fields', async () => {
    const res = await request('GET', `/api/profiles/${createdProfileId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdProfileId);
    expect(res.body.name).toBe('Test Profile');
    expect(res.body).toHaveProperty('timezone');
    expect(res.body).toHaveProperty('email');
    expect(res.body).toHaveProperty('twitter_username');
    expect(res.body).toHaveProperty('discord_username');
    expect(res.body).toHaveProperty('wallet_evm_address');
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

  it('PUT /api/profiles/:id updates new fields', async () => {
    const res = await request('PUT', `/api/profiles/${createdProfileId}`, {
      timezone: 'America/New_York',
      email: 'new@example.com',
      twitter_username: 'new_tw',
      wallet_evm_address: '0xabcdef1234567890abcdef1234567890abcdef12',
    });
    expect(res.status).toBe(200);
    expect(res.body.timezone).toBe('America/New_York');
    expect(res.body.email).toBe('new@example.com');
    expect(res.body.twitter_username).toBe('new_tw');
    expect(res.body.wallet_evm_address).toBe('0xabcdef1234567890abcdef1234567890abcdef12');
  });

  it('POST /api/profiles/:id/regenerate changes fingerprint', async () => {
    const before = await request('GET', `/api/profiles/${createdProfileId}`);
    const res = await request('POST', `/api/profiles/${createdProfileId}/regenerate`);
    expect(res.status).toBe(200);
    expect(res.body.fingerprint_seed).not.toBe(before.body.fingerprint_seed);
  });
});

describe('Profiles Batch', () => {
  let batchIds = [];

  afterAll(async () => {
    for (const id of batchIds) {
      await request('DELETE', `/api/profiles/${id}`).catch(() => {});
    }
  });

  it('POST /api/profiles/batch creates multiple profiles', async () => {
    const res = await request('POST', '/api/profiles/batch', {
      accounts: [
        { name: 'Batch Alpha', platform: 'windows' },
        { name: 'Batch Beta', platform: 'macos' },
        { name: 'Batch Gamma', platform: 'linux' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body.length).toBe(3);
    expect(res.body[0].name).toBe('Batch Alpha');
    expect(res.body[0].platform).toBe('windows');
    expect(res.body[0].fingerprint_seed).toBeTruthy();
    expect(res.body[1].name).toBe('Batch Beta');
    expect(res.body[1].platform).toBe('macos');
    expect(res.body[2].name).toBe('Batch Gamma');
    expect(res.body[2].platform).toBe('linux');
    batchIds = res.body.map(p => p.id);
  });

  it('POST /api/profiles/batch returns 400 for empty accounts', async () => {
    const res = await request('POST', '/api/profiles/batch', { accounts: [] });
    expect(res.status).toBe(400);
  });

  it('POST /api/profiles/batch returns 400 for missing fields', async () => {
    const res = await request('POST', '/api/profiles/batch', {
      accounts: [{ name: 'No Platform' }],
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toContain('[0]');
  });

  it('POST /api/profiles/batch returns 400 when accounts is missing', async () => {
    const res = await request('POST', '/api/profiles/batch', {});
    expect(res.status).toBe(400);
  });

  it('POST /api/profiles/batch creates profiles with platform-specific fingerprints', async () => {
    const res = await request('POST', '/api/profiles/batch', {
      accounts: [
        { name: 'Fingerprint Test 1', platform: 'windows' },
      ],
    });
    expect(res.status).toBe(201);
    expect(res.body[0].fingerprint_seed).toBeTruthy();
    expect(res.body[0].platform).toBe('windows');
    expect(['windows', 'macos', 'linux']).toContain(res.body[0].platform);

    const id = res.body[0].id;
    await request('DELETE', `/api/profiles/${id}`).catch(() => {});
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

describe('Tasks', () => {
  let createdTaskId;

  it('POST /api/tasks creates a task', async () => {
    const res = await request('POST', '/api/tasks', {
      name: 'Test Task',
      script_name: 'concrete',
      schedule_type: 'once',
      params: { ref: 'abc' },
      is_active: true,
    });
    expect(res.status).toBe(201);
    expect(res.body.id).toBeTruthy();
    expect(res.body.name).toBe('Test Task');
    expect(res.body.script_name).toBe('concrete');
    expect(res.body.schedule_type).toBe('once');
    expect(res.body.is_active).toBe(1);
    createdTaskId = res.body.id;
  });

  it('POST /api/tasks returns 400 without required fields', async () => {
    const res = await request('POST', '/api/tasks', { name: 'No Script' });
    expect(res.status).toBe(400);
  });

  it('POST /api/tasks returns 400 with invalid schedule_type', async () => {
    const res = await request('POST', '/api/tasks', {
      name: 'Bad',
      script_name: 'test',
      schedule_type: 'invalid',
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/tasks returns list', async () => {
    const res = await request('GET', '/api/tasks');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
  });

  it('GET /api/tasks/:id returns task', async () => {
    const res = await request('GET', `/api/tasks/${createdTaskId}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdTaskId);
    expect(res.body.name).toBe('Test Task');
  });

  it('GET /api/tasks/:id returns 404 for unknown', async () => {
    const res = await request('GET', '/api/tasks/nonexistent');
    expect(res.status).toBe(404);
  });

  it('PUT /api/tasks/:id updates task', async () => {
    const res = await request('PUT', `/api/tasks/${createdTaskId}`, {
      name: 'Updated Task',
      is_active: false,
    });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Updated Task');
    expect(res.body.is_active).toBe(0);
  });

  it('GET /api/tasks/:id/executions returns empty array initially', async () => {
    const res = await request('GET', `/api/tasks/${createdTaskId}/executions`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('GET /api/tasks/:id/executions returns 404 for unknown task', async () => {
    const res = await request('GET', '/api/tasks/nonexistent/executions');
    expect(res.status).toBe(404);
  });

  it('DELETE /api/tasks/:id deletes task', async () => {
    const res = await request('DELETE', `/api/tasks/${createdTaskId}`);
    expect(res.status).toBe(204);
    const check = await request('GET', `/api/tasks/${createdTaskId}`);
    expect(check.status).toBe(404);
  });

  it('DELETE /api/tasks/:id returns 404 for unknown', async () => {
    const res = await request('DELETE', '/api/tasks/nonexistent');
    expect(res.status).toBe(404);
  });

  it('POST /api/tasks/:id/run returns 404 for unknown task', async () => {
    const res = await request('POST', '/api/tasks/nonexistent/run');
    expect(res.status).toBe(404);
  });

  it('POST /api/tasks/:id/run returns 400 for inactive task', async () => {
    const create = await request('POST', '/api/tasks', {
      name: 'Inactive Task',
      script_name: 'test',
      schedule_type: 'manual',
      is_active: false,
    });
    const res = await request('POST', `/api/tasks/${create.body.id}/run`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBeTruthy();
    await request('DELETE', `/api/tasks/${create.body.id}`);
  });

  it('POST /api/tasks/:id/run starts execution with profiles', async () => {
    const profile = await request('POST', '/api/profiles', {
      name: 'Run Task Profile',
      platform: 'windows',
    });
    const create = await request('POST', '/api/tasks', {
      name: 'Run Task',
      script_name: 'concrete',
      schedule_type: 'once',
      is_active: true,
    });
    const res = await request('POST', `/api/tasks/${create.body.id}/run`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('started');
    expect(res.body.profiles_count).toBeGreaterThanOrEqual(1);
    expect(res.body.executions.length).toBeGreaterThanOrEqual(1);
    expect(res.body.executions[0].status).toBe('running');

    const executions = await request('GET', `/api/tasks/${create.body.id}/executions`);
    expect(executions.body.length).toBeGreaterThanOrEqual(1);

    await request('DELETE', `/api/tasks/${create.body.id}`);
    await request('DELETE', `/api/profiles/${profile.body.id}`);
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

  it('POST /api/browser/:id/type returns 404 for unknown profile', async () => {
    const res = await request('POST', '/api/browser/unknown-id/type', { text: 'hello' });
    expect(res.status).toBe(404);
  });

  it('POST /api/browser/:id/type returns 409 when profile not running', async () => {
    const res = await request('POST', `/api/browser/${profileId}/type`, { text: 'hello' });
    expect(res.status).toBe(409);
  });

  it('POST /api/browser/:id/type returns 400 for empty text', async () => {
    const res = await request('POST', `/api/browser/${profileId}/type`, { text: '' });
    expect(res.status).toBe(400);
  });

  it('POST /api/browser/:id/type returns 400 for missing text', async () => {
    const res = await request('POST', `/api/browser/${profileId}/type`, {});
    expect(res.status).toBe(400);
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

  it('POST /api/multi-control/start returns 412 when no browser running', async () => {
    const res = await request('POST', '/api/multi-control/start', {
      masterId: profileId,
    });
    expect(res.status).toBe(412);
  });

  it('POST /api/multi-control/slave/add returns 409 when inactive', async () => {
    const res = await request('POST', '/api/multi-control/slave/add', {
      profileId: 'slave-uuid-1',
    });
    expect(res.status).toBe(409);
  });

  it('GET /api/multi-control/status shows inactive (no CDP)', async () => {
    const res = await request('GET', '/api/multi-control/status');
    expect(res.body.active).toBe(false);
    expect(res.body.slaveCount).toBe(0);
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
