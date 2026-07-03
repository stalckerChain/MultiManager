import { describe, it, expect, vi, beforeEach } from 'vitest';

// ============================================================
// Копии зависимостей — минимум моков, чтобы тестировать изолированно
// ============================================================

/** Микромок для CdpManager — ровно то, что использует multi-control */
class MockCdpManager {
  constructor() {
    this.tabs = [];
    this.createCalls = 0;
    this.destroyCalls = [];
    this.activateCalls = [];
    this.navigateCalls = [];
    this.browserConnections = new Map();
    this.browserConnections.set('slave-1', { ws: {}, targetSessions: new Map(), cdpPort: 9222 });
    this.browserConnections.set('slave-2', { ws: {}, targetSessions: new Map(), cdpPort: 9224 });
  }

  getHttpTabs(masterId) {
    this.getHttpTabs.lastMasterId = masterId;
    return Promise.resolve(this.getHttpTabs.result || []);
  }

  createTab(profileId, url) {
    this.createCalls++;
    this.createCallsLog = this.createCallsLog || [];
    const tabId = 'tab-' + this.createCalls + '-' + Date.now();
    this.createCallsLog.push({ profileId, url, tabId });
    return Promise.resolve(tabId);
  }

  destroyTab(profileId, tabId) {
    this.destroyCalls.push({ profileId, tabId });
    return Promise.resolve();
  }

  activateTab(profileId, tabId) {
    this.activateCalls.push({ profileId, tabId });
    return Promise.resolve();
  }

  activateTarget(profileId, targetId) {
    this.activateCalls.push({ profileId, tabId: targetId });
  }

  activateAndFocusTarget(profileId, targetId) {
    this.activateCalls.push({ profileId, tabId: targetId });
    return Promise.resolve();
  }

  navigateTab(profileId, tabId, url) {
    this.navigateCalls.push({ profileId, tabId, url });
    return Promise.resolve();
  }

  getSlaveTabForMaster(masterTabId, profileId) {
    return this.masterTabMap?.get(`${masterTabId}:${profileId}`);
  }

  setSlaveTabForMaster(masterTabId, profileId, slaveTabId) {
    if (!this.masterTabMap) this.masterTabMap = new Map();
    this.masterTabMap.set(`${masterTabId}:${profileId}`, slaveTabId);
  }

  removeSlaveForMaster(masterTabId, profileId) {
    if (!this.masterTabMap) return;
    this.masterTabMap.delete(`${masterTabId}:${profileId}`);
  }

  async _enforceSlaveFocusOnActiveTab(slaveId) {
    if (!this.activeMasterTab) return;
    const slaveTargetId = this.getSlaveTabForMaster(this.activeMasterTab, slaveId);
    if (!slaveTargetId) return;
    const bc = this.browserConnections.get(slaveId);
    if (!bc || !bc.targetSessions.has(slaveTargetId)) return;
    await this.activateAndFocusTarget(slaveId, slaveTargetId);
  }

  // onEvent не мокаем — тесты напрямую вызывают callback
}

// ============================================================
// ТЕСТЫ: syncNewMasterTab (точная копия функции из api/multi-control)
// ============================================================
describe('syncNewMasterTab (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;

  // syncNewMasterTab — копия из src/api/multi-control.js (с форсированной реактивацией activeMasterTab)
  async function syncNewMasterTab(targetId, url) {
    const profiles = ctrl.getProfiles();
    const slaves = profiles.filter(p => p !== ctrl.masterId);
    for (const slaveId of slaves) {
      const existing = ctrl.getSlaveTabForMaster(targetId, slaveId);
      if (existing) continue;
      const slaveTabId = await mockCdp.createTab(slaveId, url);
      ctrl.setSlaveTabForMaster(targetId, slaveId, slaveTabId);
      if (targetId !== ctrl.activeMasterTab) {
        await ctrl._enforceSlaveFocusOnActiveTab(slaveId);
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.getProfiles = () => ['master-1', 'slave-1', 'slave-2'];
  });

  it('creates tabs for all slaves', async () => {
    await syncNewMasterTab('tab-m1', 'http://example.com');
    expect(mockCdp.createCallsLog).toHaveLength(2);
    expect(mockCdp.createCallsLog[0].profileId).toBe('slave-1');
    expect(mockCdp.createCallsLog[0].url).toBe('http://example.com');
    expect(mockCdp.createCallsLog[1].profileId).toBe('slave-2');
    expect(mockCdp.createCallsLog[1].url).toBe('http://example.com');
  });

  it('skips existing mapped tabs', async () => {
    ctrl.setSlaveTabForMaster('tab-m1', 'slave-1', 'existing-tab');
    await syncNewMasterTab('tab-m1', 'http://example.com');
    expect(mockCdp.createCallsLog).toHaveLength(1);
    expect(mockCdp.createCallsLog[0].profileId).toBe('slave-2');
  });

  it('skips master profile', async () => {
    await syncNewMasterTab('tab-m1', 'http://example.com');
    const profiles = ctrl.getProfiles();
    for (const call of mockCdp.createCallsLog) {
      expect(call.profileId).not.toBe(ctrl.masterId);
    }
  });

  it('does not activate when activeMasterTab is not set', async () => {
    await syncNewMasterTab('tab-m1', 'http://example.com');
    expect(mockCdp.activateCalls).toHaveLength(0);
  });

  it('reactivates activeMasterTab in slaves when new tab is background (middle-click)', async () => {
    ctrl.setSlaveTabForMaster('current-tab', 'slave-1', 'slave-current-tab');
    ctrl.setSlaveTabForMaster('current-tab', 'slave-2', 'slave-current-tab-2');
    ctrl.activeMasterTab = 'current-tab';
    const bc1 = ctrl.browserConnections.get('slave-1');
    if (bc1) bc1.targetSessions.set('slave-current-tab', { sessionId: 's1' });
    const bc2 = ctrl.browserConnections.get('slave-2');
    if (bc2) bc2.targetSessions.set('slave-current-tab-2', { sessionId: 's2' });
    await syncNewMasterTab('background-tab', 'http://bg.com');
    // Должен реактивировать current-tab в обоих слейвах
    expect(mockCdp.activateCalls).toHaveLength(2);
    expect(mockCdp.activateCalls[0]).toEqual({ profileId: 'slave-1', tabId: 'slave-current-tab' });
    expect(mockCdp.activateCalls[1]).toEqual({ profileId: 'slave-2', tabId: 'slave-current-tab-2' });
  });

  it('does not reactivate when new tab IS the active master tab', async () => {
    ctrl.setSlaveTabForMaster('current-tab', 'slave-1', 'slave-tab');
    ctrl.activeMasterTab = 'current-tab';
    await syncNewMasterTab('current-tab', 'http://current.com');
    // activateCalls[0] мог быть вызван, но только если требуется реактивация
    // Для current-tab: targetId === activeMasterTab → force-reactivation не срабатывает
    expect(mockCdp.activateCalls).toHaveLength(0);
  });

  it('handles multiple tabs sequentially', async () => {
    await syncNewMasterTab('tab-m1', 'http://first.com');
    await syncNewMasterTab('tab-m2', 'http://second.com');
    expect(mockCdp.createCallsLog).toHaveLength(4);
    expect(mockCdp.createCallsLog[0].url).toBe('http://first.com');
    expect(mockCdp.createCallsLog[2].url).toBe('http://second.com');
  });

  it('does not update activeMasterTab (deferred to tabActivated)', async () => {
    ctrl.activeMasterTab = 'previous-tab';
    await syncNewMasterTab('tab-m1', 'http://example.com');
    expect(ctrl.activeMasterTab).toBe('previous-tab');
  });

  it('works with single slave profile', async () => {
    ctrl.getProfiles = () => ['master-1', 'slave-1'];
    await syncNewMasterTab('tab-m1', 'http://single.com');
    expect(mockCdp.createCallsLog).toHaveLength(1);
    expect(mockCdp.createCallsLog[0].profileId).toBe('slave-1');
  });

  it('works with no slave profiles (standalone)', async () => {
    ctrl.getProfiles = () => ['master-1'];
    await syncNewMasterTab('tab-m1', 'http://standalone.com');
    expect(mockCdp.createCallsLog).toBeUndefined();
  });
});

// ============================================================
// ТЕСТЫ: discoverActiveTab (точная копия из api/multi-control)
// ============================================================
describe('discoverActiveTab logic (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;
  let discovering;

  // discoverActiveTab — точная копия из src/api/multi-control.js строки 55-95
  async function discoverActiveTab() {
    if (!ctrl.active || !ctrl.masterId || discovering) return;
    discovering = true;
    try {
      const tabs = await mockCdp.getHttpTabs(ctrl.masterId);
      if (tabs.length === 0) return;
      const knownTargets = new Set();
      const profiles = ctrl.getProfiles();
      for (const profile of profiles) {
        if (profile === ctrl.masterId) continue;
        const masterTabs = ctrl.masterTabMap;
        if (masterTabs) {
          for (const [key] of masterTabs) {
            const [mtId] = key.split(':');
            knownTargets.add(mtId);
          }
        }
      }
      // Ищем вкладку, которая ещё не маппится
      const knownCount = knownTargets.size;
      let newTab = null;
      for (const tab of tabs) {
        if (!knownTargets.has(tab.targetId) && tab.type === 'page') {
          newTab = tab;
          break;
        }
      }
      if (!newTab) return null;
      // Создаём слейв-вкладки
      const profiles2 = ctrl.getProfiles();
      for (const slaveId of profiles2) {
        if (slaveId === ctrl.masterId) continue;
        const existing = ctrl.getSlaveTabForMaster(newTab.targetId, slaveId);
        if (existing) continue;
        const slaveTabId = await mockCdp.createTab(slaveId, newTab.url);
        ctrl.setSlaveTabForMaster(newTab.targetId, slaveId, slaveTabId);
      }
      return newTab;
    } catch {
      return null;
    } finally {
      discovering = false;
    }
  }

  // Вспомогательная функция для теста full flow (без активации)
  async function runSyncNewMasterTabForDiscover(targetId, url) {
    const profiles = ctrl.getProfiles();
    for (const slaveId of profiles) {
      if (slaveId === ctrl.masterId) continue;
      const existing = ctrl.getSlaveTabForMaster(targetId, slaveId);
      if (existing) continue;
      const slaveTabId = await mockCdp.createTab(slaveId, url);
      ctrl.setSlaveTabForMaster(targetId, slaveId, slaveTabId);
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.getProfiles = () => ['master-1', 'slave-1', 'slave-2'];
    ctrl.masterTabMap = new Map();
    discovering = false;
    mockCdp.getHttpTabs.result = [];
    mockCdp.getHttpTabs.lastMasterId = undefined;
    mockCdp.createCalls = 0;
    mockCdp.createCallsLog = undefined;
    mockCdp.activateCalls = [];
  });

  it('returns null when no new tabs found', async () => {
    mockCdp.getHttpTabs.result = [
      { targetId: 'known-1', url: 'http://known.com', type: 'page' },
    ];
    ctrl.setSlaveTabForMaster('known-1', 'slave-1', 'existing-tab');
    const result = await discoverActiveTab();
    expect(result).toBeNull();
  });

  it('returns new tab when discovered', async () => {
    mockCdp.getHttpTabs.result = [
      { targetId: 'new-tab', url: 'http://new.com', type: 'page' },
    ];
    const result = await discoverActiveTab();
    expect(result).toBeDefined();
    expect(result.targetId).toBe('new-tab');
    expect(result.url).toBe('http://new.com');
  });

  it('creates slave tabs for new discovery', async () => {
    mockCdp.getHttpTabs.result = [
      { targetId: 'new-tab', url: 'http://new.com', type: 'page' },
    ];
    await discoverActiveTab();
    expect(mockCdp.createCallsLog).toHaveLength(2);
    expect(mockCdp.createCallsLog[0].profileId).toBe('slave-1');
    expect(mockCdp.createCallsLog[0].url).toBe('http://new.com');
    expect(mockCdp.createCallsLog[1].profileId).toBe('slave-2');
    expect(mockCdp.createCallsLog[1].url).toBe('http://new.com');
  });

  it('does not update activeMasterTab after discovery (activation waits for tabActivated)', async () => {
    ctrl.activeMasterTab = 'current-tab';
    mockCdp.getHttpTabs.result = [
      { targetId: 'new-tab', url: 'http://new.com', type: 'page' },
    ];
    await discoverActiveTab();
    expect(ctrl.activeMasterTab).toBe('current-tab');
  });

  it('returns null when only non-page tabs exist', async () => {
    mockCdp.getHttpTabs.result = [
      { targetId: 'iframe-1', url: 'about:blank', type: 'iframe' },
    ];
    const result = await discoverActiveTab();
    expect(result).toBeNull();
  });

  it('does nothing when disabled', async () => {
    ctrl.active = false;
    const result = await discoverActiveTab();
    expect(result).toBeUndefined();
  });

  it('does nothing with empty tabs', async () => {
    mockCdp.getHttpTabs.result = [];
    const result = await discoverActiveTab();
    expect(result).toBeUndefined();
  });

  it('handles HTTP error', async () => {
    const orig = mockCdp.getHttpTabs;
    mockCdp.getHttpTabs = () => Promise.reject(new Error('Connection refused'));
    const result = await discoverActiveTab();
    expect(result).toBeNull();
    expect(discovering).toBe(false);
    mockCdp.getHttpTabs = orig;
  });

  it('skips already mapped tabs', async () => {
    mockCdp.getHttpTabs.result = [
      { targetId: 'known-1', url: 'http://known.com', type: 'page' },
      { targetId: 'new-tab', url: 'http://new.com', type: 'page' },
    ];
    ctrl.setSlaveTabForMaster('known-1', 'slave-1', 'existing-1');
    ctrl.setSlaveTabForMaster('known-1', 'slave-2', 'existing-2');
    const result = await discoverActiveTab();
    expect(result.targetId).toBe('new-tab');
  });

  it('full flow: discover + syncNewMasterTab creates slave tabs without activating', async () => {
    ctrl.activeMasterTab = 'current-tab';
    mockCdp.getHttpTabs.result = [
      { targetId: 'new-tab', url: 'http://found.com', type: 'page' },
    ];
    const newTab = await discoverActiveTab();
    expect(newTab).toBeDefined();
    expect(mockCdp.createCallsLog).toHaveLength(2);
    expect(ctrl.getSlaveTabForMaster('new-tab', 'slave-1')).toBeDefined();
    expect(ctrl.getSlaveTabForMaster('new-tab', 'slave-2')).toBeDefined();
    expect(ctrl.activeMasterTab).toBe('current-tab');
  });

  // Дополнительные тесты на граничные случаи
  it('skips already mapped tabs in new discovery call', async () => {
    // Первый вызов — обнаруживаем новую вкладку
    mockCdp.getHttpTabs.result = [
      { targetId: 'tab-a', url: 'http://a.com', type: 'page' },
    ];
    await discoverActiveTab();
    expect(mockCdp.createCallsLog).toHaveLength(2);

    // Второй вызов — tab-a уже известна
    mockCdp.getHttpTabs.result = [
      { targetId: 'tab-a', url: 'http://a.com', type: 'page' },
      { targetId: 'tab-b', url: 'http://b.com', type: 'page' },
    ];
    const result = await discoverActiveTab();
    expect(result.targetId).toBe('tab-b');
    expect(mockCdp.createCallsLog).toHaveLength(4);
  });

  it('does nothing if discovering is already in progress', async () => {
    discovering = true;
    mockCdp.getHttpTabs.result = [
      { targetId: 'new-tab', url: 'http://new.com', type: 'page' },
    ];
    const result = await discoverActiveTab();
    expect(result).toBeUndefined();
    expect(mockCdp.createCallsLog).toBeUndefined();
  });
});

// ============================================================
// ТЕСТЫ: onEvent (точная копия callback из api/multi-control)
// ============================================================
describe('onEvent callback (matches api/multi-control)', () => {
  let ctrl;
  let mockTargetBySid;

  // onEvent callback из api/multi-control.js строки 180-192
  function onEvent(profileId, event, sessionId, targetBySid) {
    if (profileId === ctrl.masterId && ctrl.active) {
      if (event.type === 'tabActivated') {
        const targetId = targetBySid.get(sessionId);
        if (targetId) {
          ctrl.markTabDirty(targetId);
        }
        return;
      }
      const targetId = targetBySid.get(sessionId);
      if (targetId && !['mouseUp', 'mouseMove', 'scroll', 'keyUp', 'charInput'].includes(event.type)) {
        ctrl.markTabDirty(targetId);
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.markTabDirty = vi.fn();
    mockTargetBySid = new Map();
  });

  it('marks tab dirty on mouseDown event from master', () => {
    mockTargetBySid.set('session-1', 'tab-1');
    onEvent('master-1', { type: 'mouseDown' }, 'session-1', mockTargetBySid);
    expect(ctrl.markTabDirty).toHaveBeenCalledWith('tab-1');
  });

  it('marks tab dirty on keyDown event from master', () => {
    mockTargetBySid.set('session-1', 'tab-1');
    onEvent('master-1', { type: 'keyDown' }, 'session-1', mockTargetBySid);
    expect(ctrl.markTabDirty).toHaveBeenCalledWith('tab-1');
  });

  it('ignores filtered event types', () => {
    mockTargetBySid.set('session-1', 'tab-1');
    const filtered = ['mouseUp', 'mouseMove', 'scroll', 'keyUp', 'charInput'];
    for (const type of filtered) {
      onEvent('master-1', { type }, 'session-1', mockTargetBySid);
    }
    expect(ctrl.markTabDirty).not.toHaveBeenCalled();
  });

  it('ignores events from slave profiles', () => {
    mockTargetBySid.set('session-1', 'tab-1');
    onEvent('slave-1', { type: 'mouseDown' }, 'session-1', mockTargetBySid);
    expect(ctrl.markTabDirty).not.toHaveBeenCalled();
  });

  it('ignores events when inactive', () => {
    ctrl.active = false;
    mockTargetBySid.set('session-1', 'tab-1');
    onEvent('master-1', { type: 'mouseDown' }, 'session-1', mockTargetBySid);
    expect(ctrl.markTabDirty).not.toHaveBeenCalled();
  });

  it('ignores events with unknown sessionId', () => {
    onEvent('master-1', { type: 'mouseDown' }, 'unknown-session', mockTargetBySid);
    expect(ctrl.markTabDirty).not.toHaveBeenCalled();
  });

  it('marks tab dirty on tabActivated event', () => {
    mockTargetBySid.set('session-1', 'tab-1');
    onEvent('master-1', { type: 'tabActivated' }, 'session-1', mockTargetBySid);
    expect(ctrl.markTabDirty).toHaveBeenCalledWith('tab-1');
  });

  it('ignores tabActivated with unknown sessionId', () => {
    onEvent('master-1', { type: 'tabActivated' }, 'unknown-session', mockTargetBySid);
    expect(ctrl.markTabDirty).not.toHaveBeenCalled();
  });

  it('handles events with empty sessionId', () => {
    onEvent('master-1', { type: 'mouseDown' }, '', mockTargetBySid);
    expect(ctrl.markTabDirty).not.toHaveBeenCalled();
  });
});

// ============================================================
// ТЕСТЫ: onNavigate (точная копия callback из api/multi-control)
// ============================================================
describe('onNavigate callback (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;

  // onNavigate callback из api/multi-control.js строки 198-210
  function onNavigate(profileId, tabId, url) {
    if (profileId === ctrl.masterId && ctrl.active) {
      const profiles = ctrl.getProfiles();
      for (const slaveId of profiles) {
        if (slaveId === ctrl.masterId) continue;
        const slaveTabId = ctrl.getSlaveTabForMaster(tabId, slaveId);
        if (slaveTabId) {
          mockCdp.navigateTab(slaveId, slaveTabId, url);
        }
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.getProfiles = () => ['master-1', 'slave-1', 'slave-2'];
  });

  it('navigates slave tabs on master navigation', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-2', 'slave-tab-2');
    onNavigate('master-1', 'master-tab-1', 'http://new-url.com');
    expect(mockCdp.navigateCalls).toHaveLength(2);
    expect(mockCdp.navigateCalls[0]).toEqual({ profileId: 'slave-1', tabId: 'slave-tab-1', url: 'http://new-url.com' });
    expect(mockCdp.navigateCalls[1]).toEqual({ profileId: 'slave-2', tabId: 'slave-tab-2', url: 'http://new-url.com' });
  });

  it('ignores navigation from slave profiles', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onNavigate('slave-1', 'master-tab-1', 'http://new-url.com');
    expect(mockCdp.navigateCalls).toHaveLength(0);
  });

  it('ignores navigation when inactive', () => {
    ctrl.active = false;
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onNavigate('master-1', 'master-tab-1', 'http://new-url.com');
    expect(mockCdp.navigateCalls).toHaveLength(0);
  });

  it('skips slaves with no mapped tab', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onNavigate('master-1', 'master-tab-1', 'http://new-url.com');
    expect(mockCdp.navigateCalls).toHaveLength(1);
    expect(mockCdp.navigateCalls[0].profileId).toBe('slave-1');
  });

  it('handles navigation for unknown master tab', () => {
    onNavigate('master-1', 'unknown-tab', 'http://new-url.com');
    expect(mockCdp.navigateCalls).toHaveLength(0);
  });
});

// ============================================================
// ТЕСТЫ: onNewTab (точная копия callback из api/multi-control)
// ============================================================
describe('onNewTab callback (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;
  let tabIndex;
  let browserConnections;

  // onNewTab callback — версия без force-reactivation (перенесена в onTabAttached)
  function onNewTab(profileId, targetInfo) {
    if (!ctrl.active) return;
    if (profileId === ctrl.masterId) {
      ctrl.lastNewTabTargetId = targetInfo.targetId;
      return;
    }
    const bc = browserConnections.get(profileId);
    if (bc) {
      const slaveIdx = bc.targetSessions.size - 1;
      const masterTargetId = tabIndex[slaveIdx];
      if (masterTargetId) {
        ctrl.mapTab(masterTargetId, profileId, targetInfo.targetId);
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.lastNewTabTargetId = null;
    ctrl.mapTab = vi.fn();
    ctrl.setActiveMasterTab = vi.fn();
    ctrl.activateCalls = [];
    tabIndex = ['master-tab-1', 'master-tab-2'];
    browserConnections = new Map();
    const ts1 = new Map();
    ts1.set('initial-tab', { sessionId: 's1' });
    browserConnections.set('slave-1', { targetSessions: ts1 });
  });

  it('tracks new master tab without activating (activation waits for tabActivated)', () => {
    onNewTab('master-1', { targetId: 'new-tab-1', url: 'http://new-tab.com' });
    expect(ctrl.lastNewTabTargetId).toBe('new-tab-1');
    expect(ctrl.setActiveMasterTab).not.toHaveBeenCalled();
  });

  it('ignores new tab from slave profiles when no tabIndex match', () => {
    tabIndex.length = 0;
    onNewTab('slave-1', { targetId: 'new-slave-tab', url: 'http://new.com' });
    expect(ctrl.mapTab).not.toHaveBeenCalled();
  });

  it('ignores new tab when inactive', () => {
    ctrl.active = false;
    onNewTab('master-1', { targetId: 'new-tab-1', url: 'http://new-tab.com' });
    expect(ctrl.lastNewTabTargetId).toBeNull();
  });

  it('maps slave tab by tabIndex order', () => {
    const ts = new Map();
    ts.set('initial-tab', { sessionId: 's1' });
    ts.set('new-slave-tab', { sessionId: 's2' });
    browserConnections.set('slave-2', { targetSessions: ts });

    onNewTab('slave-2', { targetId: 'new-slave-tab', url: 'http://new.com' });
    // targetSessions.size = 2, slaveIdx = 1, tabIndex[1] = 'master-tab-2'
    expect(ctrl.mapTab).toHaveBeenCalledWith('master-tab-2', 'slave-2', 'new-slave-tab');
  });

  it('maps slave by correct tabIndex when multiple slaves', () => {
    const ts1 = new Map();
    ts1.set('t1', { sessionId: 's1' });
    ts1.set('t2', { sessionId: 's2' });
    browserConnections.set('slave-1', { targetSessions: ts1 });

    onNewTab('slave-1', { targetId: 't2', url: 'http://example.com' });
    // targetSessions.size = 2, slaveIdx = 1, tabIndex[1] = 'master-tab-2'
    expect(ctrl.mapTab).toHaveBeenCalledWith('master-tab-2', 'slave-1', 't2');
  });
});

// ============================================================
// ТЕСТЫ: onTabAttached (focus enforcement только из attachedToTarget)
// ============================================================
describe('onTabAttached callback (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;
  let tabIndex;
  let browserConnections;

  function onTabAttached(profileId, targetInfo) {
    if (!ctrl.active) return;
    if (profileId === ctrl.masterId) return;
    const bc = browserConnections.get(profileId);
    if (bc) {
      const slaveIdx = bc.targetSessions.size - 1;
      const masterTargetId = tabIndex[slaveIdx];
      if (masterTargetId && masterTargetId !== ctrl.activeMasterTab) {
        ctrl._enforceSlaveFocusOnActiveTab(profileId).catch(() => {});
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.mapTab = vi.fn();
    ctrl.activateCalls = [];
    tabIndex = ['master-tab-1', 'master-tab-2'];
    browserConnections = new Map();
    const ts1 = new Map();
    ts1.set('initial-tab', { sessionId: 's1' });
    browserConnections.set('slave-1', { targetSessions: ts1 });
  });

  it('calls _enforceSlaveFocusOnActiveTab when new slave tab is not active master tab', async () => {
    ctrl.activeMasterTab = 'master-tab-1';
    // Populate both local browserConnections (for slaveIdx calc) and ctrl.browserConnections (for session check)
    const bcLocal = browserConnections.get('slave-1');
    bcLocal.targetSessions.set('new-slave-tab', { sessionId: 's2' });
    const bcCtrl = ctrl.browserConnections.get('slave-1');
    bcCtrl.targetSessions.set('initial-tab', { sessionId: 's1' });
    bcCtrl.targetSessions.set('new-slave-tab', { sessionId: 's2' });
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'initial-tab');
    ctrl.setSlaveTabForMaster('master-tab-2', 'slave-1', 'new-slave-tab');

    onTabAttached('slave-1', { targetId: 'new-slave-tab', url: 'http://example.com' });
    await new Promise(r => setTimeout(r, 0));

    // slaveIdx = 1, tabIndex[1] = 'master-tab-2', activeMasterTab = 'master-tab-1' → enforce
    expect(mockCdp.activateCalls.length).toBeGreaterThan(0);
    expect(mockCdp.activateCalls[0]).toEqual({ profileId: 'slave-1', tabId: 'initial-tab' });
  });

  it('does not call activateAndFocusTarget when new slave tab IS the active master tab', async () => {
    ctrl.activeMasterTab = 'master-tab-2';
    const bcLocal = browserConnections.get('slave-1');
    bcLocal.targetSessions.set('new-slave-tab', { sessionId: 's2' });
    const bcCtrl = ctrl.browserConnections.get('slave-1');
    bcCtrl.targetSessions.set('initial-tab', { sessionId: 's1' });
    bcCtrl.targetSessions.set('new-slave-tab', { sessionId: 's2' });

    onTabAttached('slave-1', { targetId: 'new-slave-tab', url: 'http://example.com' });
    await new Promise(r => setTimeout(r, 0));

    // slaveIdx = 1, tabIndex[1] = 'master-tab-2' = activeMasterTab → no enforce
    expect(mockCdp.activateCalls).toHaveLength(0);
  });

  it('does not call activateAndFocusTarget when activeMasterTab is not set', async () => {
    const bcLocal = browserConnections.get('slave-1');
    bcLocal.targetSessions.set('new-slave-tab', { sessionId: 's2' });

    onTabAttached('slave-1', { targetId: 'new-slave-tab', url: 'http://example.com' });
    await new Promise(r => setTimeout(r, 0));

    expect(mockCdp.activateCalls).toHaveLength(0);
  });

  it('ignores master profile', async () => {
    ctrl.activeMasterTab = 'master-tab-1';
    onTabAttached('master-1', { targetId: 'new-tab', url: 'http://example.com' });
    await new Promise(r => setTimeout(r, 0));
    expect(mockCdp.activateCalls).toHaveLength(0);
  });
});

// ============================================================
// ТЕСТЫ: onTabDestroyed (точная копия callback из api/multi-control)
// ============================================================
describe('onTabDestroyed callback (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;

  // onTabDestroyed callback из api/multi-control.js
  function onTabDestroyed(profileId, tabId) {
    if (!ctrl.active) return;
    if (profileId === ctrl.masterId) {
      const profiles = ctrl.getProfiles();
      for (const slaveId of profiles) {
        if (slaveId === ctrl.masterId) continue;
        const slaveTabId = ctrl.getSlaveTabForMaster(tabId, slaveId);
        if (slaveTabId) {
          mockCdp.destroyTab(slaveId, slaveTabId);
          ctrl.removeSlaveForMaster(tabId, slaveId);
        }
      }
      if (ctrl._maybeSwitchToPrevTab) ctrl._maybeSwitchToPrevTab(tabId);
    } else {
      if (ctrl._maybeSwitchToPrevTab && ctrl._unmapBySlaveId) {
        ctrl._unmapBySlaveId(tabId);
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.getProfiles = () => ['master-1', 'slave-1', 'slave-2'];
  });

  it('destroys slave tabs on master tab destroy', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-2', 'slave-tab-2');
    onTabDestroyed('master-1', 'master-tab-1');
    expect(mockCdp.destroyCalls).toHaveLength(2);
    expect(mockCdp.destroyCalls[0]).toEqual({ profileId: 'slave-1', tabId: 'slave-tab-1' });
    expect(mockCdp.destroyCalls[1]).toEqual({ profileId: 'slave-2', tabId: 'slave-tab-2' });
  });

  it('removes slave mappings after destroy', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-2', 'slave-tab-2');
    onTabDestroyed('master-1', 'master-tab-1');
    expect(ctrl.getSlaveTabForMaster('master-tab-1', 'slave-1')).toBeUndefined();
    expect(ctrl.getSlaveTabForMaster('master-tab-1', 'slave-2')).toBeUndefined();
  });

  it('ignores destroy from slave profiles', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onTabDestroyed('slave-1', 'master-tab-1');
    expect(mockCdp.destroyCalls).toHaveLength(0);
  });

  it('ignores destroy when inactive', () => {
    ctrl.active = false;
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onTabDestroyed('master-1', 'master-tab-1');
    expect(mockCdp.destroyCalls).toHaveLength(0);
  });

  it('handles unknown master tab', () => {
    onTabDestroyed('master-1', 'unknown-tab');
    expect(mockCdp.destroyCalls).toHaveLength(0);
  });
});

// ============================================================
// ТЕСТЫ: focus-windows (POST /focus-windows)
// ============================================================
describe('focus-windows route (POST /focus-windows)', () => {
  it('router содержит POST /focus-windows', () => {
    const mod = require('../../src/api/multi-control.js');
    const route = mod.stack.find(r => r.route?.path === '/focus-windows');
    expect(route).toBeDefined();
    expect(route.route.methods).toHaveProperty('post');
  });
});
describe('onTabActivated callback (matches api/multi-control)', () => {
  let ctrl;
  let mockCdp;

  // onTabActivated callback из api/multi-control.js строки 255-265
  function onTabActivated(profileId, tabId) {
    if (profileId === ctrl.masterId && ctrl.active) {
      const profiles = ctrl.getProfiles();
      for (const slaveId of profiles) {
        if (slaveId === ctrl.masterId) continue;
        const slaveTabId = ctrl.getSlaveTabForMaster(tabId, slaveId);
        if (slaveTabId) {
          mockCdp.activateTab(slaveId, slaveTabId);
        }
      }
    }
  }

  beforeEach(() => {
    ctrl = new MockCdpManager();
    mockCdp = ctrl;
    ctrl.masterId = 'master-1';
    ctrl.active = true;
    ctrl.getProfiles = () => ['master-1', 'slave-1', 'slave-2'];
  });

  it('activates slave tabs on master tab activation', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-2', 'slave-tab-2');
    onTabActivated('master-1', 'master-tab-1');
    expect(mockCdp.activateCalls).toHaveLength(2);
    expect(mockCdp.activateCalls[0]).toEqual({ profileId: 'slave-1', tabId: 'slave-tab-1' });
    expect(mockCdp.activateCalls[1]).toEqual({ profileId: 'slave-2', tabId: 'slave-tab-2' });
  });

  it('ignores activation from slave profiles', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onTabActivated('slave-1', 'master-tab-1');
    expect(mockCdp.activateCalls).toHaveLength(0);
  });

  it('ignores activation when inactive', () => {
    ctrl.active = false;
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onTabActivated('master-1', 'master-tab-1');
    expect(mockCdp.activateCalls).toHaveLength(0);
  });

  it('skips slaves with no mapped tab', () => {
    ctrl.setSlaveTabForMaster('master-tab-1', 'slave-1', 'slave-tab-1');
    onTabActivated('master-1', 'master-tab-1');
    expect(mockCdp.activateCalls).toHaveLength(1);
    expect(mockCdp.activateCalls[0].profileId).toBe('slave-1');
  });

  it('handles unknown master tab', () => {
    onTabActivated('master-1', 'unknown-tab');
    expect(mockCdp.activateCalls).toHaveLength(0);
  });
});
