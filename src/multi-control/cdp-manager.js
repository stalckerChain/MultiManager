const WebSocket = require('ws');
const { logger } = require('../logger');

const EVENT_INJECTION_SCRIPT = `
(function() {
  if (window.__MM_SYNC_ACTIVE__) return;
  window.__MM_SYNC_ACTIVE__ = true;

  var _buf = null;
  var _timer = null;
  var THROTTLE = 25;

  function flush() {
    var b = _buf;
    _buf = null;
    _timer = null;
    if (b && window.__MM_CDP_SEND__) {
      window.__MM_CDP_SEND__(JSON.stringify(b));
    }
  }

  function emit(type, data) {
    var msg = Object.assign({ __mm_event: true, type: type }, data);
    if (type === 'mouseMove') {
      _buf = msg;
      if (!_timer) _timer = setTimeout(flush, THROTTLE);
    } else {
      if (_timer) { clearTimeout(_timer); _timer = null; }
      _buf = null;
      window.__MM_CDP_SEND__(JSON.stringify(msg));
    }
  }

  document.addEventListener('mousemove', function(e) {
    emit('mouseMove', { x: e.pageX, y: e.pageY });
  }, true);

  document.addEventListener('mousedown', function(e) {
    emit('mouseDown', { x: e.pageX, y: e.pageY, button: e.button, clickCount: e.detail || 1 });
  }, true);

  document.addEventListener('mouseup', function(e) {
    emit('mouseUp', { x: e.pageX, y: e.pageY, button: e.button });
  }, true);

  document.addEventListener('wheel', function(e) {
    emit('scroll', { x: e.pageX, y: e.pageY, deltaX: e.deltaX, deltaY: e.deltaY });
  }, true);

  document.addEventListener('keydown', function(e) {
    emit('keyDown', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode });
  }, true);

  document.addEventListener('keyup', function(e) {
    emit('keyUp', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode });
  }, true);

  document.addEventListener('click', function(e) {
    emit('click', { x: e.pageX, y: e.pageY, button: e.button, clickCount: e.detail || 1 });
  }, true);
})();
`;

class CdpManager {
  constructor() {
    this.sessions = new Map();
    this.onEvent = null;
  }

  async _discoverWsUrl(cdpPort) {
    const http = require('http');

    const versions = ['/json/version', '/json'];
    for (const path of versions) {
      try {
        const data = await new Promise((resolve, reject) => {
          const req = http.get(`http://127.0.0.1:${cdpPort}${path}`, { timeout: 3000 }, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
              try { resolve(JSON.parse(body)); } catch { reject(new Error('Invalid JSON')); }
            });
          });
          req.on('error', reject);
          req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
        });

        if (path === '/json/version' && data.webSocketDebuggerUrl) {
          return data.webSocketDebuggerUrl;
        }

        if (path === '/json' && Array.isArray(data)) {
          const page = data.find(t => t.type === 'page' && t.webSocketDebuggerUrl);
          if (page) return page.webSocketDebuggerUrl;
        }
      } catch {}
    }

    return `ws://127.0.0.1:${cdpPort}/devtools/browser`;
  }

  async connect(profileId, cdpPort) {
    if (this.sessions.has(profileId)) {
      this.disconnect(profileId);
    }

    const wsUrl = await this._discoverWsUrl(cdpPort);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
      let connected = false;

      ws.on('open', () => {
        connected = true;
        const id = Math.floor(Math.random() * 1e9);
        ws.send(JSON.stringify({
          id,
          method: 'Target.getTargets',
        }));

        const handler = (raw) => {
          try {
            const msg = JSON.parse(raw);
            if (msg.id === id && msg.result) {
              ws.removeListener('message', handler);
              const pages = (msg.result.targetInfos || []).filter(
                t => t.type === 'page' && !t.url.startsWith('devtools://')
              );
              if (pages.length === 0) {
                ws.close();
                reject(new Error('No page targets found'));
                return;
              }
              this._setupPageSession(ws, profileId, pages[0].targetId, resolve);
            }
          } catch {}
        };
        ws.on('message', handler);
      });

      ws.on('error', (err) => {
        if (!connected) {
          reject(err);
        }
      });

      ws.on('close', () => {
        this.sessions.delete(profileId);
      });

      setTimeout(() => {
        if (!connected) {
          ws.close();
          reject(new Error('CDP connection timeout'));
        }
      }, 5000);
    });
  }

  _setupPageSession(browserWs, profileId, targetId, resolve) {
    const attachId = Math.floor(Math.random() * 1e9);
    browserWs.send(JSON.stringify({
      id: attachId,
      method: 'Target.attachToTarget',
      params: { targetId, flatten: true },
    }));

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.id === attachId) {
          browserWs.removeListener('message', handler);
          if (msg.error) {
            browserWs.close();
            return;
          }
          const sessionId = msg.result.sessionId;
          const session = { ws: browserWs, sessionId, targetId, profileId };
          this.sessions.set(profileId, session);
          this._enableInput(session);
          resolve(session);
        }
      } catch {}
    };
    browserWs.on('message', handler);
  }

  _enableInput(session) {
    this._send(session, 'Runtime.enable', {});
    this._send(session, 'Page.enable', {});

    const bindingId = `__mm_sync_${session.sessionId}`;
    logger.info({
      profileId: session.profileId,
      bindingId,
      sessionId: session.sessionId,
      targetId: session.targetId,
    }, 'CDP: ENABLE INPUT — starting setup');

    const addBindingId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: addBindingId,
      method: 'Runtime.addBinding',
      sessionId: session.sessionId,
      params: { name: bindingId },
    }));

    const fallbackScript = `
(function() {
  if (window.__MM_SYNC_ACTIVE__) return;
  window.__MM_SYNC_ACTIVE__ = true;
  var HAS_BINDING = typeof window['${bindingId}'] === 'function';
  function SEND(data) {
    if (HAS_BINDING) { window['${bindingId}'](data); }
    else { console.log(data); }
  }
  var _buf = null, _timer = null, THROTTLE = 25;
  function flush() { var b = _buf; _buf = null; _timer = null; if (b) SEND(JSON.stringify(b)); }
  function emit(type, data) {
    var msg = Object.assign({ __mm_event: true, type: type }, data);
    if (type === 'mouseMove') { _buf = msg; if (!_timer) _timer = setTimeout(flush, THROTTLE); }
    else { if (_timer) { clearTimeout(_timer); _timer = null; } _buf = null; SEND(JSON.stringify(msg)); }
  }
  document.addEventListener('mousemove', function(e) { emit('mouseMove', { x: e.pageX, y: e.pageY }); }, true);
  document.addEventListener('mousedown', function(e) { emit('mouseDown', { x: e.pageX, y: e.pageY, button: e.button, clickCount: e.detail || 1 }); }, true);
  document.addEventListener('mouseup', function(e) { emit('mouseUp', { x: e.pageX, y: e.pageY, button: e.button }); }, true);
  document.addEventListener('wheel', function(e) { emit('scroll', { x: e.pageX, y: e.pageY, deltaX: e.deltaX, deltaY: e.deltaY }); }, true);
  document.addEventListener('keydown', function(e) { emit('keyDown', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode }); }, true);
  document.addEventListener('keyup', function(e) { emit('keyUp', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode }); }, true);
  document.addEventListener('click', function(e) { emit('click', { x: e.pageX, y: e.pageY, button: e.button, clickCount: e.detail || 1 }); }, true);
})();
`;

    const runtimeId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: runtimeId,
      method: 'Runtime.evaluate',
      sessionId: session.sessionId,
      params: {
        expression: fallbackScript,
      },
    }));

    const testId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: testId,
      method: 'Runtime.evaluate',
      sessionId: session.sessionId,
      params: {
        expression: `(function() { try { window['${bindingId}'](JSON.stringify({__mm_event:true,type:'test',x:0,y:0})); return 'binding_ok'; } catch(e) { return 'binding_error:' + e.message; } })()`,
        returnByValue: true,
      },
    }));

    session.bindingId = bindingId;

    let eventCount = 0;
    let msgCount = 0;
    session.eventHandler = (raw) => {
      msgCount++;
      try {
        const msg = JSON.parse(raw);
        // Логируем ВСЕ входящие сообщения (первые 100)
        if (msgCount <= 100) {
          logger.info({
            profileId: session.profileId,
            msgCount,
            method: msg.method || '(no method)',
            id: msg.id,
            sessionId: msg.sessionId,
            hasResult: !!msg.result,
            hasError: !!msg.error,
            hasParams: !!msg.params,
          }, 'CDP: RAW MSG');
        }

        // Тест binding
        if (msg.id === testId) {
          logger.info({
            profileId: session.profileId,
            result: msg.result?.result?.value,
            error: msg.error,
            sessionId: msg.sessionId,
          }, 'CDP: BINDING TEST RESULT');
        }

        let payload = null;
        // Runtime.bindingCalled — ЛОГИРУЕМ ВСЁ
        if (msg.method === 'Runtime.bindingCalled') {
          const match = msg.sessionId === session.sessionId;
          const bp = msg.params?.payload ?? msg.payload;
          logger.info({
            profileId: session.profileId,
            msgSid: msg.sessionId,
            expectedSid: session.sessionId,
            match,
            name: msg.params?.name ?? msg.name,
            payloadPreview: typeof bp === 'string' ? bp.substring(0, 300) : bp,
            payloadLen: bp?.length,
            hasParams: !!msg.params,
            rawKeys: Object.keys(msg).join(','),
          }, 'CDP: BINDING CALLED');
          if (match) {
            payload = bp;
          } else {
            logger.warn({
              profileId: session.profileId,
              msgSid: msg.sessionId,
              expectedSid: session.sessionId,
            }, 'CDP: BINDING CALLED SESSION MISMATCH — IGNORED');
          }
        }

        // Runtime.consoleAPICalled — fallback
        if (!payload && msg.method === 'Runtime.consoleAPICalled' && msg.sessionId === session.sessionId) {
          const args = msg.params?.args;
          if (args && args.length > 0 && args[0].type === 'string') {
            payload = args[0].value;
            logger.info({
              profileId: session.profileId,
              consolePayload: typeof payload === 'string' ? payload.substring(0, 300) : payload,
              argsCount: args.length,
              argTypes: args.map(a => a.type),
            }, 'CDP: CONSOLE API PAYLOAD');
          }
        }

        // Обработка payload
        if (payload) {
          eventCount++;
          logger.info({
            profileId: session.profileId,
            eventCount,
            payloadLen: payload.length,
            payloadPreview: typeof payload === 'string' ? payload.substring(0, 300) : payload,
          }, 'CDP: EVENT RECEIVED');
          try {
            const event = JSON.parse(payload);
            const hasOnEvent = !!this.onEvent;
            const isMmEvent = !!event.__mm_event;
            logger.info({
              profileId: session.profileId,
              eventType: event.type,
              isMmEvent,
              hasOnEvent,
              keys: Object.keys(event).join(','),
            }, 'CDP: EVENT PARSED');
            if (isMmEvent && hasOnEvent) {
              this.onEvent(session.profileId, event);
              logger.info({ profileId: session.profileId, eventType: event.type }, 'CDP: EVENT DISPATCHED TO CONTROLLER');
            } else if (isMmEvent && !hasOnEvent) {
              logger.warn({ profileId: session.profileId }, 'CDP: onEvent callback is NULL!');
            } else if (!isMmEvent) {
              logger.info({ profileId: session.profileId, keys: Object.keys(event).join(',') }, 'CDP: NOT __mm_event — SKIP');
            }
          } catch (e) {
            logger.error({
              profileId: session.profileId,
              error: e.message,
              payload: typeof payload === 'string' ? payload.substring(0, 200) : payload,
            }, 'CDP: PARSE ERROR');
          }
        }

        if (msg.method === 'Runtime.exceptionThrown' && msg.sessionId === session.sessionId) {
          logger.error({ profileId: session.profileId, details: msg.params?.exceptionDetails?.text }, 'CDP: EXCEPTION IN PAGE');
        }
      } catch {}
    };
    session.ws.on('message', session.eventHandler);
  }

  _send(session, method, params) {
    const id = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id,
      sessionId: session.sessionId,
      method,
      params,
    }));
  }

  dispatchMouseEvent(profileId, type, params) {
    const session = this.sessions.get(profileId);
    if (!session) return;
    this._send(session, 'Input.dispatchMouseEvent', { type, ...params });
  }

  dispatchKeyEvent(profileId, type, params) {
    const session = this.sessions.get(profileId);
    if (!session) return;
    this._send(session, 'Input.dispatchKeyEvent', { type, ...params });
  }

  setWindowTitle(profileId, title) {
    const session = this.sessions.get(profileId);
    if (!session) return;
    this._send(session, 'Runtime.evaluate', {
      expression: `document.title = ${JSON.stringify(title)}`,
    });
  }

  async getPageScroll(profileId) {
    const session = this.sessions.get(profileId);
    if (!session) return { scrollX: 0, scrollY: 0 };

    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9);
      const timeout = setTimeout(() => resolve({ scrollX: 0, scrollY: 0 }), 2000);

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.id === id) {
            clearTimeout(timeout);
            session.ws.removeListener('message', handler);
            const val = msg.result?.result?.value;
            if (typeof val === 'string') {
              const parts = val.split(',');
              resolve({ scrollX: parseInt(parts[0]) || 0, scrollY: parseInt(parts[1]) || 0 });
            } else {
              resolve({ scrollX: 0, scrollY: 0 });
            }
          }
        } catch {}
      };
      session.ws.on('message', handler);
      this._send(session, 'Runtime.evaluate', {
        expression: 'String(window.scrollX) + "," + String(window.scrollY)',
      });
    });
  }

  disconnect(profileId) {
    const session = this.sessions.get(profileId);
    if (!session) return;
    if (session.eventHandler) {
      session.ws.removeListener('message', session.eventHandler);
    }
    this.sessions.delete(profileId);
  }

  disconnectAll() {
    for (const [id] of this.sessions) {
      this.disconnect(id);
    }
  }

  isConnected(profileId) {
    return this.sessions.has(profileId);
  }
}

const cdpManager = new CdpManager();

module.exports = { CdpManager, cdpManager };
