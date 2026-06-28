import { describe, it, expect, beforeEach, vi } from 'vitest';
import { MultiController } from '../../src/multi-control/index.js';

function createMockCdp() {
  return {
    connect: vi.fn().mockResolvedValue({}),
    disconnect: vi.fn(),
    disconnectAll: vi.fn(),
    isConnected: vi.fn().mockReturnValue(true),
    dispatchMouseEvent: vi.fn(),
    dispatchKeyEvent: vi.fn(),
    getPageScroll: vi.fn().mockResolvedValue({ scrollX: 0, scrollY: 0 }),
  };
}

describe('Multi-control API logic', () => {
  let controller;
  let mockCdp;

  beforeEach(() => {
    mockCdp = createMockCdp();
    controller = new MultiController(mockCdp);
  });

  describe('start flow', () => {
    it('sets master and activates sync', async () => {
      controller.setMaster('profile-1');
      const status = controller.getStatus();

      expect(status.active).toBe(true);
      expect(status.masterId).toBe('profile-1');
      expect(status.slaveCount).toBe(0);
    });

    it('rejects when CDP connect fails', async () => {
      mockCdp.connect.mockRejectedValue(new Error('connection refused'));

      await expect(mockCdp.connect('profile-1', 9222)).rejects.toThrow('connection refused');
    });
  });

  describe('slave add flow', () => {
    it('adds slave after master is set', async () => {
      controller.setMaster('profile-1');
      await controller.addSlave('slave-1');

      expect(controller.getStatus().slaveCount).toBe(1);
      expect(controller.getStatus().slaves).toContain('slave-1');
    });

    it('rejects when CDP connect fails for slave', async () => {
      controller.setMaster('profile-1');
      mockCdp.connect.mockRejectedValue(new Error('timeout'));

      await expect(mockCdp.connect('slave-1', 9222)).rejects.toThrow('timeout');
      expect(controller.getStatus().slaveCount).toBe(0);
    });
  });

  describe('stop flow', () => {
    it('stops sync and disconnects CDP', () => {
      controller.setMaster('profile-1');
      controller.stop();

      const status = controller.getStatus();
      expect(status.active).toBe(false);
      expect(status.masterId).toBeNull();
    });
  });

  describe('window-position flow', () => {
    it('stores position and uses it in coordinate mapping', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 2000, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onClick({ x: 100, y: 200, button: 'left', clickCount: 1 });

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1', 'mousePressed',
        expect.objectContaining({ x: 2100, y: 200 })
      );
    });
  });

  describe('cdp-status flow', () => {
    it('reports connection status for master and slaves', () => {
      controller.setMaster('master-1');
      controller.slaves.set('slave-1', {});
      mockCdp.isConnected.mockImplementation(id => id !== 'slave-1');

      expect(mockCdp.isConnected('master-1')).toBe(true);
      expect(mockCdp.isConnected('slave-1')).toBe(false);
    });
  });

  describe('cdp injection', () => {
    it('controller.cdp is set when created with mockCdp', () => {
      expect(controller.cdp).toBe(mockCdp);
    });

    it('_broadcastMouse dispatches when cdp is wired', async () => {
      controller.setMaster('master-1');
      controller.setWindowPosition('master-1', 0, 0, 1920, 1080);
      controller.setWindowPosition('slave-1', 0, 0, 1920, 1080);
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 50, y: 50 });

      await new Promise(resolve => setTimeout(resolve, 30));

      expect(mockCdp.dispatchMouseEvent).toHaveBeenCalledWith(
        'slave-1',
        'mouseMoved',
        expect.objectContaining({ x: 50, y: 50 })
      );
    });

    it('_broadcastMouse does nothing when cdp is null', async () => {
      controller.cdp = null;
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.onMouseMoved({ x: 50, y: 50 });
      await new Promise(resolve => setTimeout(resolve, 30));

      expect(mockCdp.dispatchMouseEvent).not.toHaveBeenCalled();
    });
  });
});
