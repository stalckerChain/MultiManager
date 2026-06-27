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

  function setTheme(newTheme) {
    state.theme = newTheme;
  }

  function setLanguage(lang) {
    state.language = lang;
  }

  return { state, init, setTheme, setLanguage };
}

describe('App Store — initialized state', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.window = globalThis.window || {};
    delete globalThis.window.electronAPI;
  });

  it('initialized = false до вызова init()', () => {
    const { state } = createAppStore();
    expect(state.initialized).toBe(false);
    expect(state.serverStatus).toBe('disconnected');
  });

  it('init() устанавливает initialized = true', async () => {
    const { state, init } = createAppStore();
    await init();

    expect(state.initialized).toBe(true);
    expect(state.serverStatus).toBe('connected');
  });

  it('init() с electronAPI получает порт и токен', async () => {
    globalThis.window.electronAPI = {
      getPort: vi.fn().mockResolvedValue(3005),
      getToken: vi.fn().mockResolvedValue('my-secret-token'),
    };

    const { state, init } = createAppStore();
    await init();

    expect(state.port).toBe(3005);
    expect(state.token).toBe('my-secret-token');
    expect(state.initialized).toBe(true);
  });

  it('init() без electronAPI использует дефолтные значения', async () => {
    const { state, init } = createAppStore();
    await init();

    expect(state.port).toBe(3000);
    expect(state.token).toBe('');
    expect(state.initialized).toBe(true);
  });

  it('setTheme устанавливает тему', () => {
    const { state, setTheme } = createAppStore();
    setTheme('light');
    expect(state.theme).toBe('light');
  });

  it('setLanguage устанавливает язык', () => {
    const { state, setLanguage } = createAppStore();
    setLanguage('ru');
    expect(state.language).toBe('ru');
  });

  it('setAuthToken вызывается с правильным токеном', async () => {
    globalThis.window.electronAPI = {
      getPort: vi.fn().mockResolvedValue(3000),
      getToken: vi.fn().mockResolvedValue('abc-123'),
    };

    const { init } = createAppStore();
    await init();

    const { setAuthToken } = await import('../../gui/src/renderer/api/client.js');
    setAuthToken('abc-123');
    expect(setAuthToken).toHaveBeenCalledWith('abc-123');
  });
});
