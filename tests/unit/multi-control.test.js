import { describe, it, expect, beforeEach, vi } from 'vitest';

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

    it('транслирует scroll', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.scrollTo({ deltaY: -100 });
      await new Promise(r => setTimeout(r, 80));

      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      const totalDelta = wheelCalls.reduce((sum, c) => sum + c[2].deltaY, 0);
      expect(totalDelta).toBeCloseTo(-100, 0);
    });
  });

  describe('relative coordinates', () => {
    it('пересчитывает координаты master→slave со смещением окон', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 2000, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMousePressed({ x: 100, y: 200, button: 0, clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 2100, y: 200 })
      );
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

    it('учитывает scroll master при пересчёте координат', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMousePressed({ x: 100, y: 300, button: 0, clickCount: 1, scrollX: 0, scrollY: 100 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 200 })
      );
    });

    it('учитывает scroll master и slave одновременно', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      const slaveData = controller.slaves.get('slave-1');
      slaveData.scroll = { scrollX: 0, scrollY: 50 };

      // masterViewportY = 400 - 100 = 300; slaveY = 300 - 50 = 250
      await controller.onMousePressed({ x: 100, y: 400, button: 0, clickCount: 1, scrollX: 0, scrollY: 100 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 250 })
      );
    });

    it('координаты не уходят в минус', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 100, 100, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

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
    it('_toSlaveCoords вычитает masterScroll из page-координат (баг 1)', () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      controller.slaves.set('slave-1', { scroll: { scrollX: 0, scrollY: 0 } });

      // master прокручен на 300, slave — нет. page y=500 → viewport y=200.
      const coords = controller._toSlaveCoords(100, 500, 'slave-1', 0, 300);
      expect(coords).toEqual({ x: 100, y: 200 });
    });

    it('onMouseMoved пробрасывает реальный masterScroll в целевую точку', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 100, y: 500, scrollX: 0, scrollY: 300 });

      const smoother = controller.smoothers.get('slave-1');
      expect(smoother._target).toEqual({ x: 100, y: 200 });
    });

    it('_broadcastMouse (клик) использует реальный masterScroll — клик после скролла не уходит мимо', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMousePressed({ x: 100, y: 500, button: 0, clickCount: 1, scrollX: 0, scrollY: 300 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 200 })
      );
    });

    it('scrollTo пишет реальный scroll мастера из события, а не накапливает дельты (баг 3)', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.scrollTo({ deltaY: 40, scrollX: 0, scrollY: 250 });

      expect(controller.masterScroll).toEqual({ scrollX: 0, scrollY: 250 });
    });

    it('scrollTo без scrollX/scrollY в событии не ломает masterScroll', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      controller.masterScroll = { scrollX: 0, scrollY: 100 };

      await controller.scrollTo({ deltaY: 40 });

      expect(controller.masterScroll).toEqual({ scrollX: 0, scrollY: 100 });
    });

    it('slaveScroll синхронизируется реальным window.scrollY после серии wheel (баг 2)', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      // Реальный scroll страницы slave отличается от суммы отправленных дельт.
      mockCdp.getPageScroll.mockResolvedValue({ scrollX: 0, scrollY: 512 });

      await controller.scrollTo({ deltaY: 200, scrollX: 0, scrollY: 200 });
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

  describe('scroll разбивается на шаги', () => {
    it('scrollTo({deltaY: 200}) dispatches multiple mouseWheel calls', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.scrollTo({ deltaY: 200 });

      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheelCalls.length).toBeGreaterThanOrEqual(2);
      const totalDelta = wheelCalls.reduce((sum, c) => sum + Math.abs(c[2].deltaY), 0);
      expect(totalDelta).toBeCloseTo(200, 0);
    });

    it('scrollTo({deltaY: 30}) — single step', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.scrollTo({ deltaY: 30 });

      const wheelCalls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[1] === 'mouseWheel');
      expect(wheelCalls).toHaveLength(1);
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
