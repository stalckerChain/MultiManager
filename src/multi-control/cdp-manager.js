const WebSocket = require('ws');
const { logger } = require('../logger');

const SYNC_EVENT_SCRIPT = `
(function() {
  if (window.__MM_SYNC_ACTIVE__) return;
  window.__MM_SYNC_ACTIVE__ = true;

  var HAS_BINDING = typeof window['__MM_SYNC_BIND__'] === 'function';

  function SEND(data) {
    if (typeof window['__MM_SYNC_BIND__'] === 'function') {
      window['__MM_SYNC_BIND__'](data);
    } else {
      console.log(data);
    }
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
  document.addEventListener('keydown', function(e) {
    emit('keyDown', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode });
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      emit('charInput', { text: e.key });
    }
  }, true);
  document.addEventListener('keyup', function(e) { emit('keyUp', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode }); }, true);
  document.addEventListener('click', function(e) { emit('click', { x: e.pageX, y: e.pageY, button: e.button, clickCount: e.detail || 1 }); }, true);
})();
`;

class CdpManager {
  constructor() {
    this.sessions = new Map();
    this.onEvent = null;
    this.onNavigate = null;
    this.onNewTab = null;
    this.onTabDestroyed = null;

    this.browserConnections = new Map();
    this.sessionBySid = new Map();
    this.targetBySid = new Map();
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

  async connect(profileId, cdpPort, opts = {}) {
    if (this.sessions.has(profileId)) {
      this.disconnect(profileId);
    }

    const { enableInput = true } = opts;
    const wsUrl = await this._discoverWsUrl(cdpPort);

    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl, { handshakeTimeout: 5000 });
      let connected = false;

      ws.on('open', () => {
        connected = true;

        this.browserConnections.set(profileId, {
          ws,
          targetSessions: new Map(),
        });

        this._setupBrowserMessageHandler(ws, profileId, enableInput, resolve, reject);
      });

      ws.on('error', (err) => {
        if (!connected) {
          reject(err);
        }
      });

      ws.on('close', () => {
        this._cleanupBrowserConnection(profileId);
      });

      setTimeout(() => {
        if (!connected) {
          ws.close();
          reject(new Error('CDP connection timeout'));
        }
      }, 5000);
    });
  }

  _setupBrowserMessageHandler(ws, profileId, enableInput, resolve, reject) {
    const getTargetsId = Math.floor(Math.random() * 1e9);
    let firstSessionResolved = false;

    ws.send(JSON.stringify({
      id: getTargetsId,
      method: 'Target.getTargets',
    }));

    ws.send(JSON.stringify({
      method: 'Target.setAutoAttach',
      params: { autoAttach: true, flatten: true, waitForDebuggerOnStart: false },
    }));

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);

        if (msg.id === getTargetsId && msg.result) {
          const pages = (msg.result.targetInfos || []).filter(
            t => t.type === 'page' && !t.url.startsWith('devtools://')
          );

          if (pages.length === 0) {
            ws.removeListener('message', handler);
            ws.close();
            reject(new Error('No page targets found'));
            return;
          }

          this._attachToTarget(ws, profileId, pages[0].targetId, enableInput, (session) => {
            firstSessionResolved = true;
            resolve(session);
          });
        }

        if (msg.method === 'Target.attachedToTarget') {
          const { sessionId: newSid, targetInfo } = msg.params;
          if (targetInfo.type !== 'page') return;
          if (this.sessionBySid.has(newSid)) return;

          logger.info({
            profileId,
            targetId: targetInfo.targetId,
            url: targetInfo.url,
            sessionId: newSid,
          }, 'CDP: AUTO-ATTACHED to new target');

          const newSession = {
            ws,
            sessionId: newSid,
            targetId: targetInfo.targetId,
            profileId,
          };

          this.sessionBySid.set(newSid, profileId);
          this.targetBySid.set(newSid, targetInfo.targetId);
          const bc = this.browserConnections.get(profileId);
          if (bc) bc.targetSessions.set(targetInfo.targetId, newSession);

          if (!this.sessions.has(profileId)) {
            this.sessions.set(profileId, newSession);
          }

          if (enableInput) {
            this._enableInput(newSession);
          }

          if (this.onNewTab) {
            this.onNewTab(profileId, targetInfo, newSession);
          }
        }

        if (msg.method === 'Target.targetDestroyed') {
          const { targetId } = msg.params;
          const bc = this.browserConnections.get(profileId);
          if (bc) {
            const deadSession = bc.targetSessions.get(targetId);
            if (deadSession) {
              this.sessionBySid.delete(deadSession.sessionId);
              this.targetBySid.delete(deadSession.sessionId);
              bc.targetSessions.delete(targetId);
              logger.info({ profileId, targetId }, 'CDP: target destroyed, cleaned up');

              if (this.sessions.get(profileId)?.targetId === targetId) {
                const remaining = bc.targetSessions.values().next().value;
                if (remaining) {
                  this.sessions.set(profileId, remaining);
                  logger.info({ profileId, newTargetId: remaining.targetId }, 'CDP: updated default session to surviving target');
                } else {
                  this.sessions.delete(profileId);
                }
              }

              if (this.onTabDestroyed) {
                this.onTabDestroyed(profileId, targetId);
              }
            }
          }
        }

        if (msg.method === 'Page.frameNavigated' && msg.params?.frame && !msg.params.frame.parentId) {
          const navSid = msg.sessionId;
          const navProfileId = this.sessionBySid.get(navSid);
          const navUrl = msg.params.frame.url;
          if (navProfileId && enableInput) {
            logger.info({ profileId: navProfileId, frameId: msg.params.frame.id, url: navUrl }, 'CDP: frame navigated, re-adding binding');
            const bc = this.browserConnections.get(navProfileId);
            if (bc) {
              for (const [, s] of bc.targetSessions) {
                if (s.sessionId === navSid) {
                  this._reAddBinding(s);
                  break;
                }
              }
            }
            if (this.onNavigate) {
              this.onNavigate(navProfileId, navUrl, navSid);
            }
          }
        }

        if (msg.method === 'Runtime.bindingCalled') {
          const eventProfileId = this.sessionBySid.get(msg.sessionId);
          if (eventProfileId && this.onEvent) {
            const bp = msg.params?.payload ?? msg.payload;
            if (bp) {
              try {
                const event = JSON.parse(bp);
                if (event.__mm_event) {
                  this.onEvent(eventProfileId, event, msg.sessionId);
                }
              } catch {}
            }
          }
        }

        if (msg.method === 'Runtime.consoleAPICalled') {
          const consoleProfileId = this.sessionBySid.get(msg.sessionId);
          if (consoleProfileId && this.onEvent) {
            const args = msg.params?.args;
            if (args && args.length > 0 && args[0].type === 'string') {
              try {
                const event = JSON.parse(args[0].value);
                if (event.__mm_event) {
                  this.onEvent(consoleProfileId, event);
                }
              } catch {}
            }
          }
        }

        if (!firstSessionResolved) return;

        if (msg.method === 'Runtime.exceptionThrown') {
          const excProfileId = this.sessionBySid.get(msg.sessionId);
          if (excProfileId) {
            logger.error({ profileId: excProfileId, details: msg.params?.exceptionDetails?.text }, 'CDP: exception in page');
          }
        }
      } catch {}
    };

    ws.on('message', handler);
  }

  _attachToTarget(ws, profileId, targetId, enableInput, callback) {
    const attachId = Math.floor(Math.random() * 1e9);
    ws.send(JSON.stringify({
      id: attachId,
      method: 'Target.attachToTarget',
      params: { targetId, flatten: true },
    }));

    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw);
        if (msg.id === attachId) {
          ws.removeListener('message', handler);
          if (msg.error) {
            logger.error({ profileId, targetId, error: msg.error.message }, 'CDP: attachToTarget failed');
            return;
          }
          const sessionId = msg.result.sessionId;
          const session = { ws, sessionId, targetId, profileId };

          this.sessionBySid.set(sessionId, profileId);
          this.targetBySid.set(sessionId, targetId);
          this.sessions.set(profileId, session);

          const bc = this.browserConnections.get(profileId);
          if (bc) bc.targetSessions.set(targetId, session);

          if (enableInput) {
            this._enableInput(session);
          }

          callback(session);
        }
      } catch {}
    };
    ws.on('message', handler);
  }

  _enableInput(session) {
    this._send(session, 'Runtime.enable', {});
    this._send(session, 'Page.enable', {});

    const bindingId = `__MM_SYNC_BIND__`;
    logger.info({
      profileId: session.profileId,
      bindingId,
      sessionId: session.sessionId,
      targetId: session.targetId,
    }, 'CDP: ENABLE INPUT — starting setup');

    this._addBinding(session, bindingId);
    this._injectSyncScript(session, bindingId);
    this._testBinding(session, bindingId);
  }

  _addBinding(session, bindingId) {
    const addBindingId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: addBindingId,
      method: 'Runtime.addBinding',
      sessionId: session.sessionId,
      params: { name: bindingId },
    }));
  }

  _injectSyncScript(session, bindingId) {
    const script = SYNC_EVENT_SCRIPT.replace(/__MM_SYNC_BIND__/g, bindingId);

    const addScriptId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: addScriptId,
      method: 'Page.addScriptToEvaluateOnNewDocument',
      sessionId: session.sessionId,
      params: { source: script },
    }));

    const evalId = Math.floor(Math.random() * 1e9);
    session.ws.send(JSON.stringify({
      id: evalId,
      method: 'Runtime.evaluate',
      sessionId: session.sessionId,
      params: { expression: script },
    }));
  }

  _testBinding(session, bindingId) {
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
  }

  _reAddBinding(session) {
    const bindingId = `__MM_SYNC_BIND__`;
    this._addBinding(session, bindingId);
    this._injectSyncScript(session, bindingId);
    this._testBinding(session, bindingId);
    logger.info({ profileId: session.profileId, sessionId: session.sessionId }, 'CDP: re-added binding after navigation');
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

  insertText(profileId, text) {
    const session = this.sessions.get(profileId);
    if (!session) return;
    this._send(session, 'Input.insertText', { text });
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

  navigateTo(profileId, url) {
    const session = this.sessions.get(profileId);
    if (!session) return;
    logger.info({ profileId, url }, 'CDP: navigating');
    this._send(session, 'Page.navigate', { url });
  }

  async createTab(profileId, url) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) {
      logger.error({ profileId }, 'CDP: createTab failed — no browser connection');
      return null;
    }

    logger.info({ profileId, url }, 'CDP: createTab called');

    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9);
      const timeout = setTimeout(() => {
        logger.warn({ profileId, id }, 'CDP: createTarget timed out');
        bc.ws.removeListener('message', handler);
        resolve(null);
      }, 5000);

      const params = { url: url || 'about:blank' };
      bc.ws.send(JSON.stringify({ id, method: 'Target.createTarget', params }));

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.id === id) {
            clearTimeout(timeout);
            bc.ws.removeListener('message', handler);
            if (msg.error) {
              logger.error({ profileId, error: msg.error.message }, 'CDP: createTarget failed');
              resolve(null);
              return;
            }
            const targetId = msg.result.targetId;
            logger.info({ profileId, targetId, url }, 'CDP: created new tab');
            resolve(targetId);
          }
        } catch {}
      };
      bc.ws.on('message', handler);
    });
  }

  navigateToSession(profileId, sessionId, url) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) return;
    const session = bc.targetSessions.values().find(s => s.sessionId === sessionId);
    if (!session) return;
    logger.info({ profileId, sessionId, url }, 'CDP: navigating session');
    this._send(session, 'Page.navigate', { url });
  }

  dispatchMouseEventToSession(profileId, sessionId, type, params) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) return;
    const session = bc.targetSessions.values().find(s => s.sessionId === sessionId);
    if (!session) return;
    this._send(session, 'Input.dispatchMouseEvent', { type, ...params });
  }

  dispatchKeyEventToSession(profileId, sessionId, type, params) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) return;
    const session = bc.targetSessions.values().find(s => s.sessionId === sessionId);
    if (!session) return;
    this._send(session, 'Input.dispatchKeyEvent', { type, ...params });
  }

  insertTextToSession(profileId, sessionId, text) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) return;
    const session = bc.targetSessions.values().find(s => s.sessionId === sessionId);
    if (!session) return;
    this._send(session, 'Input.insertText', { text });
  }

  _cleanupBrowserConnection(profileId) {
    const bc = this.browserConnections.get(profileId);
    if (bc) {
      for (const [targetId, session] of bc.targetSessions) {
        this.sessionBySid.delete(session.sessionId);
        this.targetBySid.delete(session.sessionId);
      }
      bc.targetSessions.clear();
      this.browserConnections.delete(profileId);
    }
    this.sessions.delete(profileId);
  }

  disconnect(profileId) {
    const bc = this.browserConnections.get(profileId);
    if (bc) {
      bc.ws.close();
    }
    this._cleanupBrowserConnection(profileId);
  }

  disconnectAll() {
    for (const [id] of this.browserConnections) {
      this.disconnect(id);
    }
  }

  isConnected(profileId) {
    return this.sessions.has(profileId);
  }

  activateTarget(profileId, targetId) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) return;
    const id = Math.floor(Math.random() * 1e9);
    bc.ws.send(JSON.stringify({
      id,
      method: 'Target.activateTarget',
      params: { targetId },
    }));
    logger.info({ profileId, targetId }, 'CDP: activateTarget');
  }
}

const cdpManager = new CdpManager();

module.exports = { CdpManager, cdpManager };
