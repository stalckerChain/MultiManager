import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('ghost-cursor', () => ({
  path: vi.fn((from, to) => {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      pts.push({
        x: from.x + (to.x - from.x) * t,
        y: from.y + (to.y - from.y) * t,
        timestamp: i * 8,
      });
    }
    return pts;
  }),
}));

await import('ghost-cursor');

import { MultiController } from '../../src/multi-control/index.js';

function createMockCdp() {
  return {
    dispatchMouseEvent: vi.fn(),
    dispatchMouseEventToSession: vi.fn(),
    dispatchKeyEvent: vi.fn(),
    dispatchKeyEventToSession: vi.fn(),
    insertText: vi.fn(),
    insertTextToSession: vi.fn(),
    getPageScroll: vi.fn().mockResolvedValue({ scrollX: 0, scrollY: 0 }),
    scrollToSession: vi.fn().mockResolvedValue({ applied: true }),
    getPageScrollForSession: vi.fn().mockResolvedValue({ scrollX: 0, scrollY: 0 }),
    activateAndFocusTarget: vi.fn().mockResolvedValue(undefined),
    getPageTargets: vi.fn().mockResolvedValue([]),
    browserConnections: new Map(),
  };
}

describe('MultiController', () => {
  let controller;
  let mockCdp;

  beforeEach(() => {
    mockCdp = createMockCdp();
    controller = new MultiController(mockCdp);
  });

  function seedSlaveSession(slaveId, sessionId, targetId) {
    const tid = targetId || `${slaveId}-target`;
    const sid = sessionId || `${slaveId}-session`;
    const bc = mockCdp.browserConnections.get(slaveId) || { ws: {}, targetSessions: new Map(), cdpPort: 1 };
    bc.targetSessions.set(tid, { ws: {}, sessionId: sid, targetId: tid, profileId: slaveId });
    mockCdp.browserConnections.set(slaveId, bc);
    return sid;
  }

  describe('управление master/slave', () => {
    it('устанавливает master', () => {
      controller.setMaster('profile-1');
      const status = controller.getStatus();

      expect(status.active).toBe(true);
      expect(status.masterId).toBe('profile-1');
    });

    it('добавляет slave', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');

      const status = controller.getStatus();
      expect(status.slaveCount).toBe(2);
      expect(status.slaves).toContain('slave-1');
      expect(status.slaves).toContain('slave-2');
    });

    it('удаляет slave', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');
      controller.removeSlave('slave-1');

      const status = controller.getStatus();
      expect(status.slaveCount).toBe(1);
      expect(status.slaves).not.toContain('slave-1');
    });

    it('останавливает multi-control', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      controller.stop();

      const status = controller.getStatus();
      expect(status.active).toBe(false);
      expect(status.masterId).toBeNull();
      expect(status.slaveCount).toBe(0);
    });
  });

  describe('трансляция событий', () => {
    it('не отправляет если не активен', async () => {
      await controller.onMouseMoved({ x: 100, y: 200 });
      expect(mockCdp.dispatchMouseEvent).not.toHaveBeenCalled();
    });

    it('не отправляет если нет cdp', async () => {
      controller.cdp = null;
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      await controller.onClick({ x: 100, y: 200, button: 'left', clickCount: 1 });
      expect(mockCdp.dispatchMouseEvent).not.toHaveBeenCalled();
    });

    it('транслирует клик на slaves через CDP', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 1920, 0, 1920, 1080);
      controller.setWindowPosition('slave-2', 0, 1080, 1920, 1080);
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');

      await controller.onMousePressed({ x: 100, y: 200, button: 0, clickCount: 1 });
      await controller.onMouseReleased({ x: 100, y: 200, button: 0 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledTimes(4);
    });

    it('транслирует клавиатуру', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.onKeyDown({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await controller.onKeyUp({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

      expect(mockCdp.dispatchKeyEvent).toHaveBeenCalledTimes(2);
    });

    it('транслирует текст через insertText', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.onCharInput({ text: 'a' });

      expect(mockCdp.insertText).toHaveBeenCalledWith('slave-1', 'a');
    });

    it('не форвардит Ctrl+W/T/N в slave (browser-level сочетания)', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.onKeyDown({ key: 'w', code: 'KeyW', windowsVirtualKeyCode: 87, ctrlKey: true });
      await controller.onKeyDown({ key: 't', code: 'KeyT', windowsVirtualKeyCode: 84, ctrlKey: true });
      await controller.onKeyDown({ key: 'n', code: 'KeyN', windowsVirtualKeyCode: 78, ctrlKey: true });

      expect(mockCdp.dispatchKeyEvent).not.toHaveBeenCalled();
    });

    it('форвардит Ctrl+1 в slave ровно один раз', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.onKeyDown({ key: '1', code: 'Digit1', windowsVirtualKeyCode: 49, ctrlKey: true });

      expect(mockCdp.dispatchKeyEvent).toHaveBeenCalledTimes(1);
      expect(mockCdp.dispatchKeyEvent).toHaveBeenCalledWith('slave-1', 'keyDown', expect.objectContaining({ key: '1', ctrlKey: true }));
    });

    it('транслирует scroll как authoritative document scroll (scrollToSession, без mouseWheel)', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      await controller.scrollTo({ clientX: 0, clientY: 0, scrollX: 0, scrollY: 200 });
      await new Promise(r => setTimeout(r, 40));

      expect(mockCdp.scrollToSession).toHaveBeenCalledWith('slave-1', 's-1', 0, 200);
      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheelCalls).toHaveLength(0);
    });
  });

  describe('relative coordinates', () => {
    it('не добавляет offset окон: viewport-координаты CDP не зависят от положения окон', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 2000, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      // slaveWindow=(2000,0), masterWindow=(0,0) — offset не участвует,
      // т.к. Input.dispatchMouseEvent принимает viewport-координаты.
      await controller.onMousePressed({ x: 100, y: 200, button: 0, clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 200 })
      );
    });

    it('_toSlaveCoords не зависит от windowPositions при одинаковых page и slaveScroll', () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 1920, 0, 1920, 1080);
      controller.slaves.set('slave-1', { scroll: { scrollX: 0, scrollY: 0 } });

      expect(controller._toSlaveCoords(150, 200, 'slave-1')).toEqual({ x: 150, y: 200 });

      // Другие позиции окон (второй монитор) — результат не меняется.
      controller.setWindowPosition('master-1', 1920, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 1080, 1920, 1080);
      expect(controller._toSlaveCoords(150, 200, 'slave-1')).toEqual({ x: 150, y: 200 });
    });

    it('учитывает scroll slave при пересчёте координат', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      const slaveData = controller.slaves.get('slave-1');
      slaveData.scroll = { scrollX: 0, scrollY: 100 };

      await controller.onMousePressed({ x: 100, y: 300, button: 0, clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 200 })
      );
    });

    it('не вычитает scroll master из page-координат', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMousePressed({ x: 100, y: 300, button: 0, clickCount: 1, scrollX: 0, scrollY: 100 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 300 })
      );
    });

    it('вычитает только slave scroll при различающемся scroll master и slave', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      const slaveData = controller.slaves.get('slave-1');
      slaveData.scroll = { scrollX: 0, scrollY: 50 };

      // pageY=400 — документная координата; slaveY = 400 - 50 = 350
      await controller.onMousePressed({ x: 100, y: 400, button: 0, clickCount: 1, scrollX: 0, scrollY: 100 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 350 })
      );
    });

    it('координаты без scroll равны page (без offsets окон)', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 100, 100, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      // page=(50,50), slaveScroll=(0,0) → { x: 50, y: 50 }
      await controller.onMousePressed({ x: 50, y: 50, button: 0, clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 50, y: 50 })
      );
    });

    it('clamp к нулю при page < slaveScroll', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 100, 100, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      const slaveData = controller.slaves.get('slave-1');
      slaveData.scroll = { scrollX: 0, scrollY: 100 };

      await controller.onMousePressed({ x: 50, y: 50, button: 0, clickCount: 1 });

      const calls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[0] === 'slave-1');
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][2].x).toBeGreaterThanOrEqual(0);
      expect(calls[0][2].y).toBeGreaterThanOrEqual(0);
    });
  });

  // Регрессия: рассинхрон курсора после прокрутки колесом.
  // Раньше scroll считался накоплением дельт → slaveScroll опережал реальный
  // window.scrollY, masterScroll не вычитался из page-координат. Курсор в slave
  // «уплывал» после скролла, клики уходили мимо. Фикс: реальный scroll из событий.
  describe('регрессия: рассинхрон курсора после wheel-скролла', () => {
    it('_toSlaveCoords не вычитает masterScroll из page-координат (баг 1)', () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      controller.slaves.set('slave-1', { scroll: { scrollX: 0, scrollY: 0 } });

      // pageX/pageY — документные координаты: masterScroll уже учтён в них.
      // master прокручен на 300, slave — нет, поэтому slaveY остаётся 500.
      const coords = controller._toSlaveCoords(100, 500, 'slave-1');
      expect(coords).toEqual({ x: 100, y: 500 });
    });

    it('onMouseMoved не вычитает masterScroll из page-координат', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 100, y: 500, scrollX: 0, scrollY: 300 });
      await new Promise(r => setTimeout(r, 25));

      const smoother = controller.smoothers.get('slave-1');
      expect(smoother._target).toEqual({ x: 100, y: 500 });
    });

    it('_broadcastMouse (клик) не вычитает masterScroll из page-координат', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMousePressed({ x: 100, y: 500, button: 0, clickCount: 1, scrollX: 0, scrollY: 300 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 500 })
      );
    });

    it('scrollTo пишет реальный scroll мастера из события, а не накапливает дельты (баг 3)', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.scrollTo({ clientX: 0, clientY: 0, deltaY: 40, scrollX: 0, scrollY: 250 });

      expect(controller.masterScroll).toEqual({ scrollX: 0, scrollY: 250 });
    });

    it('scrollTo без scrollX/scrollY в событии не ломает masterScroll', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      controller.masterScroll = { scrollX: 0, scrollY: 100 };

      await controller.scrollTo({ clientX: 0, clientY: 0, deltaY: 40 });

      expect(controller.masterScroll).toEqual({ scrollX: 0, scrollY: 100 });
    });

    it('slaveScroll синхронизируется реальным window.scrollY после серии scroll-событий (баг 2)', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');
      // Реальный scroll страницы slave может отличаться от запрошенного (clamp).
      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 512 });

      await controller.scrollTo({ scrollX: 0, scrollY: 200 });
      await new Promise(r => setTimeout(r, 40));

      const slaveData = controller.slaves.get('slave-1');
      expect(slaveData.scroll).toEqual({ scrollX: 0, scrollY: 512 });
    });

    it('masterScroll имеет формат {scrollX, scrollY} в конструкторе и после stop', () => {
      expect(controller.masterScroll).toEqual({ scrollX: 0, scrollY: 0 });
      controller.setMaster('master-1');
      controller.masterScroll = { scrollX: 10, scrollY: 20 };
      controller.stop();
      expect(controller.masterScroll).toEqual({ scrollX: 0, scrollY: 0 });
    });
  });

  describe('smoother мыши', () => {
    it('onMouseMoved вызывает smoother.setTarget для каждого слейва', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 100, y: 200 });
      await new Promise(r => setTimeout(r, 25));

      const smoother = controller.smoothers.get('slave-1');
      expect(smoother).toBeDefined();
      expect(smoother._target).toEqual({ x: 100, y: 200 });
    });

      it('flush перед кликом dispatches final point', async () => {
        controller.setMaster('master-1');
        controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
        controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
        await controller.addSlave('slave-1');

        controller.onMouseMoved({ x: 100, y: 200 });
        await new Promise(r => setTimeout(r, 2));

        mockCdp.dispatchMouseEvent.mockClear();
        mockCdp.dispatchMouseEventToSession.mockClear();
        await controller.onMousePressed({ x: 100, y: 200, button: 0, clickCount: 1 });

        const allMouseMoved = [
          ...mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseMoved'),
          ...mockCdp.dispatchMouseEventToSession.mock.calls.filter(c => c[2] === 'mouseMoved'),
        ];
        const flushCall = allMouseMoved[allMouseMoved.length - 1];
        expect(flushCall).toBeDefined();
      });

    it('smoother.stop() вызывается в removeSlave', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      const smoother = controller.smoothers.get('slave-1');
      const stopSpy = vi.spyOn(smoother, 'stop');

      controller.removeSlave('slave-1');

      expect(stopSpy).toHaveBeenCalled();
      expect(controller.smoothers.has('slave-1')).toBe(false);
    });
  });

  describe('throttling входящих mousemove', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    function setupSlaves(count) {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      for (let i = 1; i <= count; i++) {
        controller.setWindowPosition(`slave-${i}`, 0, 0, 1920, 1080);
      }
    }

    it('latest-event-wins: за интервал обрабатывается только последнее событие', async () => {
      setupSlaves(1);
      await controller.addSlave('slave-1');
      const spy = vi.spyOn(controller.smoothers.get('slave-1'), 'setTarget');

      controller.onMouseMoved({ x: 10, y: 10 });
      controller.onMouseMoved({ x: 50, y: 50 });
      controller.onMouseMoved({ x: 100, y: 100 });
      expect(spy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(100, 100);
    });

    it('единый controller-level throttle: один setTarget на каждый slave за интервал', async () => {
      setupSlaves(2);
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');
      const spy1 = vi.spyOn(controller.smoothers.get('slave-1'), 'setTarget');
      const spy2 = vi.spyOn(controller.smoothers.get('slave-2'), 'setTarget');

      controller.onMouseMoved({ x: 10, y: 20 });
      controller.onMouseMoved({ x: 30, y: 40 });
      controller.onMouseMoved({ x: 50, y: 60 });
      vi.advanceTimersByTime(16);

      expect(spy1).toHaveBeenCalledTimes(1);
      expect(spy2).toHaveBeenCalledTimes(1);
      expect(spy1).toHaveBeenCalledWith(50, 60);
      expect(spy2).toHaveBeenCalledWith(50, 60);
    });

    it('не накапливает лишние setTarget при интенсивном потоке событий', async () => {
      setupSlaves(1);
      await controller.addSlave('slave-1');
      const spy = vi.spyOn(controller.smoothers.get('slave-1'), 'setTarget');

      for (let i = 0; i < 25; i++) {
        controller.onMouseMoved({ x: i, y: 0 });
      }
      expect(spy).not.toHaveBeenCalled();

      vi.advanceTimersByTime(16);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenLastCalledWith(24, 0);
    });

    it('stop() очищает pending и timer', async () => {
      setupSlaves(1);
      await controller.addSlave('slave-1');
      const spy = vi.spyOn(controller.smoothers.get('slave-1'), 'setTarget');

      controller.onMouseMoved({ x: 10, y: 10 });
      expect(controller._throttleTimer).not.toBeNull();

      controller.stop();
      expect(controller._throttleTimer).toBeNull();
      expect(controller._pendingMove).toBeNull();

      vi.advanceTimersByTime(100);
      expect(spy).not.toHaveBeenCalled();
    });
  });

  describe('адаптивные параметры smoother', () => {
    it('1–2 slave: stepInterval=8, maxPoints=60, moveSpeed=5', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      const s = controller.smoothers.get('slave-1');
      expect(s.stepInterval).toBe(8);
      expect(s._maxPoints).toBe(60);
      expect(s.moveSpeed).toBe(5);
    });

    it('3–4 slave: stepInterval=12, maxPoints=40', async () => {
      controller.setMaster('master-1');
      for (let i = 1; i <= 3; i++) await controller.addSlave(`slave-${i}`);
      for (const [, s] of controller.smoothers) {
        expect(s.stepInterval).toBe(12);
        expect(s._maxPoints).toBe(40);
      }
    });

    it('5+ slave: stepInterval=16, maxPoints=30', async () => {
      controller.setMaster('master-1');
      for (let i = 1; i <= 5; i++) await controller.addSlave(`slave-${i}`);
      for (const [, s] of controller.smoothers) {
        expect(s.stepInterval).toBe(16);
        expect(s._maxPoints).toBe(30);
      }
    });

    it('обновляет уже созданные smoother при добавлении slave', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      const s1 = controller.smoothers.get('slave-1');
      expect(s1._maxPoints).toBe(60);

      await controller.addSlave('slave-2');
      await controller.addSlave('slave-3');
      expect(s1._maxPoints).toBe(40);
      expect(controller.smoothers.get('slave-2')._maxPoints).toBe(40);
      expect(controller.smoothers.get('slave-3')._maxPoints).toBe(40);
    });

    it('обновляет уже созданные smoother при удалении slave', async () => {
      controller.setMaster('master-1');
      for (let i = 1; i <= 5; i++) await controller.addSlave(`slave-${i}`);
      const s1 = controller.smoothers.get('slave-1');
      expect(s1._maxPoints).toBe(30);

      controller.removeSlave('slave-5');
      controller.removeSlave('slave-4');
      expect(s1._maxPoints).toBe(40);

      controller.removeSlave('slave-3');
      expect(s1._maxPoints).toBe(60);
    });
  });

  describe('throttling и события', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('click/flush использует координаты клика и не задерживается pending mousemove', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      controller.onMouseMoved({ x: 10, y: 10 });
      const spy = vi.spyOn(controller.smoothers.get('slave-1'), 'setTarget');

      await controller.onMousePressed({ x: 200, y: 300, button: 0, clickCount: 1 });

      // pending mousemove отменён, клик становится целью smoother
      expect(spy).toHaveBeenCalledWith(200, 300);
      expect(controller._throttleTimer).toBeNull();
      expect(controller._pendingMove).toBeNull();

      const moved = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseMoved');
      const pressed = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mousePressed');
      expect(moved.length).toBeGreaterThan(0);
      expect(moved[moved.length - 1][2]).toEqual(expect.objectContaining({ x: 200, y: 300 }));
      expect(pressed[pressed.length - 1][2]).toEqual(expect.objectContaining({ x: 200, y: 300 }));

      // поздний pending mousemove не выполняет dispatch после клика
      vi.advanceTimersByTime(40);
      const movedAfter = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseMoved');
      expect(movedAfter.length).toBe(moved.length);
    });

    it('scroll и keyboard проходят независимо от throttling мыши', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      mockCdp.dispatchMouseEvent.mockClear();
      mockCdp.dispatchKeyEvent.mockClear();

      controller.onMouseMoved({ x: 10, y: 10 });

      await controller.onKeyDown({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await controller.scrollTo({ scrollX: 0, scrollY: 40 });

      expect(mockCdp.dispatchKeyEvent).toHaveBeenCalledTimes(1);
      // Без сессии slave authoritative scroll безопасно пропускается (нет mouseWheel).
      const wheel = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheel).toHaveLength(0);
      expect(mockCdp.scrollToSession).not.toHaveBeenCalled();
      // pending mousemove ещё не обработан (интервал не истёк)
      expect(controller.smoothers.get('slave-1')._target).toBeNull();
    });

    it('removeSlave сохраняет pending для оставшихся slave', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-2', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');
      const spy1 = vi.spyOn(controller.smoothers.get('slave-1'), 'setTarget');
      const spy2 = vi.spyOn(controller.smoothers.get('slave-2'), 'setTarget');

      controller.onMouseMoved({ x: 10, y: 20 });
      controller.removeSlave('slave-2');

      vi.advanceTimersByTime(25);
      expect(spy1).toHaveBeenCalledWith(10, 20);
      expect(spy2).not.toHaveBeenCalled();
      expect(controller._throttleTimer).toBeNull();
      expect(controller._pendingMove).toBeNull();
    });

    it('removeSlave при нуле slave полностью очищает pending и timer', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      controller.onMouseMoved({ x: 10, y: 10 });
      expect(controller._throttleTimer).not.toBeNull();

      controller.removeSlave('slave-1');
      expect(controller._throttleTimer).toBeNull();
      expect(controller._pendingMove).toBeNull();
    });

    it('циклы add/remove slave не оставляют лишних timer', async () => {
      controller.setMaster('master-1');
      for (let i = 0; i < 3; i++) await controller.addSlave(`slave-${i}`);
      controller.removeSlave('slave-0');
      controller.removeSlave('slave-1');
      controller.removeSlave('slave-2');

      expect(controller._throttleTimer).toBeNull();
      expect(controller._pendingMove).toBeNull();
      expect(controller.smoothers.size).toBe(0);
      vi.advanceTimersByTime(30);
      expect(mockCdp.dispatchMouseEvent).not.toHaveBeenCalled();
    });
  });

  describe('authoritative document scroll (без wheel-dispatch)', () => {
    it('scrollTo({scrollX, scrollY}) применяет document scroll через scrollToSession, mouseWheel не используется', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      await controller.scrollTo({ clientX: 300, clientY: 400, scrollX: 0, scrollY: 200 });

      expect(mockCdp.scrollToSession).toHaveBeenCalledWith('slave-1', 's-1', 0, 200);
      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheelCalls).toHaveLength(0);
    });

    it('document scroll не зависит от clientX/clientY: вызов scrollToSession несёт числовые scrollX/scrollY', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      // clientX/clientY отсутствуют — document scroll всё равно применяется.
      await controller.scrollTo({ scrollX: 10, scrollY: 140 });

      const calls = mockCdp.scrollToSession.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      for (const call of calls) {
        expect(typeof call[2]).toBe('number');
        expect(typeof call[3]).toBe('number');
      }
      const last = calls[calls.length - 1];
      expect(last[2]).toBe(10);
      expect(last[3]).toBe(140);
      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheelCalls).toHaveLength(0);
    });

    it('scrollTo без scrollX/scrollY (только delta) безопасно пропускается', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      await controller.scrollTo({ clientX: 0, clientY: 0, deltaY: 60 });

      expect(mockCdp.scrollToSession).not.toHaveBeenCalled();
      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheelCalls).toHaveLength(0);
    });

    it('серия быстрых scroll-событий вверх/вниз: применяется последнее абсолютное состояние без backlog', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      // Фактический scroll slave после применения (с учётом clamp).
      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 160 });

      // Быстрая серия вверх/вниз: события не дожидаются друг друга.
      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 120 });
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 90 });
      const p3 = controller.scrollTo({ scrollX: 0, scrollY: 160 });
      await Promise.all([p1, p2, p3]);

      // Последнее применённое состояние — абсолютное (0,160), без дельт.
      await vi.waitFor(() => {
        const calls = mockCdp.scrollToSession.mock.calls;
        expect(calls[calls.length - 1]).toEqual(['slave-1', 's-1', 0, 160]);
      });

      // Ждём финальный sync фактического scroll slave.
      await vi.waitFor(() => expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(160));

      // Hover после scroll учитывает фактический slave scroll.
      const coords = controller._toSlaveCoords(150, 200, 'slave-1');
      expect(coords).toEqual({ x: 150, y: 40 });

      // После прекращения scroll новых вызовов не появляется (нет backlog).
      const countAfter = mockCdp.scrollToSession.mock.calls.length;
      await new Promise(r => setTimeout(r, 60));
      const countLater = mockCdp.scrollToSession.mock.calls.length;
      expect(countLater).toBe(countAfter);
      expect(controller._scrollRunners.get('slave-1').pending).toBeNull();
    });

    it('устаревший результат sync не перезаписывает новое состояние scroll', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      // Первый sync (старой серии) будет задержан и вернёт устаревший scroll.
      let resolveOldScroll;
      mockCdp.getPageScrollForSession
        .mockImplementationOnce(() => new Promise((resolve) => { resolveOldScroll = resolve; }))
        .mockResolvedValue({ scrollX: 0, scrollY: 400 });

      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 400 });
      await p1;

      // Sync серии 1 начал чтение фактического scroll и завис.
      await vi.waitFor(() => expect(resolveOldScroll).toBeDefined());

      // Серия 2 стартует до завершения старого sync: generation увеличивается.
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 400 });
      await p2;
      await vi.waitFor(() => expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(400));

      // Старый sync завершается позже с устаревшими данными — он не должен откатить scroll.
      resolveOldScroll({ scrollX: 0, scrollY: 120 });
      await p1;
      await new Promise(r => setTimeout(r, 60));
      expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(400);
    });

    it('чтение scroll, начатое до нового scroll-события, не откатывает состояние внутри той же серии', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      let resolveFirstRead;
      mockCdp.getPageScrollForSession
        .mockImplementationOnce(() => new Promise((resolve) => { resolveFirstRead = resolve; }))
        .mockResolvedValue({ scrollX: 0, scrollY: 200 });

      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 200 });
      await p1;
      await vi.waitFor(() => expect(resolveFirstRead).toBeDefined());

      // Новое scroll-событие приходит до завершения первого чтения.
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 200 });
      await p2;
      await vi.waitFor(() => expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(200));

      // Первое чтение завершается позже с устаревшими данными — не откатывает состояние.
      resolveFirstRead({ scrollX: 0, scrollY: 60 });
      await p1;
      await new Promise(r => setTimeout(r, 60));
      expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(200);
    });

    it('клик и mousemove используют фактический slave scroll после authoritative scroll', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 120 });
      await controller.scrollTo({ scrollX: 0, scrollY: 100 });
      await new Promise(r => setTimeout(r, 40));
      expect(controller.slaves.get('slave-1').scroll).toEqual({ scrollX: 0, scrollY: 120 });

      // mousemove: pageY=400 → slaveY = 400 - 120 = 280
      await controller.onMouseMoved({ x: 100, y: 400, scrollX: 0, scrollY: 100 });
      await new Promise(r => setTimeout(r, 25));
      expect(controller.smoothers.get('slave-1')._target).toEqual({ x: 100, y: 280 });

      // click: pageY=400 → 280; с сессией slave dispatch идёт через *ToSession
      await controller.onMousePressed({ x: 100, y: 400, button: 0, clickCount: 1, scrollX: 0, scrollY: 100 });
      expect(mockCdp.dispatchMouseEventToSession).toHaveBeenCalledWith(
        'slave-1',
        's-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 280 })
      );
    });

    it('регрессия порядка: первый scroll вниз сразу применяет новое абсолютное значение', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      await controller.scrollTo({ scrollX: 0, scrollY: 100 });

      // Первый down уже несёт НОВОЕ значение (не отстаёт на один шаг).
      const calls = mockCdp.scrollToSession.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0]).toEqual(['slave-1', 's-1', 0, 100]);
    });

    it('регрессия порядка: второй scroll вниз не является первым моментом движения slave', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 100 });
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 200 });
      await Promise.all([p1, p2]);

      await vi.waitFor(() => {
        const calls = mockCdp.scrollToSession.mock.calls;
        // 100 уже было применено первым событием, финал — последнее состояние 200.
        expect(calls.some(c => c[3] === 100)).toBe(true);
        expect(calls[calls.length - 1]).toEqual(['slave-1', 's-1', 0, 200]);
      });
    });

    it('регрессия порядка: первый scroll вверх после down сразу двигает slave вверх', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 200 });
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 100 });
      await Promise.all([p1, p2]);

      await vi.waitFor(() => {
        const calls = mockCdp.scrollToSession.mock.calls;
        expect(calls.some(c => c[3] === 200)).toBe(true);
        // Первое up уже ставит slave на 100 — второй up не нужен для исправления.
        expect(calls[calls.length - 1]).toEqual(['slave-1', 's-1', 0, 100]);
      });
    });

    it('регрессия порядка: второй scroll вверх не требуется для исправления позиции', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');
      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 100 });

      // down → up. После up slave уже на 100 (фактический read тоже 100).
      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 200 });
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 100 });
      await Promise.all([p1, p2]);

      await vi.waitFor(() => {
        expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(100);
      });

      // Позиция уже корректна: дополнительных scrollToSession-вызовов не требуется.
      const countAfter = mockCdp.scrollToSession.mock.calls.length;
      await new Promise(r => setTimeout(r, 60));
      expect(mockCdp.scrollToSession.mock.calls.length).toBe(countAfter);
    });

    it('регрессия порядка: быстрые down/up/down оставляют slave на последнем абсолютном состоянии', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');
      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 150 });

      const p1 = controller.scrollTo({ scrollX: 0, scrollY: 100 });
      const p2 = controller.scrollTo({ scrollX: 0, scrollY: 50 });
      const p3 = controller.scrollTo({ scrollX: 0, scrollY: 150 });
      await Promise.all([p1, p2, p3]);

      await vi.waitFor(() => {
        const calls = mockCdp.scrollToSession.mock.calls;
        expect(calls[calls.length - 1]).toEqual(['slave-1', 's-1', 0, 150]);
      });
      await vi.waitFor(() => expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(150));
    });

    it('после применения scroll фактическое чтение идёт через getPageScrollForSession(profileId, sessionId), а не getPageScroll', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');
      mockCdp.getPageScroll.mockClear();
      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 130 });

      await controller.scrollTo({ scrollX: 0, scrollY: 100 });
      await vi.waitFor(() => expect(controller.slaves.get('slave-1').scroll.scrollY).toBe(130));

      expect(mockCdp.getPageScrollForSession).toHaveBeenCalledWith('slave-1', 's-1');
      expect(mockCdp.getPageScroll).not.toHaveBeenCalled();
    });
  });

  describe('координаты после scroll: двойное вычитание', () => {
    it('одинаковый scroll master и slave не даёт двойную поправку', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      const slaveData = controller.slaves.get('slave-1');
      slaveData.scroll = { scrollX: 0, scrollY: 300 };

      // master и slave одинаково прокручены на 300. pageY=800 — документная
      // координата; slaveY = 800 - 300 = 500 (masterScroll не вычитается).
      await controller.onMousePressed({ x: 100, y: 800, button: 0, clickCount: 1, scrollX: 0, scrollY: 300 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 500 })
      );
    });

    it('mousemove и click при разных scroll master/slave после authoritative scroll', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');

      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 120 });
      await controller.scrollTo({ scrollX: 0, scrollY: 100 });
      await new Promise(r => setTimeout(r, 40));
      expect(controller.slaves.get('slave-1').scroll).toEqual({ scrollX: 0, scrollY: 120 });

      // mousemove: pageY=400 → slaveY = 400 - 120 = 280
      await controller.onMouseMoved({ x: 100, y: 400, scrollX: 0, scrollY: 100 });
      await new Promise(r => setTimeout(r, 25));
      expect(controller.smoothers.get('slave-1')._target).toEqual({ x: 100, y: 280 });

      // click: pageY=400 → 280; с сессией slave dispatch идёт через *ToSession
      await controller.onMousePressed({ x: 100, y: 400, button: 0, clickCount: 1, scrollX: 0, scrollY: 100 });
      expect(mockCdp.dispatchMouseEventToSession).toHaveBeenCalledWith(
        'slave-1',
        's-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 280 })
      );
    });
  });

  describe('_debugStats', () => {
    it('собирает счётчики mousemove и сбрасывает при stop', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      controller.onMouseMoved({ x: 10, y: 10 });
      controller.onMouseMoved({ x: 20, y: 20 });
      await new Promise(r => setTimeout(r, 25));
      controller.onMouseMoved({ x: 30, y: 30 });
      await new Promise(r => setTimeout(r, 25));

      expect(controller._debugStats.mousemoveReceived).toBe(3);
      expect(controller._debugStats.mousemoveCoalesced).toBe(1);
      expect(controller._debugStats.mousemoveProcessed).toBe(2);

      controller.stop();
      expect(controller._debugStats.mousemoveReceived).toBe(0);
      expect(controller._debugStats.mousemoveProcessed).toBe(0);
    });

    it('учитывает dispatchCount и stalePointsSkipped через smoother', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 100, y: 100 });
      await vi.waitFor(() => expect(controller._debugStats.dispatchCount).toBeGreaterThan(0), { timeout: 1000 });

      expect(controller._debugStats.stalePointsSkipped).toBeGreaterThanOrEqual(0);
    });

    it('removeSlave не сбрасывает общую статистику controller', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-2', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');

      controller.onMouseMoved({ x: 10, y: 10 });
      await new Promise(r => setTimeout(r, 25));
      const before = controller._debugStats.mousemoveProcessed;

      controller.removeSlave('slave-1');
      expect(controller._debugStats.mousemoveProcessed).toBe(before);
    });

    it('scrollTo и sync обновляют scroll-счётчики', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      seedSlaveSession('slave-1', 's-1');
      mockCdp.getPageScrollForSession.mockResolvedValue({ scrollX: 0, scrollY: 90 });

      await controller.scrollTo({ scrollX: 0, scrollY: 60 });
      await new Promise(r => setTimeout(r, 40));

      expect(controller._debugStats.scrollEventsReceived).toBeGreaterThanOrEqual(1);
      expect(controller._debugStats.scrollSyncApplied).toBeGreaterThanOrEqual(1);
    });
  });

  describe('window position tracking', () => {
    it('сохраняет позиции окон', () => {
      controller.setWindowPosition('win-1', 100, 200, 1920, 1080);
      const pos = controller.windowPositions.get('win-1');
      expect(pos).toEqual({ x: 100, y: 200, width: 1920, height: 1080 });
    });

    it('сбрасывает при stop', () => {
      controller.setMaster('m1');
      controller.setWindowPosition('m1', 0, 0, 100, 100);
      controller.stop();
      expect(controller.windowPositions.size).toBe(0);
    });
  });

  describe('onNavigate updates activeMasterTab', () => {
    it('onNavigate вызывает setActiveMasterTab', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('tab-1');

      controller.setActiveMasterTab('tab-2');
      expect(controller.activeMasterTab).toBe('tab-2');
    });

    it('onNavigate с тем же targetId не вызывает _syncActiveTabToSlaves повторно', () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.setMaster('master-1');
      controller.mapTab('tab-1', 'slave-1', 'slave-tab-1');

      controller.setActiveMasterTab('tab-1');
      expect(controller.cdp.activateAndFocusTarget).toHaveBeenCalledTimes(1);

      controller.setActiveMasterTab('tab-1');
      expect(controller.cdp.activateAndFocusTarget).toHaveBeenCalledTimes(1);
    });
  });

  describe('tab mapping', () => {
    it('mapTab stores master→slave mapping', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-1');
      expect(controller.getSlaveTabForMaster('master-tab-1', 'slave-A')).toBe('slave-tab-1');
    });

    it('mapTab supports multiple slaves per master tab', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-1', 'slave-B', 'slave-tab-B');
      expect(controller.getSlaveTabForMaster('master-tab-1', 'slave-A')).toBe('slave-tab-A');
      expect(controller.getSlaveTabForMaster('master-tab-1', 'slave-B')).toBe('slave-tab-B');
    });

    it('getSlaveTabForMaster returns null for unknown', () => {
      expect(controller.getSlaveTabForMaster('unknown')).toBeNull();
    });

    it('getSlaveTabForMaster without slaveId returns first', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-1', 'slave-B', 'slave-tab-B');
      const first = controller.getSlaveTabForMaster('master-tab-1');
      expect(['slave-tab-A', 'slave-tab-B']).toContain(first);
    });

    it('unmapTab removes all mappings for master tab', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-1', 'slave-B', 'slave-tab-B');
      controller.unmapTab('master-tab-1');
      expect(controller.getSlaveTabForMaster('master-tab-1')).toBeNull();
    });

    it('stop clears tabMapping', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-2', 'slave-B', 'slave-tab-B');
      controller.stop();
      expect(controller.tabMapping.size).toBe(0);
      expect(controller.activeMasterTab).toBeNull();
    });

    it('setActiveMasterTab updates activeMasterTab and calls _syncActiveTabToSlaves', async () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.setMaster('master-1');
      controller.mapTab('tab-1', 'slave-1', 'slave-tab-1');
      controller.mapTab('tab-1', 'slave-2', 'slave-tab-2');

      controller.setActiveMasterTab('tab-1');
      await new Promise(resolve => setTimeout(resolve, 0));

      expect(controller.activeMasterTab).toBe('tab-1');
      expect(controller.cdp.activateAndFocusTarget).toHaveBeenCalledWith('slave-1', 'slave-tab-1');
      expect(controller.cdp.activateAndFocusTarget).toHaveBeenCalledWith('slave-2', 'slave-tab-2');
    });

    it('setActiveMasterTab does nothing when called with same tab', () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.activeMasterTab = 'tab-1';

      controller.setActiveMasterTab('tab-1');

      expect(controller.cdp.activateAndFocusTarget).not.toHaveBeenCalled();
    });

    it('_syncActiveTabToSlaves находит таб в slave по URL при отсутствии маппинга', async () => {
      controller.cdp = {
        activateAndFocusTarget: vi.fn().mockResolvedValue(undefined),
        getPageTargets: vi.fn((profileId) => {
          if (profileId === 'master-1') {
            return Promise.resolve([{ targetId: 'mt1', url: 'http://example.com/page1', type: 'page' }]);
          }
          return Promise.resolve([
            { targetId: 'st1', url: 'http://other.com', type: 'page' },
            { targetId: 'st2', url: 'http://example.com/page1', type: 'page' },
          ]);
        }),
      };
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      // Устанавливаем matching target как active и синхронизируем
      await controller._syncActiveTabToSlaves('mt1');

      // Должен найти st2 по URL и вызвать activateAndFocusTarget
      expect(controller.cdp.activateAndFocusTarget).toHaveBeenCalledWith('slave-1', 'st2');
      // Проверяем, что маппинг создан
      expect(controller.getSlaveTabForMaster('mt1', 'slave-1')).toBe('st2');
    });

    it('_syncActiveTabToSlaves использует index fallback если URL не совпадает', async () => {
      controller.cdp = {
        activateAndFocusTarget: vi.fn().mockResolvedValue(undefined),
        getPageTargets: vi.fn((profileId) => {
          if (profileId === 'master-1') {
            return Promise.resolve([
              { targetId: 'mt1', url: 'about:blank', type: 'page' },
              { targetId: 'mt2', url: 'http://example.com/page2', type: 'page' },
            ]);
          }
          return Promise.resolve([
            { targetId: 'st1', url: 'about:blank', type: 'page' },
            { targetId: 'st2', url: 'http://example.com/page2', type: 'page' },
          ]);
        }),
      };
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      controller.mapTab('mt1', 'slave-1', 'st1');
      controller.mapTab('mt2', 'slave-1', 'st2');

      // mt2 already has mapping — should use it
      await controller._syncActiveTabToSlaves('mt2');
      expect(controller.cdp.activateAndFocusTarget).toHaveBeenCalledWith('slave-1', 'st2');
    });

    it('_syncActiveTabToSlaves не падает если master target не найден', async () => {
      controller.cdp = {
        activateAndFocusTarget: vi.fn().mockResolvedValue(undefined),
        getPageTargets: vi.fn().mockResolvedValue([]),
      };
      controller.setMaster('master-1');

      await expect(controller._syncActiveTabToSlaves('nonexistent')).resolves.toBeUndefined();
      expect(controller.cdp.activateAndFocusTarget).not.toHaveBeenCalled();
    });
  });

  describe('tabIndex (ordered matrix)', () => {
    it('mapTab adds entry to tabIndex in order', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-2', 'slave-A', 'slave-tab-B');
      controller.mapTab('master-tab-3', 'slave-A', 'slave-tab-C');

      expect(controller.tabIndex).toEqual(['master-tab-1', 'master-tab-2', 'master-tab-3']);
    });

    it('mapTab reuses existing tabIndex entry for same master tab', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-1', 'slave-B', 'slave-tab-B');

      expect(controller.tabIndex).toEqual(['master-tab-1']);
    });

    it('unmapTab removes from tabIndex', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-2', 'slave-A', 'slave-tab-B');
      controller.unmapTab('master-tab-1');

      expect(controller.tabIndex).toEqual(['master-tab-2']);
    });

    it('unmapTab with slaveId removes from tabIndex when last slave', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-1', 'slave-B', 'slave-tab-B');
      controller.unmapTab('master-tab-1', 'slave-A');

      expect(controller.tabIndex).toEqual(['master-tab-1']);

      controller.unmapTab('master-tab-1', 'slave-B');

      expect(controller.tabIndex).toEqual([]);
    });

    it('stop clears tabIndex', () => {
      controller.mapTab('master-tab-1', 'slave-A', 'slave-tab-A');
      controller.mapTab('master-tab-2', 'slave-A', 'slave-tab-B');
      controller.stop();

      expect(controller.tabIndex).toEqual([]);
    });

    it('getTabIndex returns correct index', () => {
      controller.mapTab('tab-A', 's1', 'st1');
      controller.mapTab('tab-B', 's1', 'st2');
      controller.mapTab('tab-C', 's1', 'st3');

      expect(controller.getTabIndex('tab-A')).toBe(0);
      expect(controller.getTabIndex('tab-B')).toBe(1);
      expect(controller.getTabIndex('tab-C')).toBe(2);
      expect(controller.getTabIndex('unknown')).toBe(-1);
    });

    it('getActiveTabIndex returns index of active tab', () => {
      controller.mapTab('tab-A', 's1', 'st1');
      controller.mapTab('tab-B', 's1', 'st2');

      controller.setActiveMasterTab('tab-A');
      expect(controller.getActiveTabIndex()).toBe(0);

      controller.setActiveMasterTab('tab-B');
      expect(controller.getActiveTabIndex()).toBe(1);
    });

    it('getActiveTabIndex returns -1 when no active tab', () => {
      expect(controller.getActiveTabIndex()).toBe(-1);
    });
  });

  describe('tab focus on destroy', () => {
    it('_maybeSwitchToPrevTab switches to previous tab in tabIndex', () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.setMaster('master-1');
      controller.mapTab('tab-1', 'slave-1', 'st1');
      controller.mapTab('tab-2', 'slave-1', 'st2');
      controller.mapTab('tab-3', 'slave-1', 'st3');

      controller.setActiveMasterTab('tab-3');
      controller._maybeSwitchToPrevTab('tab-3');

      expect(controller.activeMasterTab).toBe('tab-2');
    });

    it('_maybeSwitchToPrevTab does nothing if destroyed tab not active', () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.setMaster('master-1');
      controller.mapTab('tab-1', 'slave-1', 'st1');
      controller.setActiveMasterTab('tab-1');

      controller._maybeSwitchToPrevTab('tab-2');

      expect(controller.activeMasterTab).toBe('tab-1');
    });

    it('_maybeSwitchToPrevTab switches to first tab when destroying first active tab', () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.setMaster('master-1');
      controller.mapTab('tab-1', 'slave-1', 'st1');
      controller.mapTab('tab-2', 'slave-1', 'st2');

      controller.setActiveMasterTab('tab-1');
      controller.unmapTab('tab-1');
      controller._maybeSwitchToPrevTab('tab-1');

      expect(controller.activeMasterTab).toBe('tab-2');
    });

    it('_unmapBySlaveTargetId calls _maybeSwitchToPrevTab', () => {
      controller.cdp = { activateAndFocusTarget: vi.fn().mockResolvedValue(undefined), getPageTargets: vi.fn().mockResolvedValue([]) };
      controller.setMaster('master-1');
      controller.mapTab('tab-1', 'slave-1', 'st1');
      controller.mapTab('tab-2', 'slave-1', 'st2');
      controller.setActiveMasterTab('tab-2');

      controller._unmapBySlaveTargetId('st2');
      expect(controller.activeMasterTab).toBe('tab-1');
    });
  });

  describe('_enforceSlaveFocusOnActiveTab', () => {
    it('вызывает activateAndFocusTarget для правильного slave таба', async () => {
      const bc = { targetSessions: new Map() };
      bc.targetSessions.set('active-slave-tab', { sessionId: 's1' });
      mockCdp.browserConnections.set('slave-1', bc);
      controller.setMaster('master-1');
      controller.mapTab('active-tab', 'slave-1', 'active-slave-tab');
      controller.setActiveMasterTab('active-tab');
      mockCdp.activateAndFocusTarget.mockClear();

      await controller._enforceSlaveFocusOnActiveTab('slave-1');

      expect(mockCdp.activateAndFocusTarget).toHaveBeenCalledWith('slave-1', 'active-slave-tab');
    });

    it('не вызывает activateAndFocusTarget если нет activeMasterTab', async () => {
      controller.setMaster('master-1');
      controller.mapTab('some-tab', 'slave-1', 'some-slave-tab');

      await controller._enforceSlaveFocusOnActiveTab('slave-1');

      expect(mockCdp.activateAndFocusTarget).not.toHaveBeenCalled();
    });

    it('не вызывает activateAndFocusTarget если нет маппинга для activeMasterTab', async () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('unknown-tab');

      await controller._enforceSlaveFocusOnActiveTab('slave-1');

      expect(mockCdp.activateAndFocusTarget).not.toHaveBeenCalled();
    });

    it('не падает если нет cdp', async () => {
      controller.cdp = null;
      controller.setMaster('master-1');
      controller.mapTab('active-tab', 'slave-1', 'active-slave-tab');
      controller.setActiveMasterTab('active-tab');

      await expect(controller._enforceSlaveFocusOnActiveTab('slave-1')).resolves.toBeUndefined();
    });

    it('не вызывает activateAndFocusTarget если targetId нет в targetSessions слейва', async () => {
      const bc = { targetSessions: new Map() };
      bc.targetSessions.set('other-tab', { sessionId: 's1' });
      mockCdp.browserConnections.set('slave-1', bc);
      controller.setMaster('master-1');
      controller.mapTab('active-tab', 'slave-1', 'active-slave-tab');
      controller.setActiveMasterTab('active-tab');
      // setActiveMasterTab → _syncActiveTabToSlaves вызывает activateAndFocusTarget — сбрасываем spy,
      // чтобы проверить именно поведение _enforceSlaveFocusOnActiveTab
      mockCdp.activateAndFocusTarget.mockClear();

      await controller._enforceSlaveFocusOnActiveTab('slave-1');

      expect(mockCdp.activateAndFocusTarget).not.toHaveBeenCalled();
    });

    it('логирует ошибку если activateAndFocusTarget падает', async () => {
      const bc = { targetSessions: new Map() };
      bc.targetSessions.set('active-slave-tab', { sessionId: 's1' });
      mockCdp.browserConnections.set('slave-1', bc);
      mockCdp.activateAndFocusTarget = vi.fn().mockRejectedValue(new Error('CDP down'));
      controller.setMaster('master-1');
      controller.mapTab('active-tab', 'slave-1', 'active-slave-tab');
      controller.setActiveMasterTab('active-tab');

      await expect(controller._enforceSlaveFocusOnActiveTab('slave-1')).resolves.toBeUndefined();
      expect(mockCdp.activateAndFocusTarget).toHaveBeenCalledWith('slave-1', 'active-slave-tab');
    });
  });
});
