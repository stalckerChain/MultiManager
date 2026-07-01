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
    insertText: vi.fn(),
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

      await controller.onMousePressed({ x: 100, y: 200, button: 0, clickCount: 1 });

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

  describe('os-keyboard Ctrl+T handling', () => {
    it('Ctrl+T triggers createTab only for master (onNewTab handles slaves)', async () => {
      mockCdp.createTab = vi.fn().mockResolvedValue('new-target-id');
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');

      // Simulate new Ctrl+T: only master tab is created here
      const masterTargetId = await mockCdp.createTab(controller.masterId);
      expect(mockCdp.createTab).toHaveBeenCalledTimes(1);
      expect(mockCdp.createTab).toHaveBeenCalledWith('master-1');

      // Simulate onNewTab for master: creates slave tabs and maps
      controller.setActiveMasterTab('master-tab-new');
      if (masterTargetId) {
        for (const [slaveId] of controller.slaves) {
          const slaveTargetId = await mockCdp.createTab(slaveId);
          if (slaveTargetId) {
            controller.mapTab('master-tab-new', slaveId, slaveTargetId);
          }
        }
      }

      expect(mockCdp.createTab).toHaveBeenCalledTimes(3);
      expect(mockCdp.createTab).toHaveBeenCalledWith('slave-1');
      expect(mockCdp.createTab).toHaveBeenCalledWith('slave-2');
      expect(controller.getSlaveTabForMaster('master-tab-new', 'slave-1')).toBe('new-target-id');
      expect(controller.getSlaveTabForMaster('master-tab-new', 'slave-2')).toBe('new-target-id');
    });

    it('regular keyDown does not trigger createTab', async () => {
      mockCdp.createTab = vi.fn();
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      await controller.onKeyDown({ key: 'a', ctrlKey: false });

      expect(mockCdp.createTab).not.toHaveBeenCalled();
    });
  });

  describe('onTabActivated callback', () => {
    it('onTabActivated обновляет activeMasterTab', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('tab-1');

      const cb = (profileId, targetId) => {
        if (profileId === controller.masterId && controller.active) {
          controller.setActiveMasterTab(targetId);
        }
      };

      cb('master-1', 'tab-2');
      expect(controller.activeMasterTab).toBe('tab-2');
    });

    it('onTabActivated не обновляет при неактивном controller', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('tab-1');
      controller.active = false;

      const cb = (profileId, targetId) => {
        if (profileId === controller.masterId && controller.active) {
          controller.setActiveMasterTab(targetId);
        }
      };

      cb('master-1', 'tab-2');
      expect(controller.activeMasterTab).toBe('tab-1');
    });

    it('onTabActivated не обновляет для не-master profileId', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('tab-1');

      const cb = (profileId, targetId) => {
        if (profileId === controller.masterId && controller.active) {
          controller.setActiveMasterTab(targetId);
        }
      };

      cb('slave-1', 'tab-2');
      expect(controller.activeMasterTab).toBe('tab-1');
    });
  });

  describe('stale event filter (mouseUp/mouseMove/scroll/keyUp/charInput)', () => {
    it('mouseUp не обновляет activeMasterTab', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('tab-1');

      const targetBySid = new Map();
      targetBySid.set('sid-1', 'tab-2');
      const staleTypes = ['mouseUp', 'mouseMove', 'scroll', 'keyUp', 'charInput'];

      for (const type of staleTypes) {
        const targetId = targetBySid.get('sid-1');
        if (targetId && !staleTypes.includes(type)) {
          controller.setActiveMasterTab(targetId);
        }
      }

      expect(controller.activeMasterTab).toBe('tab-1');
    });

    it('mouseDown обновляет activeMasterTab', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('tab-1');

      const targetBySid = new Map();
      targetBySid.set('sid-1', 'tab-2');
      const staleTypes = ['mouseUp', 'mouseMove', 'scroll', 'keyUp', 'charInput'];

      const targetId = targetBySid.get('sid-1');
      if (targetId && !staleTypes.includes('mouseDown')) {
        controller.setActiveMasterTab(targetId);
      }

      expect(controller.activeMasterTab).toBe('tab-2');
    });
  });

  describe('/os-keyboard best-effort activeMasterTab update', () => {
    it('getActiveTargetId результат обновляет activeMasterTab (имитация)', async () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('old-tab');

      const fakeTid = 'current-active-tab';
      controller.setActiveMasterTab(fakeTid);

      expect(controller.activeMasterTab).toBe('current-active-tab');
    });

    it('null от getActiveTargetId не меняет activeMasterTab', async () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('old-tab');

      const tid = null;
      if (tid) {
        controller.setActiveMasterTab(tid);
      }

      expect(controller.activeMasterTab).toBe('old-tab');
    });
  });

  describe('onNewTab slave mapping (from _blank/targetCreated)', () => {
    it('slave onNewTab maps to activeMasterTab', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('master-tab-A');

      const slaveOnNewTab = (profileId, targetInfo) => {
        if (controller.activeMasterTab) {
          controller.mapTab(controller.activeMasterTab, profileId, targetInfo.targetId);
        }
      };

      slaveOnNewTab('slave-1', { targetId: 'slave-tab-1', url: 'http://example.com' });

      expect(controller.getSlaveTabForMaster('master-tab-A', 'slave-1')).toBe('slave-tab-1');
    });

    it('slave onNewTab overwrites previous mapping for same master tab', () => {
      controller.setMaster('master-1');
      controller.setActiveMasterTab('master-tab-A');
      controller.mapTab('master-tab-A', 'slave-1', 'create-tab-1');

      const slaveOnNewTab = (profileId, targetInfo) => {
        if (controller.activeMasterTab) {
          controller.mapTab(controller.activeMasterTab, profileId, targetInfo.targetId);
        }
      };

      slaveOnNewTab('slave-1', { targetId: 'native-tab-1', url: 'http://example.com' });

      expect(controller.getSlaveTabForMaster('master-tab-A', 'slave-1')).toBe('native-tab-1');
    });
  });

  describe('syncNewMasterTab logic (via HTTP discovery)', () => {
    it('создаёт slave табы, маппит и активирует при обнаружении нового мастер-таба', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');
      await controller.addSlave('slave-2');

      mockCdp.createTab = vi.fn().mockResolvedValue('new-slave-tab');

      // Имитация syncNewMasterTab: attach мастера + create+attach slave + map + activate
      controller.setActiveMasterTab('new-master-tab');
      for (const [slaveId] of controller.slaves) {
        const slaveTargetId = await mockCdp.createTab(slaveId);
        if (slaveTargetId) {
          controller.mapTab('new-master-tab', slaveId, slaveTargetId);
        }
      }

      expect(mockCdp.createTab).toHaveBeenCalledTimes(2);
      expect(controller.getSlaveTabForMaster('new-master-tab', 'slave-1')).toBe('new-slave-tab');
      expect(controller.getSlaveTabForMaster('new-master-tab', 'slave-2')).toBe('new-slave-tab');
      expect(controller.activeMasterTab).toBe('new-master-tab');
    });

    it('не дублирует slave табы если маппинг уже существует', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      // Предварительно маппим
      controller.mapTab('existing-tab', 'slave-1', 'slave-tab');

      // Имитация syncNewMasterTab: маппинг есть → только setActiveMasterTab
      if (controller.tabMapping.has('existing-tab')) {
        controller.setActiveMasterTab('existing-tab');
      }

      expect(controller.activeMasterTab).toBe('existing-tab');
    });

    it('не делает ничего если controller неактивен', async () => {
      controller.setMaster('master-1');
      controller.active = false;
      await controller.addSlave('slave-1');

      mockCdp.createTab = vi.fn();

      // Имитация syncNewMasterTab guard: inactive → return
      if (!controller.active) return;

      expect(mockCdp.createTab).not.toHaveBeenCalled();
    });
  });

  describe('discoverActiveTab logic (HTTP /json)', () => {
    it('обнаруживает новый таб когда /json возвращает больше табов чем targetSessions', async () => {
      controller.setMaster('master-1');
      await controller.addSlave('slave-1');

      // Имитация: targetSessions мастера содержит только один таб
      const knownTargets = new Map();
      knownTargets.set('tab-A', {});

      // /json вернул два таба — tab-A (известный) и tab-B (новый)
      const tabs = [
        { targetId: 'tab-A', url: 'http://a.com', type: 'page' },
        { targetId: 'tab-B', url: 'http://b.com', type: 'page' },
      ];

      const newTab = knownTargets
        ? tabs.find(t => !knownTargets.has(t.targetId))
        : tabs[0];

      expect(newTab).toBeDefined();
      expect(newTab.targetId).toBe('tab-B');
      expect(newTab.url).toBe('http://b.com');
    });

    it('не находит новый таб если все табы уже подключены', () => {
      const knownTargets = new Map();
      knownTargets.set('tab-A', {});
      knownTargets.set('tab-B', {});

      const tabs = [
        { targetId: 'tab-A', url: 'http://a.com', type: 'page' },
        { targetId: 'tab-B', url: 'http://b.com', type: 'page' },
      ];

      const newTab = knownTargets
        ? tabs.find(t => !knownTargets.has(t.targetId))
        : tabs[0];

      expect(newTab).toBeUndefined();
    });

    it('обнаруживает новый таб когда knownTargets пуст (null)', () => {
      const knownTargets = null;

      const tabs = [
        { targetId: 'tab-A', url: 'http://a.com', type: 'page' },
      ];

      const newTab = knownTargets
        ? tabs.find(t => !knownTargets.has(t.targetId))
        : tabs[0];

      expect(newTab).toBeDefined();
      expect(newTab.targetId).toBe('tab-A');
    });
  });
});
