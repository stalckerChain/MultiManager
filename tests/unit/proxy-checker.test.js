import { describe, it, expect } from 'vitest';
import { SocksClient } from 'socks';

describe('Proxy Parser', () => {
  const { parseProxy, parseProxyList } = require('../../src/proxy/index.js');

  it('URL socks5://user:pass@host:port', () => {
    expect(parseProxy('socks5://user:pass@host.com:1080')).toEqual({
      type: 'socks5', host: 'host.com', port: 1080, username: 'user', password: 'pass',
    });
  });

  it('URL http://host:port', () => {
    expect(parseProxy('http://proxy.com:8080')).toEqual({
      type: 'http', host: 'proxy.com', port: 8080, username: null, password: null,
    });
  });

  it('IP:Port:User:Pass', () => {
    expect(parseProxy('82.22.234.231:8081:rcvwzenm:r9uk00kzz2z7')).toEqual({
      type: 'http', host: '82.22.234.231', port: 8081,
      username: 'rcvwzenm', password: 'r9uk00kzz2z7',
    });
  });

  it('все 5 прокси из make.md', () => {
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

  it('неверный формат → ошибка', () => {
    expect(() => parseProxy('not-a-proxy')).toThrow('Неверный формат');
  });

  it('bulk: комментарии и пустые строки', () => {
    expect(parseProxyList('\n# comment\n\nhttp://h:80\n')).toHaveLength(1);
  });
});

describe('SOCKS5 checkProxy', () => {
  it('socks5 ошибка → ok:false', async () => {
    const orig = SocksClient.createConnection;
    SocksClient.createConnection = async () => { throw new Error('refused'); };
    try {
      const { checkProxy } = require('../../src/proxy/index.js');
      const r = await checkProxy({ type: 'socks5', host: 'bad.com', port: 1080 }, 3000);
      expect(r.ok).toBe(false);
      expect(r.error).toBe('refused');
    } finally {
      SocksClient.createConnection = orig;
    }
  });
});
