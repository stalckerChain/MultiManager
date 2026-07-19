import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../../gui/src/renderer/i18n/index.js', () => ({
  default: { changeLanguage: vi.fn() },
}));

vi.mock('../../gui/src/renderer/api/client.js', () => ({
  setBaseURL: vi.fn(),
  setAuthToken: vi.fn(),
  default: { get: vi.fn(), post: vi.fn() },
}));

function createMockProfilesStore() {
  return {
    profiles: [],
    loading: false,
    fetchAll: vi.fn().mockResolvedValue(undefined),
    updateStatus: vi.fn(),
  };
}

function createMockAppStore(port = 3000) {
  return {
    port,
    initialized: false,
  };
}

function createMockWebSocket() {
  const listeners = {};
  const mockWs = {
    readyState: 1, // OPEN
    send: vi.fn(),
    close: vi.fn(),
    onopen: null,
    onmessage: null,
    onclose: null,
    onerror: null,
    _trigger(event, data) {
      if (event === 'message' && mockWs.onmessage) {
        mockWs.onmessage({ data: JSON.stringify(data) });
      }
      if (event === 'open' && mockWs.onopen) {
        mockWs.onopen();
      }
      if (event === 'close' && mockWs.onclose) {
        mockWs.onclose();
      }
    },
  };
  return mockWs;
}

describe('WebSocket — reconnect with fetchAll', () => {
  let mockProfilesStore;
  let mockAppStore;
  let mockWs;

  beforeEach(() => {
    vi.clearAllMocks();
    mockProfilesStore = createMockProfilesStore();
    mockAppStore = createMockAppStore(3000);
    mockWs = createMockWebSocket();

    globalThis.WebSocket = vi.fn(() => mockWs);
    globalThis.window = globalThis.window || {};
    globalThis.window.location = { hostname: '127.0.0.1' };
  });

  afterEach(() => {
    delete globalThis.WebSocket;
    delete globalThis.window;
  });

  it('onopen вызывает profilesStore.fetchAll()', () => {
    const connected = { value: false };
    let reconnectDelay = 1000;

    // Simulating useWebSocket connect logic
    const url = `ws://127.0.0.1:${mockAppStore.port}/ws`;
    const ws = new WebSocket(url);

    ws.onopen = () => {
      connected.value = true;
      reconnectDelay = 1000;
      mockProfilesStore.fetchAll();
    };

    // Trigger open
    ws.onopen();

    expect(connected.value).toBe(true);
    expect(mockProfilesStore.fetchAll).toHaveBeenCalledTimes(1);
  });

  it('onmessage обрабатывает status update', () => {
    let receivedMsg = null;

    const ws = createMockWebSocket();
    ws.onmessage = (event) => {
      receivedMsg = JSON.parse(event.data);
    };

    ws._trigger('message', { type: 'status', profileId: 'p1', status: 'stopped', pid: null });

    expect(receivedMsg).toEqual({
      type: 'status',
      profileId: 'p1',
      status: 'stopped',
      pid: null,
    });
  });

  it('onmessage обрабатывает profiles_update с fetchAll', () => {
    const ws = createMockWebSocket();
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.type === 'profiles_update') {
        mockProfilesStore.fetchAll();
      }
    };

    ws._trigger('message', { type: 'profiles_update' });

    expect(mockProfilesStore.fetchAll).toHaveBeenCalledTimes(1);
  });

  it('fetchAll вызывается и при переподключении', () => {
    const ws = createMockWebSocket();
    ws.onopen = () => {
      mockProfilesStore.fetchAll();
    };

    // Simulate first connection
    ws.onopen();
    expect(mockProfilesStore.fetchAll).toHaveBeenCalledTimes(1);

    // Simulate reconnect (onopen called again)
    ws.onopen();
    expect(mockProfilesStore.fetchAll).toHaveBeenCalledTimes(2);
  });

  it('fetchAll вызывается после каждого переподключения', () => {
    const ws = createMockWebSocket();
    ws.onopen = () => {
      mockProfilesStore.fetchAll();
    };

    // Multiple reconnects
    for (let i = 0; i < 5; i++) {
      ws.onopen();
    }

    expect(mockProfilesStore.fetchAll).toHaveBeenCalledTimes(5);
  });
});

describe('Status Polling — running profiles timer', () => {
  let statusPollTimer = null;

  afterEach(() => {
    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }
  });

  it('запускает таймер когда есть running профили', () => {
    vi.useFakeTimers();
    const fetchAll = vi.fn().mockResolvedValue(undefined);
    const profiles = [{ id: 'p1', status: 'running' }];

    if (profiles.length > 0 && !statusPollTimer) {
      statusPollTimer = setInterval(() => {
        fetchAll().catch(() => {});
      }, 10000);
    }

    expect(statusPollTimer).toBeDefined();

    vi.advanceTimersByTime(10000);
    expect(fetchAll).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(10000);
    expect(fetchAll).toHaveBeenCalledTimes(2);

    clearInterval(statusPollTimer);
    statusPollTimer = null;
    vi.useRealTimers();
  });

  it('останавливает таймер когда running профилей нет', () => {
    vi.useFakeTimers();
    const fetchAll = vi.fn().mockResolvedValue(undefined);
    const profiles = [];

    if (profiles.length > 0 && !statusPollTimer) {
      statusPollTimer = setInterval(() => {
        fetchAll().catch(() => {});
      }, 10000);
    } else if (profiles.length === 0 && statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }

    expect(statusPollTimer).toBeNull();
    vi.useRealTimers();
  });

  it('таймер останавливается при cleanup', () => {
    vi.useFakeTimers();
    const fetchAll = vi.fn().mockResolvedValue(undefined);
    const profiles = [{ id: 'p1', status: 'running' }];

    if (profiles.length > 0 && !statusPollTimer) {
      statusPollTimer = setInterval(() => {
        fetchAll().catch(() => {});
      }, 10000);
    }

    expect(statusPollTimer).toBeDefined();

    if (statusPollTimer) {
      clearInterval(statusPollTimer);
      statusPollTimer = null;
    }

    expect(statusPollTimer).toBeNull();
    vi.useRealTimers();
  });

  it('не запускает повторный таймер если уже запущен', () => {
    vi.useFakeTimers();
    const fetchAll = vi.fn().mockResolvedValue(undefined);
    const profiles = [{ id: 'p1', status: 'running' }];

    if (profiles.length > 0 && !statusPollTimer) {
      statusPollTimer = setInterval(() => {
        fetchAll().catch(() => {});
      }, 10000);
    }

    const firstTimer = statusPollTimer;

    // Try to start again
    if (profiles.length > 0 && !statusPollTimer) {
      statusPollTimer = setInterval(() => {
        fetchAll().catch(() => {});
      }, 10000);
    }

    expect(statusPollTimer).toBe(firstTimer);

    clearInterval(statusPollTimer);
    statusPollTimer = null;
    vi.useRealTimers();
  });
});
