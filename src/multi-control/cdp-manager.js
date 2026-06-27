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

  async connect(profileId, cdpPort) {
    if (this.sessions.has(profileId)) {
      this.disconnect(profileId);
    }

    const url = `ws://127.0.0.1:${cdpPort}/devtools/browser`;

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(url, { handshakeTimeout: 5000 });
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
          const session = { ws: browserWs, sessionId, targetId };
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

    const runtimeId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: runtimeId,
      method: 'Runtime.evaluate',
      sessionId: session.sessionId,
      params: {
        expression: `(${EVENT_INJECTION_SCRIPT})`,
      },
    }));

    session.eventHandler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.method === 'Runtime.consoleAPICalled' && msg.sessionId === session.sessionId) {
          const args = msg.params.args;
          if (args && args.length > 0 && args[0].type === 'string') {
            try {
              const event = JSON.parse(args[0].value);
              if (event.__mm_event && this.onEvent) {
                this.onEvent(profileId, event);
              }
            } catch {}
          }
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
