const http = require('http');
const https = require('https');
const { URL } = require('url');
const { SocksClient } = require('socks');
const { logger } = require('../logger');

function parseProxy(proxyString) {
  const urlRegex = /^(https?|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/;
  const urlMatch = proxyString.match(urlRegex);
  
  if (urlMatch) {
    return {
      type: urlMatch[1],
      host: urlMatch[4],
      port: parseInt(urlMatch[5], 10),
      username: urlMatch[2] || null,
      password: urlMatch[3] || null,
    };
  }

  const colonParts = proxyString.split(':');
  if (colonParts.length === 4) {
    const [host, port, username, password] = colonParts;
    const portNum = parseInt(port, 10);
    if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
      return { type: 'http', host, port: portNum, username, password };
    }
  }

  if (colonParts.length === 2) {
    const [host, port] = colonParts;
    const portNum = parseInt(port, 10);
    if (!isNaN(portNum) && portNum > 0 && portNum <= 65535) {
      return { type: 'http', host, port: portNum, username: null, password: null };
    }
  }

  throw new Error(`Неверный формат прокси: ${proxyString}`);
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
        rejectUnauthorized: false,
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
      }).on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });

      setTimeout(() => {
        socket.destroy();
        resolve({ ok: false, error: 'Timeout' });
      }, timeout);
    });
  } catch (err) {
    return { ok: false, error: err.message };
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
        rejectUnauthorized: false,
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
      }).on('error', (err) => {
        resolve({ ok: false, error: err.message });
      });
    });

    req.on('error', (err) => {
      resolve({ ok: false, error: err.message });
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
    const url = new URL(rotationUrl);
    const client = url.protocol === 'https:' ? https : http;

    const req = client.get(rotationUrl, { timeout }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode === 200) {
          resolve({ ok: true, data });
        } else {
          resolve({ ok: false, error: `Status ${res.statusCode}` });
        }
      });
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Rotation timeout'));
    });
  });
}

module.exports = { parseProxy, parseProxyList, checkProxy, rotateProxy };
