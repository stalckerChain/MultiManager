const http = require('http');
const crypto = require('crypto');

const TEST_TOKEN = crypto.randomBytes(16).toString('hex');
const PORT = 3999;

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

let server;
let db;

async function setup() {
  const { setToken } = require('../../src/api/auth');
  const { initDatabase } = require('../../src/db');

  setToken(TEST_TOKEN);
  db = initDatabase();

  const { app } = require('../../src/core/app');
  await new Promise(resolve => { server = app.listen(PORT, '127.0.0.1', resolve); });
}

async function teardown() {
  await new Promise(resolve => server.close(resolve));
  db.close();
}

function assert(condition, msg) {
  if (!condition) throw new Error(`ASSERT FAILED: ${msg}`);
}

async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    console.log(`  ✗ ${name}`);
    console.log(`    ${err.message}`);
    process.exitCode = 1;
  }
}

async function run() {
  console.log('API Integration Tests\n');

  await setup();

  // --- Health ---
  console.log('Health Check:');
  await test('GET /health returns ok', async () => {
    const res = await request('GET', '/health');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.status === 'ok', `body ${JSON.stringify(res.body)}`);
  });

  // --- Auth ---
  console.log('Authentication:');
  await test('rejects request without token', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get({ hostname: '127.0.0.1', port: PORT, path: '/health' }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode }));
      }).on('error', reject);
    });
    assert(res.status === 401, `status ${res.status}`);
  });

  await test('rejects wrong token', async () => {
    const res = await new Promise((resolve, reject) => {
      const req = http.request({
        hostname: '127.0.0.1', port: PORT, path: '/health',
        headers: { 'Authorization': 'Bearer wrong-token' },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
      });
      req.on('error', reject);
      req.end();
    });
    assert(res.status === 401, `status ${res.status}`);
  });

  // --- Profiles ---
  console.log('Profiles:');
  let createdProfileId;

  await test('POST /api/profiles creates profile', async () => {
    const res = await request('POST', '/api/profiles', {
      name: 'Test Profile',
      platform: 'windows',
      tags: ['test'],
      notes: 'Automated test',
    });
    assert(res.status === 201, `status ${res.status}`);
    assert(res.body.id, 'missing id');
    assert(res.body.name === 'Test Profile', `name ${res.body.name}`);
    assert(res.body.platform === 'windows', `platform ${res.body.platform}`);
    assert(res.body.status === 'stopped', `status ${res.body.status}`);
    assert(res.body.fingerprint_seed, 'missing fingerprint_seed');
    assert(res.body.user_agent, 'missing user_agent');
    createdProfileId = res.body.id;
  });

  await test('POST /api/profiles returns 400 without platform', async () => {
    const res = await request('POST', '/api/profiles', { name: 'Bad' });
    assert(res.status === 400, `status ${res.status}`);
  });

  await test('GET /api/profiles returns list', async () => {
    const res = await request('GET', '/api/profiles');
    assert(res.status === 200, `status ${res.status}`);
    assert(Array.isArray(res.body), 'not array');
    assert(res.body.length >= 1, `length ${res.body.length}`);
  });

  await test('GET /api/profiles/:id returns profile', async () => {
    const res = await request('GET', `/api/profiles/${createdProfileId}`);
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.id === createdProfileId, 'id mismatch');
    assert(res.body.name === 'Test Profile', `name ${res.body.name}`);
  });

  await test('GET /api/profiles/:id returns 404 for unknown', async () => {
    const res = await request('GET', '/api/profiles/nonexistent');
    assert(res.status === 404, `status ${res.status}`);
  });

  await test('PUT /api/profiles/:id updates profile', async () => {
    const res = await request('PUT', `/api/profiles/${createdProfileId}`, {
      name: 'Updated Profile',
      tags: ['updated'],
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.name === 'Updated Profile', `name ${res.body.name}`);
  });

  await test('POST /api/profiles/:id/regenerate changes fingerprint', async () => {
    const before = await request('GET', `/api/profiles/${createdProfileId}`);
    const res = await request('POST', `/api/profiles/${createdProfileId}/regenerate`);
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.fingerprint_seed !== before.body.fingerprint_seed, 'seed unchanged');
  });

  // --- Proxies ---
  console.log('Proxies:');
  let createdProxyId;

  await test('POST /api/proxies creates proxy', async () => {
    const res = await request('POST', '/api/proxies', {
      type: 'socks5',
      host: 'proxy.example.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
    assert(res.status === 201, `status ${res.status}`);
    assert(res.body.id, 'missing id');
    assert(res.body.host === 'proxy.example.com', `host ${res.body.host}`);
    assert(res.body.port === 1080, `port ${res.body.port}`);
    createdProxyId = res.body.id;
  });

  await test('POST /api/proxies/import bulk imports', async () => {
    const res = await request('POST', '/api/proxies/import', {
      text: 'socks5://u1:p1@host1:1080\nhttp://host2:8080\nhttps://user:pass@host3:443',
    });
    assert(res.status === 201, `status ${res.status}`);
    assert(res.body.count === 3, `count ${res.body.count}`);
    assert(res.body.proxies.length === 3, 'proxies length');
  });

  await test('GET /api/proxies returns list', async () => {
    const res = await request('GET', '/api/proxies');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.length >= 4, `length ${res.body.length}`);
  });

  await test('PUT /api/proxies/:id updates proxy', async () => {
    const res = await request('PUT', `/api/proxies/${createdProxyId}`, {
      host: 'new-proxy.com',
      port: 9090,
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.host === 'new-proxy.com', `host ${res.body.host}`);
  });

  // --- Cookies ---
  console.log('Cookies:');

  await test('POST /api/cookies/:profileId/import imports cookies', async () => {
    const res = await request('POST', `/api/cookies/${createdProfileId}/import`, {
      format: 'json',
      content: JSON.stringify([
        { name: 'session', value: 'abc123', domain: '.example.com' },
        { name: 'token', value: 'xyz', domain: '.test.com' },
      ]),
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.count === 2, `count ${res.body.count}`);
  });

  await test('GET /api/cookies/:profileId returns cookies', async () => {
    const res = await request('GET', `/api/cookies/${createdProfileId}`);
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.length === 2, `length ${res.body.length}`);
  });

  await test('GET /api/cookies/:profileId/export?format=netscape returns text', async () => {
    const res = await new Promise((resolve, reject) => {
      http.get({
        hostname: '127.0.0.1', port: PORT,
        path: `/api/cookies/${createdProfileId}/export?format=netscape`,
        headers: { 'Authorization': `Bearer ${TEST_TOKEN}` },
      }, (res) => {
        let body = '';
        res.on('data', c => body += c);
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }).on('error', reject);
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.includes('.example.com'), 'missing domain');
    assert(res.body.includes('session'), 'missing session cookie');
    assert(res.body.includes('\t'), 'missing tab separator (Netscape format)');
  });

  await test('DELETE /api/cookies/:profileId clears cookies', async () => {
    const res = await request('DELETE', `/api/cookies/${createdProfileId}`);
    assert(res.status === 204, `status ${res.status}`);
    const check = await request('GET', `/api/cookies/${createdProfileId}`);
    assert(check.body.length === 0, `still ${check.body.length} cookies`);
  });

  // --- Browser ---
  console.log('Browser:');

  await test('GET /api/browser/:id/status returns status', async () => {
    const res = await request('GET', `/api/browser/${createdProfileId}/status`);
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.status === 'stopped', `browser status ${res.body.status}`);
  });

  await test('POST /api/browser/:id/clean blocked when stopped', async () => {
    const res = await request('POST', `/api/browser/${createdProfileId}/clean`);
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.status === 'cleaned', `result ${res.body.status}`);
  });

  await test('POST /api/browser/:id/stop returns 409 when already stopped', async () => {
    const res = await request('POST', `/api/browser/${createdProfileId}/stop`);
    assert(res.status === 409, `status ${res.status}`);
  });

  // --- Multi-Control ---
  console.log('Multi-Control:');

  await test('GET /api/multi-control/status returns status', async () => {
    const res = await request('GET', '/api/multi-control/status');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.active === false, `active ${res.body.active}`);
  });

  await test('POST /api/multi-control/start activates', async () => {
    const res = await request('POST', '/api/multi-control/start', {
      masterId: createdProfileId,
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.status === 'active', `status ${res.body.status}`);
  });

  await test('POST /api/multi-control/slave/add adds slave', async () => {
    const res = await request('POST', '/api/multi-control/slave/add', {
      profileId: 'slave-uuid-1',
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.slaveCount === 1, `slaveCount ${res.body.slaveCount}`);
  });

  await test('GET /api/multi-control/status shows slaves', async () => {
    const res = await request('GET', '/api/multi-control/status');
    assert(res.body.slaveCount === 1, `slaveCount ${res.body.slaveCount}`);
    assert(res.body.slaves.includes('slave-uuid-1'), 'missing slave');
  });

  await test('POST /api/multi-control/slave/remove removes slave', async () => {
    const res = await request('POST', '/api/multi-control/slave/remove', {
      profileId: 'slave-uuid-1',
    });
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.status === 'removed', `status ${res.body.status}`);
  });

  await test('POST /api/multi-control/stop deactivates', async () => {
    const res = await request('POST', '/api/multi-control/stop');
    assert(res.status === 200, `status ${res.status}`);
    assert(res.body.status === 'stopped', `status ${res.body.status}`);
  });

  await test('POST /api/multi-control/slave/add returns 409 when inactive', async () => {
    const res = await request('POST', '/api/multi-control/slave/add', {
      profileId: 'slave-uuid-2',
    });
    assert(res.status === 409, `status ${res.status}`);
  });

  // --- Cleanup ---
  console.log('Cleanup:');

  await test('DELETE /api/profiles/:id deletes profile', async () => {
    const res = await request('DELETE', `/api/profiles/${createdProfileId}`);
    assert(res.status === 204, `status ${res.status}`);
    const check = await request('GET', `/api/profiles/${createdProfileId}`);
    assert(check.status === 404, `still exists: ${check.status}`);
  });

  await test('DELETE /api/profiles/:id returns 404 for unknown', async () => {
    const res = await request('DELETE', '/api/profiles/nonexistent');
    assert(res.status === 404, `status ${res.status}`);
  });

  await teardown();

  console.log('\nDone.');
}

run().catch(err => { console.error(err); process.exit(1); });
