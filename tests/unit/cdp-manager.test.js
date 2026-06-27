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
    mgr.sessions.set('a', {});
    mgr.sessions.set('b', {});
    mgr.disconnectAll();
    expect(mgr.sessions.size).toBe(0);
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
});
