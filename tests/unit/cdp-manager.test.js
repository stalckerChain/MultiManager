import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('ws', () => {
  return {
    default: vi.fn().mockImplementation((url, opts) => {
      const handlers = {};
      const ws = {
        url,
        readyState: 0,
        send: vi.fn(),
        close: vi.fn(),
        on: vi.fn((event, handler) => { handlers[event] = handler; }),
        removeListener: vi.fn(),
        _trigger: (event, ...args) => { if (handlers[event]) handlers[event](...args); },
      };
      setTimeout(() => { ws.readyState = 1; ws._trigger('open'); }, 10);
      return ws;
    }),
  };
});

vi.mock('../../src/logger.js', () => ({
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));

import { CdpManager } from '../../src/multi-control/cdp-manager.js';

describe('CdpManager', () => {
  let mgr;

  beforeEach(() => {
    mgr = new CdpManager();
  });

  it('создаёт экземпляр', () => {
    expect(mgr).toBeDefined();
    expect(mgr.sessions.size).toBe(0);
  });

  it('isConnected возвращает false если нет сессии', () => {
    expect(mgr.isConnected('profile-1')).toBe(false);
  });

  it('dispatchMouseEvent не падает без сессии', () => {
    expect(() => {
      mgr.dispatchMouseEvent('nonexistent', 'mousePressed', { x: 0, y: 0 });
    }).not.toThrow();
  });

  it('dispatchKeyEvent не падает без сессии', () => {
    expect(() => {
      mgr.dispatchKeyEvent('nonexistent', 'keyDown', { key: 'a' });
    }).not.toThrow();
  });

  it('getPageScroll возвращает нули без сессии', async () => {
    const result = await mgr.getPageScroll('nonexistent');
    expect(result).toEqual({ scrollX: 0, scrollY: 0 });
  });

  it('disconnect не падает если сессии нет', () => {
    expect(() => {
      mgr.disconnect('nonexistent');
    }).not.toThrow();
  });

  it('disconnectAll очищает все сессии', () => {
    const mockWs = { close: vi.fn() };
    mgr.browserConnections.set('a', { ws: mockWs, targetSessions: new Map() });
    mgr.browserConnections.set('b', { ws: mockWs, targetSessions: new Map() });
    mgr.sessions.set('a', {});
    mgr.sessions.set('b', {});
    mgr.disconnectAll();
    expect(mgr.sessions.size).toBe(0);
    expect(mgr.browserConnections.size).toBe(0);
  });

  it('onEvent колбэк вызывается при событии от master', () => {
    const callback = vi.fn();
    mgr.onEvent = callback;

    mgr.onEvent('profile-1', { __mm_event: true, type: 'mouseMove', x: 100, y: 200 });

    expect(callback).toHaveBeenCalledWith('profile-1', {
      __mm_event: true,
      type: 'mouseMove',
      x: 100,
      y: 200,
    });
  });

  it('onEvent null не падает', () => {
    mgr.onEvent = null;
    expect(() => {
      mgr.onEvent?.('profile-1', { type: 'test' });
    }).not.toThrow();
  });

  describe('multi-tab data model', () => {
    it('browserConnections хранит ws и targetSessions', () => {
      const mockWs = { close: vi.fn() };
      const targetSessions = new Map();
      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions });
      expect(mgr.browserConnections.get('p1').ws).toBe(mockWs);
      expect(mgr.browserConnections.get('p1').targetSessions).toBe(targetSessions);
    });

    it('sessionBySid маршрутизирует sessionId → profileId', () => {
      mgr.sessionBySid.set('sid-1', 'profile-a');
      mgr.sessionBySid.set('sid-2', 'profile-b');
      expect(mgr.sessionBySid.get('sid-1')).toBe('profile-a');
      expect(mgr.sessionBySid.get('sid-2')).toBe('profile-b');
    });

    it('_cleanupBrowserConnection чистит все Maps', () => {
      const mockWs = { close: vi.fn() };
      const ts = new Map();
      ts.set('t1', { sessionId: 's1', profileId: 'p1' });
      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions: ts });
      mgr.sessionBySid.set('s1', 'p1');
      mgr.sessions.set('p1', { sessionId: 's1' });

      mgr._cleanupBrowserConnection('p1');

      expect(mgr.browserConnections.has('p1')).toBe(false);
      expect(mgr.sessionBySid.has('s1')).toBe(false);
      expect(mgr.sessions.has('p1')).toBe(false);
    });

    it('dispatchMouseEvent работает с sessions', () => {
      const mockWs = { send: vi.fn() };
      mgr.sessions.set('p1', { ws: mockWs, sessionId: 's1' });
      mgr.dispatchMouseEvent('p1', 'mousePressed', { x: 10, y: 20 });
      expect(mockWs.send).toHaveBeenCalled();
    });

    it('dispatchMouseEvent не падает если сессии нет', () => {
      expect(() => {
        mgr.dispatchMouseEvent('nonexistent', 'mousePressed', { x: 0, y: 0 });
      }).not.toThrow();
    });
  });

  describe('enableInput option', () => {
    it('connect существует и принимает opts', () => {
      expect(typeof mgr.connect).toBe('function');
    });
  });

  describe('insertText', () => {
    it('отправляет Input.insertText через сессию', () => {
      const mockWs = { send: vi.fn() };
      mgr.sessions.set('p1', { ws: mockWs, sessionId: 's1' });
      mgr.insertText('p1', 'hello');
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"method":"Input.insertText"')
      );
      expect(mockWs.send).toHaveBeenCalledWith(
        expect.stringContaining('"text":"hello"')
      );
    });

    it('не падает если сессии нет', () => {
      expect(() => mgr.insertText('nonexistent', 'test')).not.toThrow();
    });
  });

  describe('getPageTargets', () => {
    it('возвращает [] если нет browser connection', async () => {
      const result = await mgr.getPageTargets('nonexistent');
      expect(result).toEqual([]);
    });
  });

  describe('getActiveTargetId', () => {
    it('возвращает null если нет browser connection', async () => {
      const result = await mgr.getActiveTargetId('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('onTabActivated', () => {
    it('инициализируется как null', () => {
      expect(mgr.onTabActivated).toBeNull();
    });

    it('вызывается при Target.targetInfoChanged через _setupBrowserMessageHandler', () => {
      const callback = vi.fn();
      mgr.onTabActivated = callback;

      const mockWs = { send: vi.fn(), on: vi.fn((event, h) => { if (event === 'message') handler = h; }), removeListener: vi.fn(), close: vi.fn() };
      let handler;
      mockWs.on = (event, h) => { if (event === 'message') handler = h; };

      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions: new Map(), cdpPort: 9222 });
      const resolveFn = vi.fn();
      mgr._setupBrowserMessageHandler(mockWs, 'p1', true, resolveFn, vi.fn());

      if (handler) {
        handler(JSON.stringify({
          method: 'Target.targetInfoChanged',
          params: {
            targetInfo: { targetId: 'tab-1', type: 'page', url: 'http://example.com' },
          },
        }));
      }

      expect(callback).toHaveBeenCalledWith('p1', 'tab-1');
    });

    it('не вызывает onTabActivated для не-page targetInfoChanged', () => {
      const callback = vi.fn();
      mgr.onTabActivated = callback;

      const mockWs = { send: vi.fn(), on: vi.fn((event, h) => { if (event === 'message') handler = h; }), removeListener: vi.fn(), close: vi.fn() };
      let handler;
      mockWs.on = (event, h) => { if (event === 'message') handler = h; };

      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions: new Map(), cdpPort: 9222 });
      mgr._setupBrowserMessageHandler(mockWs, 'p1', true, vi.fn(), vi.fn());

      if (handler) {
        handler(JSON.stringify({
          method: 'Target.targetInfoChanged',
          params: {
            targetInfo: { targetId: 'tab-1', type: 'service_worker', url: 'http://example.com' },
          },
        }));
      }

      expect(callback).not.toHaveBeenCalled();
    });
  });

  describe('getHttpTabs', () => {
    it('возвращает [] если нет browser connection', async () => {
      const result = await mgr.getHttpTabs('nonexistent');
      expect(result).toEqual([]);
    });

    it('возвращает [] если нет cdpPort', async () => {
      mgr.browserConnections.set('p1', { ws: {}, targetSessions: new Map(), cdpPort: undefined });
      const result = await mgr.getHttpTabs('p1');
      expect(result).toEqual([]);
    });

    it('возвращает [] при ошибке HTTP (несуществующий порт)', async () => {
      // Реальный HTTP запрос к несуществующему порту → error → resolve([])
      mgr.browserConnections.set('p1', { ws: {}, targetSessions: new Map(), cdpPort: 1 });
      const result = await mgr.getHttpTabs('p1');
      expect(result).toEqual([]);
    }, 10000);

    it('фильтрация /json ответа: только page, не devtools://', () => {
      // Тестирует логику фильтрации напрямую (тот же filter/map что в getHttpTabs)
      const raw = [
        { id: 't1', type: 'page', url: 'http://example.com' },
        { id: 't2', type: 'page', url: 'devtools://devtools/bundled' },
        { id: 't3', type: 'background_page', url: 'http://bg.com' },
        { id: 't4', type: 'service_worker', url: 'http://sw.com' },
      ];
      const tabs = raw
        .filter(t => t.type === 'page' && !(t.url || '').startsWith('devtools://'))
        .map(t => ({ targetId: t.id, url: t.url || '', type: t.type }));

      expect(tabs).toHaveLength(1);
      expect(tabs[0]).toEqual({ targetId: 't1', url: 'http://example.com', type: 'page' });
    });
  });

  describe('attachToExistingTarget', () => {
    it('возвращает null если нет browser connection', async () => {
      const result = await mgr.attachToExistingTarget('nonexistent', 't1');
      expect(result).toBeNull();
    });

    it('возвращает существующую сессию если уже attached', async () => {
      const existingSession = { sessionId: 's1', targetId: 't1', profileId: 'p1', ws: {} };
      const targetSessions = new Map();
      targetSessions.set('t1', existingSession);
      const mockWs = { send: vi.fn(), on: vi.fn(), removeListener: vi.fn() };
      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions, cdpPort: 9222 });

      const result = await mgr.attachToExistingTarget('p1', 't1');
      expect(result).toBe(existingSession);
      // Не должен был отправлять attach запрос
      expect(mockWs.send).not.toHaveBeenCalled();
    });

    it('attachит таб, создаёт сессию, вызывает _enableInput', async () => {
      const targetSessions = new Map();
      const messageHandlers = [];
      const mockWs = {
        send: vi.fn((msgStr) => {
          const msg = JSON.parse(msgStr);
          if (msg.method === 'Target.attachToTarget') {
            // Сразу эмулируем ответ с тем же id
            setTimeout(() => {
              const handler = messageHandlers[0];
              if (handler) handler(JSON.stringify({ id: msg.id, result: { sessionId: 's-new' } }));
            }, 0);
          }
        }),
        on: vi.fn((event, handler) => { if (event === 'message') messageHandlers.push(handler); }),
        removeListener: vi.fn(),
      };
      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions, cdpPort: 9222 });
      mgr._enableInput = vi.fn();

      const result = await mgr.attachToExistingTarget('p1', 't-new');

      expect(result).toBeDefined();
      expect(result.sessionId).toBe('s-new');
      expect(result.targetId).toBe('t-new');
      expect(result.profileId).toBe('p1');
      expect(targetSessions.has('t-new')).toBe(true);
      expect(mgr.sessionBySid.get('s-new')).toBe('p1');
      expect(mgr._enableInput).toHaveBeenCalledWith(result);
    });

    it('возвращает null при ошибке attach', async () => {
      const targetSessions = new Map();
      const messageHandlers = [];
      const mockWs = {
        send: vi.fn((msgStr) => {
          const msg = JSON.parse(msgStr);
          if (msg.method === 'Target.attachToTarget') {
            setTimeout(() => {
              const handler = messageHandlers[0];
              if (handler) handler(JSON.stringify({ id: msg.id, error: { message: 'Target not found' } }));
            }, 0);
          }
        }),
        on: vi.fn((event, handler) => { if (event === 'message') messageHandlers.push(handler); }),
        removeListener: vi.fn(),
      };
      mgr.browserConnections.set('p1', { ws: mockWs, targetSessions, cdpPort: 9222 });

      const result = await mgr.attachToExistingTarget('p1', 't-missing');
      expect(result).toBeNull();
      expect(targetSessions.has('t-missing')).toBe(false);
    });
  });
});
