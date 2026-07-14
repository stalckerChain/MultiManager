const WebSocket = require('ws');
const http = require('http');
const { logger } = require('../logger');

const DEFAULT_TIMEOUT = 15000;
const WS_CONNECT_TIMEOUT = 5000;

let _nextId = 1;

function nextId() {
  return _nextId++;
}

/**
 * Отправить CDP-вызов и дождаться ответа.
 * @param {WebSocket} ws - WebSocket соединение
 * @param {string} method - CDP метод
 * @param {object} params - параметры метода
 * @param {object} opts - опции: { sessionId, timeout }
 * @returns {Promise<object>} result из CDP-ответа
 */
function call(ws, method, params = {}, opts = {}) {
  const { sessionId, timeout = DEFAULT_TIMEOUT } = opts;
  const id = nextId();

  return new Promise((resolve, reject) => {
    const msg = { id, method, params };
    if (sessionId) msg.sessionId = sessionId;

    const timer = setTimeout(() => {
      ws.removeListener('message', handler);
      reject(new Error(`CDP timeout: ${method}`));
    }, timeout);

    const handler = (raw) => {
      try {
        const resp = JSON.parse(raw.toString());
        if (resp.id === id) {
          clearTimeout(timer);
          ws.removeListener('message', handler);
          if (resp.error) {
            reject(new Error(resp.error.message));
          } else {
            resolve(resp.result);
          }
        }
      } catch (err) {
        logger.debug({ method, error: err.message }, 'CDP: ошибка парсинга ответа');
      }
    };

    ws.on('message', handler);
    ws.send(JSON.stringify(msg));
  });
}

/**
 * Fire-and-forget CDP-вызов (без ожидания ответа).
 */
function send(ws, method, params = {}, opts = {}) {
  const { sessionId } = opts;
  const id = nextId();
  const msg = { id, method, params };
  if (sessionId) msg.sessionId = sessionId;
  ws.send(JSON.stringify(msg));
}

/**
 * Установить WebSocket соединение к CDP порту.
 * @param {number} port - CDP порт
 * @param {object} opts - опции: { timeout }
 * @returns {Promise<WebSocket>}
 */
function connect(port, opts = {}) {
  const { timeout = WS_CONNECT_TIMEOUT } = opts;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${port}/devtools/browser`);
    let settled = false;

    ws.on('open', () => {
      if (!settled) {
        settled = true;
        resolve(ws);
      }
    });

    ws.on('error', (err) => {
      if (!settled) {
        settled = true;
        reject(err);
      }
    });

    setTimeout(() => {
      if (!settled) {
        settled = true;
        ws.close();
        reject(new Error('WS connect timeout'));
      }
    }, timeout);
  });
}

/**
 * Обнаружить WebSocket URL через HTTP /json/version или /json.
 * @param {number} cdpPort
 * @returns {Promise<string>} WebSocket URL
 */
function discoverWsUrl(cdpPort) {
  const paths = ['/json/version', '/json'];

  return new Promise((resolve) => {
    let resolved = false;

    const tryPath = (index) => {
      if (resolved || index >= paths.length) {
        if (!resolved) {
          resolved = true;
          resolve(`ws://127.0.0.1:${cdpPort}/devtools/browser`);
        }
        return;
      }

      const path = paths[index];
      const req = http.get(`http://127.0.0.1:${cdpPort}${path}`, { timeout: 3000 }, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const data = JSON.parse(body);
            if (path === '/json/version' && data.webSocketDebuggerUrl) {
              resolved = true;
              resolve(data.webSocketDebuggerUrl);
            } else if (path === '/json' && Array.isArray(data)) {
              const page = data.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
              if (page) {
                resolved = true;
                resolve(page.webSocketDebuggerUrl);
              } else {
                tryPath(index + 1);
              }
            } else {
              tryPath(index + 1);
            }
          } catch {
            tryPath(index + 1);
          }
        });
      });

      req.on('error', () => tryPath(index + 1));
      req.on('timeout', () => { req.destroy(); tryPath(index + 1); });
    };

    tryPath(0);
  });
}

/**
 * Получить список табов через HTTP /json.
 * @param {number} cdpPort
 * @returns {Promise<Array<{id: string, url: string, type: string}>>}
 */
function getHttpTabs(cdpPort) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${cdpPort}/json`, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', (chunk) => { body += chunk; });
      res.on('end', () => {
        try {
          const data = JSON.parse(body);
          if (!Array.isArray(data)) return resolve([]);
          const tabs = data
            .filter(t => t.type === 'page' && !(t.url || '').startsWith('devtools://'))
            .map(t => ({ id: t.id, url: t.url || '', type: t.type }));
          resolve(tabs);
        } catch {
          resolve([]);
        }
      });
    });
    req.on('error', () => resolve([]));
    req.on('timeout', () => { req.destroy(); resolve([]); });
  });
}

module.exports = { call, send, connect, discoverWsUrl, getHttpTabs };
