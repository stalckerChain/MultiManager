import { describe, it, expect } from 'vitest';
import { parseProxy, parseProxyList } from '../../src/proxy/index.js';

describe('Proxy Parser', () => {
  it('парсит SOCKS5 прокси с авторизацией', () => {
    const proxy = parseProxy('socks5://user:pass@host.com:1080');
    
    expect(proxy).toEqual({
      type: 'socks5',
      host: 'host.com',
      port: 1080,
      username: 'user',
      password: 'pass',
    });
  });

  it('парсит HTTP прокси без авторизации', () => {
    const proxy = parseProxy('http://proxy.example.com:8080');
    
    expect(proxy).toEqual({
      type: 'http',
      host: 'proxy.example.com',
      port: 8080,
      username: null,
      password: null,
    });
  });

  it('парсит HTTPS прокси', () => {
    const proxy = parseProxy('https://secure-proxy.com:443');
    
    expect(proxy).toEqual({
      type: 'https',
      host: 'secure-proxy.com',
      port: 443,
      username: null,
      password: null,
    });
  });

  it('выбрасывает ошибку для неверного формата', () => {
    expect(() => parseProxy('invalid')).toThrow('Неверный формат прокси');
    expect(() => parseProxy('ftp://host:port')).toThrow('Неверный формат прокси');
  });

  it('парсит список прокси', () => {
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
    const text = `
# комментарий 1

socks5://host:1080

# комментарий 2
`;

    const proxies = parseProxyList(text);
    expect(proxies).toHaveLength(1);
  });
});
