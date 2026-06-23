import { describe, it, expect, vi } from 'vitest';
import nock from 'nock';

describe('Proxy Parser', () => {
  it('парсит SOCKS5 прокси с авторизацией', async () => {
    const { parseProxy } = await import('../../src/proxy/index.js');
    expect(parseProxy('socks5://user:pass@host.com:1080')).toEqual({
      type: 'socks5', host: 'host.com', port: 1080,
      username: 'user', password: 'pass',
    });
  });

  it('парсит HTTP прокси', async () => {
    const { parseProxy } = await import('../../src/proxy/index.js');
    expect(parseProxy('http://proxy.example.com:8080')).toEqual({
      type: 'http', host: 'proxy.example.com', port: 8080,
      username: null, password: null,
    });
  });

  it('парсит HTTPS прокси', async () => {
    const { parseProxy } = await import('../../src/proxy/index.js');
    expect(parseProxy('https://secure-proxy.com:443')).toEqual({
      type: 'https', host: 'secure-proxy.com', port: 443,
      username: null, password: null,
    });
  });

  it('выбрасывает ошибку для неверного формата', async () => {
    const { parseProxy } = await import('../../src/proxy/index.js');
    expect(() => parseProxy('invalid')).toThrow('Неверный формат прокси');
  });

  it('парсит список прокси', async () => {
    const { parseProxyList } = await import('../../src/proxy/index.js');
    const proxies = parseProxyList('socks5://u:p@h1:1080\nhttp://h2:8080\nhttps://h3:443');
    expect(proxies).toHaveLength(3);
  });

  it('фильтрует комментарии', async () => {
    const { parseProxyList } = await import('../../src/proxy/index.js');
    expect(parseProxyList('\n# x\n\nsocks5://h:1080\n\n')).toHaveLength(1);
  });
});

describe('Proxy Checker', () => {
  function createMockCheckProxy() {
    const handlers = {};
    const mockReq = {
      on: vi.fn((e, cb) => { handlers[e] = cb; return mockReq; }),
      destroy: vi.fn(),
      end: vi.fn(),
    };

    const http = require('http');
    const origRequest = http.request;
    http.request = vi.fn(() => mockReq);

    const cleanup = () => {
      http.request = origRequest;
    };

    return { handlers, mockReq, cleanup };
  }

  it('CONNECT 200 → ok + ip', async () => {
    const { handlers, cleanup } = createMockCheckProxy();

    const https = require('https');
    const origGet = https.get;
    https.get = vi.fn((url, opts, cb) => {
      const res = { on: vi.fn((e, h) => { h('{"ip":"5.6.7.8"}'); return res; }) };
      cb(res);
      return { on: vi.fn() };
    });

    const { checkProxy } = require('../../src/proxy/index.js');
    const promise = checkProxy({ host: 'p.com', port: 1080 }, 5000);

    await new Promise(r => setTimeout(r, 10));
    handlers.connect({ statusCode: 200 }, {});

    const result = await promise;
    expect(result.ok).toBe(true);
    expect(result.ip).toBe('5.6.7.8');

    cleanup();
    https.get = origGet;
  });

  it('CONNECT 403 → error', async () => {
    const { handlers, cleanup } = createMockCheckProxy();

    const { checkProxy } = require('../../src/proxy/index.js');
    const promise = checkProxy({ host: 'p.com', port: 1080 }, 5000);

    await new Promise(r => setTimeout(r, 10));
    handlers.connect({ statusCode: 403 }, {});

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toContain('403');
    cleanup();
  });

  it('ECONNREFUSED → error', async () => {
    const { handlers, cleanup } = createMockCheckProxy();

    const { checkProxy } = require('../../src/proxy/index.js');
    const promise = checkProxy({ host: 'p.com', port: 1080 }, 5000);

    await new Promise(r => setTimeout(r, 10));
    handlers.error(new Error('ECONNREFUSED'));

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('ECONNREFUSED');
    cleanup();
  });

  it('timeout → error', async () => {
    const { handlers, cleanup } = createMockCheckProxy();

    const { checkProxy } = require('../../src/proxy/index.js');
    const promise = checkProxy({ host: 'p.com', port: 1080 }, 5000);

    await new Promise(r => setTimeout(r, 10));
    handlers.timeout();

    const result = await promise;
    expect(result.ok).toBe(false);
    expect(result.error).toBe('Timeout');
    cleanup();
  });
});

describe('Proxy Rotation (nock)', () => {
  beforeAll(() => nock.disableNetConnect());
  afterEach(() => nock.cleanAll());
  afterAll(() => nock.enableNetConnect());

  it('200 → ok', async () => {
    nock('http://rotate.com').get('/rotate').reply(200, 'ok');
    const { rotateProxy } = require('../../src/proxy/index.js');
    const r = await rotateProxy('http://rotate.com/rotate', 5000);
    expect(r.ok).toBe(true);
    expect(r.data).toBe('ok');
  });

  it('500 → error', async () => {
    nock('http://rotate.com').get('/rotate').reply(500);
    const { rotateProxy } = require('../../src/proxy/index.js');
    const r = await rotateProxy('http://rotate.com/rotate', 5000);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('500');
  });

  it('timeout → reject', async () => {
    nock('http://rotate.com').get('/rotate').delay(6000).reply(200);
    const { rotateProxy } = require('../../src/proxy/index.js');
    await expect(rotateProxy('http://rotate.com/rotate', 1000)).rejects.toThrow();
  });
});
