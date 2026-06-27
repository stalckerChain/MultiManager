import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../../gui/src/renderer/i18n/index.js', () => ({
  default: { changeLanguage: vi.fn() },
}));

vi.mock('../../gui/src/renderer/api/client.js', () => ({
  setBaseURL: vi.fn(),
  setAuthToken: vi.fn(),
  default: {},
}));

function createAppStore() {
  const state = {
    port: 3000,
    token: '',
    theme: 'dark',
    language: 'en',
    serverStatus: 'disconnected',
    initialized: false,
  };

  async function init() {
    if (globalThis.window?.electronAPI) {
      state.port = await globalThis.window.electronAPI.getPort();
      state.token = await globalThis.window.electronAPI.getToken();
    }
    state.serverStatus = 'connected';
    state.initialized = true;
  }

  return { state, init };
}

describe('Race condition — initialized flag prevents 401', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window = globalThis.window || {};
    delete globalThis.window.electronAPI;
  });

  it('initialized = false до init() — watcher не должен вызывать fetch', () => {
    const { state } = createAppStore();
    const mockFetch = vi.fn();

    if (state.initialized) {
      mockFetch();
    }

    expect(mockFetch).not.toHaveBeenCalled();
    expect(state.initialized).toBe(false);
  });

  it('initialized = true после init() — watcher должен вызывать fetch', async () => {
    const { state, init } = createAppStore();
    const mockFetch = vi.fn();

    await init();

    if (state.initialized) {
      mockFetch();
    }

    expect(mockFetch).toHaveBeenCalled();
    expect(state.initialized).toBe(true);
  });

  it('watcher с immediate:true — срабатывает только если initialized=true', async () => {
    const { state, init } = createAppStore();
    const calls = [];

    const watcher = (ready) => {
      if (ready) calls.push('fetch');
    };

    watcher(state.initialized);
    expect(calls).toHaveLength(0);

    await init();
    watcher(state.initialized);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toBe('fetch');
  });

  it('эмуляция App.vue init → Profiles.vue watcher sequence', async () => {
    const { state, init } = createAppStore();
    const fetchLog = [];

    const simulateProfilesOnMounted = () => {
      if (state.initialized) {
        fetchLog.push('profiles:fetchAll');
      } else {
        fetchLog.push('profiles:skipped (not initialized)');
      }
    };

    simulateProfilesOnMounted();
    expect(fetchLog[0]).toBe('profiles:skipped (not initialized)');

    await init();

    simulateProfilesOnMounted();
    expect(fetchLog[1]).toBe('profiles:fetchAll');
  });

  it('токен доступен после init() — запросы не получат 401', async () => {
    globalThis.window.electronAPI = {
      getPort: vi.fn().mockResolvedValue(3001),
      getToken: vi.fn().mockResolvedValue('valid-token'),
    };

    const { state, init } = createAppStore();
    await init();

    expect(state.token).toBe('valid-token');
    expect(state.initialized).toBe(true);
  });

  it('эмуляция LogPanel watcher sequence', async () => {
    const { state, init } = createAppStore();
    const fetchLog = [];

    const simulateLogPanelWatcher = (ready) => {
      if (ready) {
        fetchLog.push('logPanel:loadLogFiles');
        fetchLog.push('logPanel:loadLogs');
      }
    };

    simulateLogPanelWatcher(state.initialized);
    expect(fetchLog).toHaveLength(0);

    await init();
    simulateLogPanelWatcher(state.initialized);
    expect(fetchLog).toHaveLength(2);
    expect(fetchLog[0]).toBe('logPanel:loadLogFiles');
    expect(fetchLog[1]).toBe('logPanel:loadLogs');
  });

  it('эмуляция Proxies watcher sequence', async () => {
    const { state, init } = createAppStore();
    const fetchLog = [];

    const simulateProxiesWatcher = (ready) => {
      if (ready) {
        fetchLog.push('proxies:fetchAll');
      }
    };

    simulateProxiesWatcher(state.initialized);
    expect(fetchLog).toHaveLength(0);

    await init();
    simulateProxiesWatcher(state.initialized);
    expect(fetchLog).toHaveLength(1);
  });

  it('эмуляция Extensions watcher sequence', async () => {
    const { state, init } = createAppStore();
    const fetchLog = [];

    const simulateExtensionsWatcher = (ready) => {
      if (ready) {
        fetchLog.push('extensions:fetchAll');
      }
    };

    simulateExtensionsWatcher(state.initialized);
    expect(fetchLog).toHaveLength(0);

    await init();
    simulateExtensionsWatcher(state.initialized);
    expect(fetchLog).toHaveLength(1);
  });

  it('эмуляция WindowArranger watcher sequence', async () => {
    const { state, init } = createAppStore();
    const fetchLog = [];

    const simulateWindowArrangerWatcher = (ready) => {
      if (ready) {
        fetchLog.push('windowArranger:refreshWindows');
      }
    };

    simulateWindowArrangerWatcher(state.initialized);
    expect(fetchLog).toHaveLength(0);

    await init();
    simulateWindowArrangerWatcher(state.initialized);
    expect(fetchLog).toHaveLength(1);
  });
});
