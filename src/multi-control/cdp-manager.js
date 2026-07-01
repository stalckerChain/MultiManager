const WebSocket = require('ws');
const http = require('http');
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
    // Блокируем браузерные шорткаты, которые обрабатываются мульти-контролем
    if (e.ctrlKey && (e.key === 't' || e.key === 'T' || e.key === 'n' || e.key === 'N' || e.key === 'w' || e.key === 'W')) {
      e.preventDefault();
    }
  }, true);
  document.addEventListener('keyup', function(e) { emit('keyUp', { key: e.key, code: e.code, windowsVirtualKeyCode: e.keyCode }); }, true);
  document.addEventListener('click', function(e) {
    emit('click', { x: e.pageX, y: e.pageY, button: e.button, clickCount: e.detail || 1 });
  }, true);
  document.addEventListener('visibilitychange', function() { if (!document.hidden) { emit('tabActivated', {}); } });
})();
`;

class CdpManager {
  constructor() {
    this.sessions = new Map();
    this.onEvent = null;
    this.onNavigate = null;
    this.onNewTab = null;
    this.onTabDestroyed = null;
    this.onTabActivated = null;

    this.browserConnections = new Map();
    this.sessionBySid = new Map();
    this.targetBySid = new Map();
  }

  async _discoverWsUrl(cdpPort) {
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
          cdpPort,
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

          if (!firstSessionResolved) {
            firstSessionResolved = true;
            resolve(newSession);
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

        if (msg.method === 'Target.targetInfoChanged') {
          const { targetInfo } = msg.params;
          if (targetInfo.type === 'page' && this.onTabActivated) {
            this.onTabActivated(profileId, targetInfo.targetId);
          }
        }

        if (msg.method === 'Target.targetCreated') {
          const { targetInfo } = msg.params;
          if (targetInfo.type !== 'page') return;
          const bc = this.browserConnections.get(profileId);
          if (!bc) return;
          if (bc.targetSessions.has(targetInfo.targetId)) return;

          logger.info({
            profileId,
            targetId: targetInfo.targetId,
            url: targetInfo.url,
          }, 'CDP: TARGET CREATED — auto-attaching');

          this._attachToTarget(ws, profileId, targetInfo.targetId, enableInput, (session) => {
            if (this.onNewTab) {
              this.onNewTab(profileId, targetInfo, session);
            }
          });
          return;
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

          const bc = this.browserConnections.get(profileId);

          if (this.sessionBySid.has(sessionId)) {
            logger.info({ targetId, sessionId }, 'CDP: attachToTarget skipped — already attached via auto-attach');
            return;
          }

          const session = { ws, sessionId, targetId, profileId };

          this.sessionBySid.set(sessionId, profileId);
          this.targetBySid.set(sessionId, targetId);
          this.sessions.set(profileId, session);

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
    if (!session) {
      logger.warn({ profileId, type }, 'CDP: dispatchMouseEvent — no session');
      return;
    }
    const cdpParams = { type, ...params };
    if (type === 'mousePressed' || type === 'mouseReleased') {
      if (!cdpParams.clickCount || cdpParams.clickCount < 1) cdpParams.clickCount = 1;
    }
    logger.info({ profileId, type, x: params.x, y: params.y, button: params.button, clickCount: cdpParams.clickCount }, 'CDP: dispatchMouseEvent (fallback)');
    this._send(session, 'Input.dispatchMouseEvent', cdpParams);
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
    if (!bc) {
      logger.warn({ profileId }, 'CDP: dispatchMouseEventToSession — no browser connection');
      return;
    }
    const session = bc.targetSessions.values().find(s => s.sessionId === sessionId);
    if (!session) {
      logger.warn({ profileId, sessionId, type }, 'CDP: dispatchMouseEventToSession — session not found');
      return;
    }
    const cdpParams = { type, ...params };
    if (type === 'mousePressed' || type === 'mouseReleased') {
      if (!cdpParams.clickCount || cdpParams.clickCount < 1) cdpParams.clickCount = 1;
    }
    logger.info({ profileId, sessionId: session.sessionId, type, x: params.x, y: params.y, button: params.button, clickCount: cdpParams.clickCount }, 'CDP: Input.dispatchMouseEvent');
    this._send(session, 'Input.dispatchMouseEvent', cdpParams);
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

  async getPageTargets(profileId) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) return [];

    return new Promise((resolve) => {
      const id = Math.floor(Math.random() * 1e9);
      const timeout = setTimeout(() => resolve([]), 3000);

      bc.ws.send(JSON.stringify({ id, method: 'Target.getTargets' }));

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.id === id) {
            clearTimeout(timeout);
            bc.ws.removeListener('message', handler);
            const targets = (msg.result?.targetInfos || []).filter(
              t => t.type === 'page' && !t.url.startsWith('devtools://')
            );
            resolve(targets);
          }
        } catch {}
      };
      bc.ws.on('message', handler);
    });
  }

  async getActiveTargetId(profileId) {
    const targets = await this.getPageTargets(profileId);
    if (targets.length === 0) return null;

    const bc = this.browserConnections.get(profileId);
    if (!bc) return targets[0].targetId;

    for (const t of targets) {
      if (bc.targetSessions.has(t.targetId)) {
        return t.targetId;
      }
    }
    return targets[0].targetId;
  }

  /**
   * Список табов через HTTP DevTools endpoint GET /json.
   *
   * В отличие от getPageTargets (через WS Target.getTargets), этот путь НЕ зависит
   * от CDP-подписок и надёжно возвращает ВСЕ табы браузера, включая нативно открытые
   * (_blank, адресная строка). Антидетект-браузер не шлёт Target.targetCreated для
   * таких табов через WS, поэтому единственный надёжный источник — HTTP /json.
   *
   * @returns {Promise<Array<{targetId: string, url: string, type: string}>>}
   */
  async getHttpTabs(profileId) {
    const bc = this.browserConnections.get(profileId);
    const cdpPort = bc?.cdpPort;
    if (!cdpPort) return [];

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
              .map(t => ({ targetId: t.id, url: t.url || '', type: t.type }));
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

  /**
   * Подключение (attach) к уже существующему табу, который был открыт нативно
   * (_blank, адресная строка) или через createTab. Антидетект не шлёт
   * Target.attachedToTarget, поэтому attach нужно вызвать вручную, иначе таб не
   * попадёт в targetSessions и ввод (dispatchKeyEvent/insertText) на нём невозможен.
   *
   * @returns {Promise<object|null>} сессия или null при ошибке
   */
  async attachToExistingTarget(profileId, targetId) {
    const bc = this.browserConnections.get(profileId);
    if (!bc) {
      logger.warn({ profileId, targetId }, 'CDP: attachToExistingTarget — no browser connection');
      return null;
    }
    if (bc.targetSessions.has(targetId)) {
      return bc.targetSessions.get(targetId);
    }

    return new Promise((resolve) => {
      const attachId = Math.floor(Math.random() * 1e9);
      const timeout = setTimeout(() => {
        bc.ws.removeListener('message', handler);
        logger.warn({ profileId, targetId }, 'CDP: attachToExistingTarget timed out');
        resolve(null);
      }, 5000);

      bc.ws.send(JSON.stringify({
        id: attachId,
        method: 'Target.attachToTarget',
        params: { targetId, flatten: true },
      }));

      const handler = (raw) => {
        try {
          const msg = JSON.parse(raw);
          if (msg.id === attachId) {
            clearTimeout(timeout);
            bc.ws.removeListener('message', handler);
            if (msg.error) {
              logger.error({ profileId, targetId, error: msg.error.message }, 'CDP: attachToExistingTarget failed');
              resolve(null);
              return;
            }
            const sessionId = msg.result.sessionId;
            if (!sessionId || this.sessionBySid.has(sessionId)) {
              logger.info({ targetId, sessionId }, 'CDP: attachToExistingTarget — session exists, skipping');
              resolve(bc.targetSessions.get(targetId) || null);
              return;
            }
            const session = { ws: bc.ws, sessionId, targetId, profileId };
            this.sessionBySid.set(sessionId, profileId);
            this.targetBySid.set(sessionId, targetId);
            bc.targetSessions.set(targetId, session);
            this._enableInput(session);
            logger.info({ profileId, targetId, sessionId }, 'CDP: attachToExistingTarget attached');
            resolve(session);
          }
        } catch {}
      };
      bc.ws.on('message', handler);
    });
  }
}

const cdpManager = new CdpManager();

module.exports = { CdpManager, cdpManager };
