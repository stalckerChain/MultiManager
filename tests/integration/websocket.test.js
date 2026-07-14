import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import http from 'http';
import WebSocket from 'ws';
import { app } from '../../src/core/app.js';
import { setupWebSocket, broadcast, broadcastStatus, broadcastLog } from '../../src/core/websocket.js';

describe('WebSocket', () => {
  let server;
  let port;
  const clients = [];

  beforeAll(async () => {
    server = http.createServer(app);
    setupWebSocket(server);
    await new Promise((resolve) => server.listen(0, resolve));
    port = server.address().port;
  });

  afterEach(() => {
    for (const ws of clients) {
      if (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING) {
        ws.close();
      }
    }
    clients.length = 0;
  });

  afterAll(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

  function connect() {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`);
      clients.push(ws);
      ws.on('open', () => resolve(ws));
      ws.on('error', reject);
      setTimeout(() => reject(new Error('connect timeout')), 3000);
    });
  }

  function waitForMessage(ws, timeout = 2000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('message timeout')), timeout);
      ws.once('message', (data) => {
        clearTimeout(timer);
        resolve(JSON.parse(data.toString()));
      });
    });
  }

  it('подключается к /ws', async () => {
    const ws = await connect();
    expect(ws.readyState).toBe(WebSocket.OPEN);
  });

  it('получает broadcastStatus', async () => {
    const ws = await connect();

    const msgPromise = waitForMessage(ws);
    broadcastStatus('test-profile-1', 'running', 12345);
    const msg = await msgPromise;

    expect(msg).toEqual({
      type: 'status',
      profileId: 'test-profile-1',
      status: 'running',
      pid: 12345,
    });
  });

  it('получает broadcastLog', async () => {
    const ws = await connect();

    const msgPromise = waitForMessage(ws);
    broadcastLog('test-profile-1', 'info', 'Test log message');
    const msg = await msgPromise;

    expect(msg.type).toBe('log');
    expect(msg.profileId).toBe('test-profile-1');
    expect(msg.level).toBe('info');
    expect(msg.message).toBe('Test log message');
    expect(msg.timestamp).toBeTypeOf('number');
  });

  it('несколько клиентов получают сообщения', async () => {
    const ws1 = await connect();
    const ws2 = await connect();

    const msg1Promise = waitForMessage(ws1);
    const msg2Promise = waitForMessage(ws2);
    broadcastStatus('multi-profile', 'stopped');
    const [msg1, msg2] = await Promise.all([msg1Promise, msg2Promise]);

    expect(msg1.profileId).toBe('multi-profile');
    expect(msg2.profileId).toBe('multi-profile');
  });

  it('broadcastStatus без pid', async () => {
    const ws = await connect();

    const msgPromise = waitForMessage(ws);
    broadcastStatus('no-pid-profile', 'stopped');
    const msg = await msgPromise;

    expect(msg).toEqual({
      type: 'status',
      profileId: 'no-pid-profile',
      status: 'stopped',
      pid: null,
    });
  });

  it('клиент отключается корректно', async () => {
    const ws = await connect();
    expect(ws.readyState).toBe(WebSocket.OPEN);

    await new Promise((resolve) => {
      ws.on('close', resolve);
      ws.close();
    });

    expect(ws.readyState).toBe(WebSocket.CLOSED);
  });

  it('broadcast не падает если клиент закрыт', async () => {
    const ws = await connect();
    ws.close();
    await new Promise((r) => setTimeout(r, 50));

    expect(() => broadcast({ test: true })).not.toThrow();
  });
});
