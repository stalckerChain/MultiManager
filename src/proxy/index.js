const http = require('http');
const https = require('https');
const { URL } = require('url');
const { SocksClient } = require('socks');
const { logger } = require('../logger');

const ROTATION_RESPONSE_LIMIT = 10 * 1024 * 1024;
const IPV4_LEADING_ZERO = /^0\d+/;
const IPV4_OCTET = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;
const MAX_REDIRECTS = 5;

function parseProxy(proxyString) {
  const urlRegex = /^(https?|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/;
  const urlMatch = proxyString.match(urlRegex);
  
  if (urlMatch) {
    const port = parseInt(urlMatch[5], 10);
    if (port <= 0 || port > 65535) throw new Error(`Неверный формат прокси: ${proxyString}`);

    if (!isValidHostOrIp(urlMatch[4])) {
      throw new Error(`Неверный формат прокси: ${proxyString}`);
    }

    return {
      type: urlMatch[1],
      host: urlMatch[4],
      port,
      username: urlMatch[2] || null,
      password: urlMatch[3] || null,
    };
  }

  const colonParts = proxyString.split(':');
  if (colonParts.length === 4) {
    const [host, port, username, password] = colonParts;
    const portNum = parseInt(port, 10);
    if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
      if (!isValidHostOrIp(host)) throw new Error(`Неверный формат прокси: ${proxyString}`);
      return { type: 'http', host, port: portNum, username, password };
    }
  }

  if (colonParts.length === 2) {
    const [host, port] = colonParts;
    const portNum = parseInt(port, 10);
    if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
      if (!isValidHostOrIp(host)) throw new Error(`Неверный формат прокси: ${proxyString}`);
      return { type: 'http', host, port: portNum, username: null, password: null };
    }
  }

  throw new Error(`Неверный формат прокси: ${proxyString}`);
}

function isValidHostOrIp(host) {
  if (!host || typeof host !== 'string') return false;
  const lower = host.toLowerCase();

  if (lower === 'localhost' || lower === '::1') return true;
  if (lower.includes('\0') || lower.includes(' ') || lower.includes('\n') || lower.includes('\r')) return false;

  if (/^[0-9a-f:]+$/i.test(lower)) return true;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(lower)) return true;
  if (/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i.test(lower)) return true;

  return false;
}

function isPrivateAddress(hostname) {
  if (!hostname || typeof hostname !== 'string') return false;
  const lower = hostname.toLowerCase().trim();

  if (lower === 'localhost' || lower === '[::1]' || lower === '[::]' || lower === '::1') return true;
  if (lower === '0.0.0.0') return true;

  if (lower.startsWith('127.') && IPV4_OCTET.test(lower)) {
    const octets = lower.split('.');
    if (octets.length === 4 && !isNaN(parseInt(octets[0])) && !isNaN(parseInt(octets[1])) &&
        !isNaN(parseInt(octets[2])) && !isNaN(parseInt(octets[3]))) return true;
  }

  if (lower === 'fe80::' || lower.startsWith('fe80:')) return true;
  if (lower === 'ff00::' || lower.startsWith('ff0')) return true;
  if (lower === 'fc00::' || lower.startsWith('fc') || lower.startsWith('fd')) return true;

  if (IPV4_OCTET.test(lower)) {
    const octets = lower.split('.').map(Number);
    if (octets.length !== 4 || octets.some(o => isNaN(o) || o > 255)) return false;
    if (octets[0] === 10) return true;
    if (octets[0] === 127) return true;
    if (octets[0] === 0) return true;
    if (octets[0] === 192 && octets[1] === 168) return true;
    if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) return true;
    if (octets[0] === 100 && octets[1] >= 64 && octets[1] <= 127) return true;
    if (octets[0] === 169 && octets[1] === 254) return true;
  }

  if (lower.startsWith('::ffff:')) {
    const ipv4 = lower.slice(7);
    if (IPV4_OCTET.test(ipv4)) return isPrivateAddress(ipv4);
  }

  if (lower.startsWith('64:ff9b::') || lower.startsWith('64:ff9b:1:')) return true;

  if (IPV4_OCTET.test(lower) && IPV4_LEADING_ZERO.test(lower)) return true;

  return false;
}

function parseProxyList(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(parseProxy);
}

async function checkSocks5Proxy(proxy, timeout = 10000) {
  try {
    const options = {
      proxy: {
        host: proxy.host,
        port: proxy.port,
        type: 5,
        userId: proxy.username || undefined,
        password: proxy.password || undefined,
      },
      command: 'connect',
      destination: {
        host: 'api.ipify.org',
        port: 443,
      },
      timeout,
    };

    const { socket } = await SocksClient.createConnection(options);
    
    return new Promise((resolve) => {
      const agent = new https.Agent({
        socket,
        rejectUnauthorized: true,
      });

      https.get('https://api.ipify.org?format=json', { agent }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: true, ip: json.ip });
          } catch {
            resolve({ ok: false, error: 'Invalid response' });
          }
        });
      }).on('error', () => {
        resolve({ ok: false, error: 'Connection failed' });
      });

      setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Timeout' });
      }, timeout);
    });
  } catch {
    return { ok: false, error: 'Connection failed' };
  }
}

async function checkHttpProxy(proxy, timeout = 10000) {
  return new Promise((resolve) => {
    const headers = {};
    if (proxy.username && proxy.password) {
      const auth = Buffer.from(`${proxy.username}:${proxy.password}`).toString('base64');
      headers['Proxy-Authorization'] = `Basic ${auth}`;
    }

    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
      headers,
      timeout,
    });

    req.on('connect', (res, socket) => {
      if (res.statusCode !== 200) {
        resolve({ ok: false, error: `Connect failed: ${res.statusCode}` });
        return;
      }

      const agent = new https.Agent({
        socket,
        rejectUnauthorized: true,
      });

      https.get('https://api.ipify.org?format=json', { agent }, (response) => {
        let data = '';
        response.on('data', chunk => data += chunk);
        response.on('end', () => {
          try {
            const json = JSON.parse(data);
            resolve({ ok: true, ip: json.ip });
          } catch {
            resolve({ ok: false, error: 'Invalid response' });
          }
        });
      }).on('error', () => {
        resolve({ ok: false, error: 'Connection failed' });
      });
    });

    req.on('error', () => {
      resolve({ ok: false, error: 'Connection failed' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout' });
    });

    req.end();
  });
}

async function checkProxy(proxy, timeout = 10000) {
  logger.info({ type: proxy.type, host: proxy.host, port: proxy.port }, 'ProxyCheck started');

  if (proxy.type === 'socks5') {
    return checkSocks5Proxy(proxy, timeout);
  }

  if (proxy.type === 'http') {
    const httpResult = await checkHttpProxy(proxy, timeout);
    if (httpResult.ok) {
      return httpResult;
    }

    const socksResult = await checkSocks5Proxy(proxy, timeout);
    if (socksResult.ok) {
      return { ...socksResult, detectedType: 'socks5' };
    }

    return httpResult;
  }

  return checkHttpProxy(proxy, timeout);
}

async function rotateProxy(rotationUrl, timeout = 10000) {
  return new Promise((resolve, reject) => {
    const doRotate = (currentUrl, redirectsLeft) => {
      let url;
      try {
        url = new URL(currentUrl);
      } catch {
        return reject(new Error('Invalid rotation URL'));
      }

      if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return reject(new Error('Rotation URL must use http or https protocol'));
      }

      if (redirectsLeft <= 0) {
        return reject(new Error('Too many redirects'));
      }

      if (isPrivateAddress(url.hostname)) {
        return reject(new Error('Rotation URL cannot point to private/local addresses'));
      }

      const client = url.protocol === 'https:' ? https : http;

      const req = client.get(currentUrl, { timeout }, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) {
          if (res.headers.location) {
            try {
              const nextUrl = new URL(res.headers.location, currentUrl).href;
              res.destroy();
              return doRotate(nextUrl, redirectsLeft - 1);
            } catch {
              res.destroy();
              return reject(new Error('Invalid redirect URL'));
            }
          }
        }

        let data = '';
        let totalSize = 0;

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > ROTATION_RESPONSE_LIMIT) {
            req.destroy();
            res.destroy();
            reject(new Error('Rotation response too large'));
            return;
          }
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode === 200) {
            resolve({ ok: true, data });
          } else {
            resolve({ ok: false, error: `Status ${res.statusCode}` });
          }
        });
      });

      req.on('error', () => reject(new Error('Network error')));
      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Rotation timeout'));
      });
    };

    doRotate(rotationUrl, MAX_REDIRECTS);
  });
}

async function getTimezoneByIp(ip, timeout = 5000) {
  return new Promise((resolve) => {
    const req = http.get(`http://ip-api.com/json/${encodeURIComponent(ip)}?fields=status,message,timezone,countryCode,country`, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          if (json.status === 'success') {
            const location = (json.countryCode && json.country)
              ? `${json.countryCode}(${json.country})`
              : null;
            resolve({ ok: true, timezone: json.timezone || null, location });
          } else {
            resolve({ ok: false, error: json.message || 'Unknown error' });
          }
        } catch {
          resolve({ ok: false, error: 'Invalid response' });
        }
      });
    });

    req.on('error', () => {
      resolve({ ok: false, error: 'Network error' });
    });

    req.on('timeout', () => {
      req.destroy();
      resolve({ ok: false, error: 'Timeout' });
    });
  });
}

module.exports = { parseProxy, parseProxyList, checkProxy, rotateProxy, getTimezoneByIp, isPrivateAddress, isValidHostOrIp };
