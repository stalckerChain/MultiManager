import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiController } from '../../src/multi-control/index.js';

function createMockCdp() {
  return {
    dispatchMouseEvent: vi.fn(),
    dispatchKeyEvent: vi.fn(),
    insertText: vi.fn(),
    getPageScroll: vi.fn().mockResolvedValue({ scrollX: 0, scrollY: 0 }),
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

      await controller.onClick({ x: 100, y: 200, button: 'left', clickCount: 1 });

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

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith('slave-1', 'mouseWheel', {
        x: 0,
        y: 0,
        deltaX: 0,
        deltaY: -100,
      });
    });
  });

  describe('relative coordinates', () => {
    it('пересчитывает координаты master→slave со смещением окон', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 2000, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onClick({ x: 100, y: 200, button: 'left', clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 2100, y: 200 })
      );
    });

    it('учитывает scroll master при пересчёте', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');
      controller.masterScroll = { scrollX: 0, scrollY: 100 };

      await controller.onClick({ x: 100, y: 300, button: 'left', clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mousePressed',
        expect.objectContaining({ x: 100, y: 200 })
      );
    });

    it('координаты не уходят в минус', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 100, 100, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onClick({ x: 50, y: 50, button: 'left', clickCount: 1 });

      const calls = mockCdp.dispatchMouseEvent.mock.calls.filter(c => c[0] === 'slave-1');
      expect(calls.length).toBeGreaterThan(0);
      expect(calls[0][2].x).toBeGreaterThanOrEqual(0);
      expect(calls[0][2].y).toBeGreaterThanOrEqual(0);
    });
  });

  describe('throttling мыши', () => {
    it('буферизует движение мыши', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 10, y: 10 });
      await controller.onMouseMoved({ x: 20, y: 20 });
      await controller.onMouseMoved({ x: 30, y: 30 });

      expect(mockCdp.dispatchMouseEvent).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledTimes(1);
      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mouseMoved',
        expect.objectContaining({ x: 30, y: 30 })
      );
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
  });
});
