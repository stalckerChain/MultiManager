import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiController } from '../../src/multi-control/index.js';

describe('MultiController', () => {
  let controller;

  beforeEach(() => {
    controller = new MultiController();
  });

  describe('управление master/slave', () => {
    it('устанавливает master', () => {
      controller.setMaster('profile-1', null);
      const status = controller.getStatus();

      expect(status.active).toBe(true);
      expect(status.masterId).toBe('profile-1');
    });

    it('добавляет slave', () => {
      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', null);
      controller.addSlave('slave-2', null);

      const status = controller.getStatus();
      expect(status.slaveCount).toBe(2);
      expect(status.slaves).toContain('slave-1');
      expect(status.slaves).toContain('slave-2');
    });

    it('удаляет slave', () => {
      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', null);
      controller.addSlave('slave-2', null);
      controller.removeSlave('slave-1');

      const status = controller.getStatus();
      expect(status.slaveCount).toBe(1);
      expect(status.slaves).not.toContain('slave-1');
    });

    it('останавливает multi-control', () => {
      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', null);
      controller.stop();

      const status = controller.getStatus();
      expect(status.active).toBe(false);
      expect(status.masterId).toBeNull();
      expect(status.slaveCount).toBe(0);
    });
  });

  describe('трансляция событий', () => {
    it('не отправляет если не активен', async () => {
      const mockSession = { send: vi.fn() };
      controller.addSlave('slave-1', mockSession);

      await controller.onMouseMoved({ x: 100, y: 200 });

      expect(mockSession.send).not.toHaveBeenCalled();
    });

    it('транслирует клик на slave', async () => {
      const mockSession1 = { send: vi.fn() };
      const mockSession2 = { send: vi.fn() };

      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', mockSession1);
      controller.addSlave('slave-2', mockSession2);

      await controller.onClick({ x: 100, y: 200, button: 'left', clickCount: 1 });

      expect(mockSession1.send).toHaveBeenCalledTimes(2);
      expect(mockSession2.send).toHaveBeenCalledTimes(2);
    });

    it('транслирует клавиатуру', async () => {
      const mockSession = { send: vi.fn() };

      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', mockSession);

      await controller.onKeyDown({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
      await controller.onKeyUp({ key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });

      expect(mockSession.send).toHaveBeenCalledTimes(2);
    });

    it('транслирует scroll', async () => {
      const mockSession = { send: vi.fn() };

      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', mockSession);

      await controller.scrollTo({ deltaY: -100 });

      expect(mockSession.send).toHaveBeenCalledWith('Input.dispatchMouseEvent', {
        type: 'mouseWheel',
        x: 0,
        y: 0,
        deltaX: 0,
        deltaY: -100,
      });
    });
  });

  describe('throttling мыши', () => {
    it('буферизует движение мыши', async () => {
      const mockSession = { send: vi.fn() };

      controller.setMaster('master-1', null);
      controller.addSlave('slave-1', mockSession);

      await controller.onMouseMoved({ x: 10, y: 10 });
      await controller.onMouseMoved({ x: 20, y: 20 });
      await controller.onMouseMoved({ x: 30, y: 30 });

      expect(mockSession.send).not.toHaveBeenCalled();

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(mockSession.send).toHaveBeenCalledTimes(1);
      expect(mockSession.send).toHaveBeenCalledWith('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: 30,
        y: 30,
      });
    });
  });

  describe('обработка ошибок', () => {
    it('не падает при ошибке отправки', async () => {
      const badSession = { send: vi.fn().mockRejectedValue(new Error('disconnect')) };
      const goodSession = { send: vi.fn() };

      controller.setMaster('master-1', null);
      controller.addSlave('bad', badSession);
      controller.addSlave('good', goodSession);

      await controller.onClick({ x: 0, y: 0, button: 'left', clickCount: 1 });

      expect(goodSession.send).toHaveBeenCalledTimes(2);
    });
  });
});
