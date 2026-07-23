import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SocksClient } from 'socks';
import http from 'http';
import https from 'https';
import { EventEmitter } from 'events';
import { parseProxy, parseProxyList, checkProxy, rotateProxy, getTimezoneByIp } from '../../src/proxy/index.js';

describe('Proxy Parser', () => {
  it('парсит SOCKS5 прокси с авторизацией', () => {
    expect(parseProxy('socks5://user:pass@host.com:1080')).toEqual({
      type: 'socks5', host: 'host.com', port: 1080, username: 'user', password: 'pass',
    });
  });

  it('парсит HTTP прокси без авторизации', () => {
    expect(parseProxy('http://proxy.example.com:8080')).toEqual({
      type: 'http', host: 'proxy.example.com', port: 8080, username: null, password: null,
    });
  });

  it('парсит HTTPS прокси', () => {
    expect(parseProxy('https://secure-proxy.com:443')).toEqual({
      type: 'https', host: 'secure-proxy.com', port: 443, username: null, password: null,
    });
  });

  it('парсит IP:Port:User:Pass', () => {
    expect(parseProxy('82.22.234.231:8081:rcvwzenm:r9uk00kzz2z7')).toEqual({
      type: 'http', host: '82.22.234.231', port: 8081,
      username: 'rcvwzenm', password: 'r9uk00kzz2z7',
    });
  });

  it('парсит IP:Port без авторизации', () => {
    expect(parseProxy('192.168.1.1:3128')).toEqual({
      type: 'http', host: '192.168.1.1', port: 3128, username: null, password: null,
    });
  });

  it('выбрасывает ошибку для неверного формата', () => {
    expect(() => parseProxy('invalid')).toThrow('Неверный формат прокси');
    expect(() => parseProxy('ftp://host:port')).toThrow('Неверный формат прокси');
  });

  it('выбрасывает ошибку при невалидном порте', () => {
    expect(() => parseProxy('host:0')).toThrow('Неверный формат прокси');
    expect(() => parseProxy('host:99999')).toThrow('Неверный формат прокси');
  });

  it('парсит список прокси с комментариями', () => {
    const text = `socks5://user:pass@host1.com:1080
http://host2.com:8080
# комментарий
https://host3.com:443`;

    const proxies = parseProxyList(text);
    expect(proxies).toHaveLength(3);
    expect(proxies[0].type).toBe('socks5');
    expect(proxies[1].type).toBe('http');
    expect(proxies[2].type).toBe('https');
  });

  it('фильтрует пустые строки и комментарии', () => {
    expect(parseProxyList('\n# comment\n\nhttp://h:80\n')).toHaveLength(1);
  });

  it('обрабатывает 5 прокси в формате IP:Port:User:Pass из bulk', () => {
    const proxies = parseProxyList([
      '82.22.234.231:8081:rcvwzenm:r9uk00kzz2z7',
      '45.159.54.102:6974:rcvwzenm:r9uk00kzz2z7',
      '31.58.24.212:6283:rcvwzenm:r9uk00kzz2z7',
      '194.39.32.186:6483:rcvwzenm:r9uk00kzz2z7',
      '31.56.138.121:6193:rcvwzenm:r9uk00kzz2z7',
    ].join('\n'));
    expect(proxies).toHaveLength(5);
    for (const p of proxies) {
      expect(p.type).toBe('http');
      expect(p.username).toBe('rcvwzenm');
      expect(p.password).toBe('r9uk00kzz2z7');
    }
  });

  it('формирует proxy-server флаг для браузера', () => {
    const proxy = { type: 'socks5', host: '1.2.3.4', port: 1080, username: 'user', password: 'pass' };
    const proxyUrl = `${proxy.type}://${proxy.username}:${proxy.password}@${proxy.host}:${proxy.port}`;
    expect(`--proxy-server=${proxyUrl}`).toBe('--proxy-server=socks5://user:pass@1.2.3.4:1080');
  });

  it('формирует proxy-server флаг без авторизации', () => {
    const proxy = { type: 'http', host: '5.6.7.8', port: 8080, username: null, password: null };
    const proxyUrl = `${proxy.type}://${proxy.host}:${proxy.port}`;
    expect(`--proxy-server=${proxyUrl}`).toBe('--proxy-server=http://5.6.7.8:8080');
  });
});

describe('checkProxy', () => {
  let origSocksCreate;
  let origHttpRequest;
  let origHttpsGet;

  function mockSocks(socket) {
    SocksClient.createConnection = vi.fn().mockResolvedValue({ socket: socket || { on: vi.fn(), destroy: vi.fn() } });
  }

  function mockSocksError(message) {
    SocksClient.createConnection = vi.fn().mockRejectedValue(new Error(message));
  }

  function mockHttpRequestWithConnect(socket) {
    http.request = vi.fn((opts, cb) => {
      const fakeRes = { statusCode: 200 };
      process.nextTick(() => cb(fakeRes, socket || { on: vi.fn(), destroy: vi.fn() }));
      const req = { on: vi.fn(), end: vi.fn(), destroy: vi.fn() };
      process.nextTick(() => req.emit && req.emit('connect', fakeRes, socket || { on: vi.fn(), destroy: vi.fn() }));
      return req;
    });
  }

  function mockHttpsGet(ip) {
    https.get = vi.fn((url, opts, cb) => {
      const fakeRes = {
        on: (event, handler) => {
          if (event === 'data') handler(Buffer.from(JSON.stringify({ ip: ip || '1.2.3.4' })));
          if (event === 'end') process.nextTick(handler);
          return fakeRes;
        },
      };
      process.nextTick(() => cb(fakeRes));
      return { on: vi.fn() };
    });
  }

  beforeEach(() => {
    origSocksCreate = SocksClient.createConnection;
    origHttpRequest = http.request;
    origHttpsGet = https.get;
  });

  afterEach(() => {
    SocksClient.createConnection = origSocksCreate;
    http.request = origHttpRequest;
    https.get = origHttpsGet;
  });

  it('socks5: ошибка подключения → ok:false', async () => {
    mockSocksError('refused');
    const r = await checkProxy({ type: 'socks5', host: 'bad.com', port: 1080 }, 3000);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('refused');
  });

  it('socks5: успешная проверка → ok:true + ip', async () => {
    mockSocks({ on: vi.fn(), destroy: vi.fn() });
    mockHttpsGet('5.6.7.8');
    const r = await checkProxy({ type: 'socks5', host: 'good.com', port: 1080 }, 3000);
    expect(r.ok).toBe(true);
    expect(r.ip).toBe('5.6.7.8');
  });

  it('HTTP: ошибка CONNECT → fallback на SOCKS5', async () => {
    http.request = vi.fn((opts, cb) => {
      const req = { on: vi.fn((event, handler) => { if (event === 'error') process.nextTick(() => handler(new Error('ECONNREFUSED'))); return req; }), end: vi.fn(), destroy: vi.fn() };
      return req;
    });
    mockSocks({ on: vi.fn(), destroy: vi.fn() });
    mockHttpsGet('1.2.3.4');
    const r = await checkProxy({ type: 'http', host: 'proxy.com', port: 8080, username: 'u', password: 'p' }, 3000);
    expect(r.ok).toBe(true);
    expect(r.detectedType).toBe('socks5');
  });

  function makeRequestMock() {
    const req = new EventEmitter();
    req.end = vi.fn();
    req.destroy = vi.fn();
    req.setTimeout = vi.fn().mockImplementation((ms, cb) => { if (cb) req.once('timeout', cb); return req; });
    req.abort = vi.fn();
    req.emit = EventEmitter.prototype.emit.bind(req);
    return req;
  }

  function createConnectProxyMock(fakeSocket, statusCode) {
    http.request = vi.fn((opts) => {
      const req = makeRequestMock();
      process.nextTick(() => req.emit('connect', { statusCode }, fakeSocket));
      return req;
    });
  }

  it('HTTP: CONNECT успешен → ok:true', async () => {
    const fakeSocket = new EventEmitter();
    createConnectProxyMock(fakeSocket, 200);
    mockHttpsGet('10.0.0.1');
    const r = await checkProxy({ type: 'http', host: 'good-http.com', port: 3128 }, 3000);
    expect(r.ok).toBe(true);
    expect(r.ip).toBe('10.0.0.1');
  });

  it('HTTP: CONNECT не 200 → ok:false', async () => {
    const fakeSocket = new EventEmitter();
    createConnectProxyMock(fakeSocket, 407);
    const r = await checkProxy({ type: 'http', host: 'auth-req.com', port: 3128 }, 3000);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('407');
  });

  it('HTTPS: прокси проверяется через checkHttpProxy', async () => {
    const fakeSocket = new EventEmitter();
    createConnectProxyMock(fakeSocket, 200);
    mockHttpsGet('9.9.9.9');
    const r = await checkProxy({ type: 'https', host: 'secure.com', port: 443 }, 3000);
    expect(r.ok).toBe(true);
    expect(r.ip).toBe('9.9.9.9');
  });

  it('таймаут HTTP CONNECT → ok:false', async () => {
    http.request = vi.fn((opts, cb) => {
      const req = { on: vi.fn((event, handler) => { if (event === 'timeout') setTimeout(() => handler(), 0); return req; }), end: vi.fn(), destroy: vi.fn() };
      return req;
    });
    const r = await checkProxy({ type: 'http', host: 'slow.com', port: 8080 }, 100);
    expect(r.ok).toBe(false);
  });
});

describe('rotateProxy', () => {
  let origHttpGet;

  beforeEach(() => {
    origHttpGet = http.get;
  });

  afterEach(() => {
    http.get = origHttpGet;
  });

  it('успешная ротация с status 200', async () => {
    http.get = vi.fn((url, opts, cb) => {
      const fakeRes = { statusCode: 200, on: (event, handler) => { if (event === 'data') handler(Buffer.from('ok')); if (event === 'end') process.nextTick(handler); return fakeRes; } };
      process.nextTick(() => cb(fakeRes));
      return { on: vi.fn() };
    });
    const r = await rotateProxy('http://api.proxy.com/rotate');
    expect(r.ok).toBe(true);
    expect(r.data).toBe('ok');
  });

  it('ротация с status не 200 → ok:false', async () => {
    http.get = vi.fn((url, opts, cb) => {
      const fakeRes = { statusCode: 429, on: (event, handler) => { if (event === 'data') handler(Buffer.from('too many')); if (event === 'end') process.nextTick(handler); return fakeRes; } };
      process.nextTick(() => cb(fakeRes));
      return { on: vi.fn() };
    });
    const r = await rotateProxy('http://api.proxy.com/rotate');
    expect(r.ok).toBe(false);
    expect(r.error).toContain('429');
  });

  it('ротация через https', async () => {
    https.get = vi.fn((url, opts, cb) => {
      const fakeRes = { statusCode: 200, on: (event, handler) => { if (event === 'data') handler(Buffer.from('ip changed')); if (event === 'end') process.nextTick(handler); return fakeRes; } };
      process.nextTick(() => cb(fakeRes));
      return { on: vi.fn() };
    });
    const r = await rotateProxy('https://api.proxy.com/rotate');
    expect(r.ok).toBe(true);
  });

  it('ошибка сети при ротации → reject', async () => {
    http.get = vi.fn((url, opts, cb) => {
      const req = { on: vi.fn((event, handler) => { if (event === 'error') process.nextTick(() => handler(new Error('ENOTFOUND'))); return req; }) };
      return req;
    });
    await expect(rotateProxy('http://invalid-url/rotate')).rejects.toThrow('ENOTFOUND');
  });

  it('таймаут ротации → reject', async () => {
    http.get = vi.fn((url, opts, cb) => {
      const req = { on: vi.fn((event, handler) => { if (event === 'timeout') process.nextTick(() => handler()); return req; }), destroy: vi.fn() };
      return req;
    });
    await expect(rotateProxy('http://slow-proxy/rotate', 50)).rejects.toThrow('Rotation timeout');
  });
});

describe('getTimezoneByIp', () => {
  let origHttpGet;

  beforeEach(() => {
    origHttpGet = http.get;
  });

  afterEach(() => {
    http.get = origHttpGet;
  });

  function mockIpApi(response) {
    http.get = vi.fn((url, opts, cb) => {
      const fakeRes = {
        on: (event, handler) => {
          if (event === 'data') handler(Buffer.from(JSON.stringify(response)));
          if (event === 'end') process.nextTick(handler);
          return fakeRes;
        },
      };
      process.nextTick(() => cb(fakeRes));
      return { on: vi.fn() };
    });
  }

  it('успешный запрос → ok:true + timezone + location', async () => {
    mockIpApi({ status: 'success', timezone: 'Europe/Berlin', countryCode: 'DE', country: 'Germany' });
    const r = await getTimezoneByIp('1.2.3.4');
    expect(r.ok).toBe(true);
    expect(r.timezone).toBe('Europe/Berlin');
    expect(r.location).toBe('DE(Germany)');
  });

  it('успешный запрос без страны → location = null', async () => {
    mockIpApi({ status: 'success', timezone: 'UTC' });
    const r = await getTimezoneByIp('1.2.3.4');
    expect(r.ok).toBe(true);
    expect(r.timezone).toBe('UTC');
    expect(r.location).toBeNull();
  });

  it('ошибка API → ok:false', async () => {
    mockIpApi({ status: 'fail', message: 'reserved range' });
    const r = await getTimezoneByIp('10.0.0.1');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('reserved range');
  });

  it('ошибка сети → ok:false', async () => {
    http.get = vi.fn((url, opts, cb) => {
      const req = { on: vi.fn((event, handler) => { if (event === 'error') process.nextTick(() => handler(new Error('ENOTFOUND'))); return req; }) };
      return req;
    });
    const r = await getTimezoneByIp('bad-host');
    expect(r.ok).toBe(false);
    expect(r.error).toBe('ENOTFOUND');
  });

  it('таймаут → ok:false', async () => {
    http.get = vi.fn((url, opts, cb) => {
      const req = { on: vi.fn((event, handler) => { if (event === 'timeout') process.nextTick(() => handler()); return req; }), destroy: vi.fn() };
      return req;
    });
    const r = await getTimezoneByIp('slow-host', 50);
    expect(r.ok).toBe(false);
    expect(r.error).toBe('Timeout');
  });
});
