const http = require('http');
const https = require('https');
const { URL } = require('url');

function parseProxy(proxyString) {
  const regex = /^(https?|socks5):\/\/(?:([^:]+):([^@]+)@)?([^:]+):(\d+)$/;
  const match = proxyString.match(regex);
  
  if (!match) {
    throw new Error(`Неверный формат прокси: ${proxyString}`);
  }

  return {
    type: match[1],
    host: match[4],
    port: parseInt(match[5], 10),
    username: match[2] || null,
    password: match[3] || null,
  };
}

function parseProxyList(text) {
  return text
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(parseProxy);
}

async function checkProxy(proxy, timeout = 10000) {
  return new Promise((resolve) => {
    const url = new URL('https://api.ipify.org?format=json');
    
    const req = http.request({
      host: proxy.host,
      port: proxy.port,
      method: 'CONNECT',
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
