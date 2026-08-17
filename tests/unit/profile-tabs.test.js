import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';

import * as profileTabs from '../../src/cdp/profile-tabs.js';

// Восстановление тестовых швов после каждого теста: подменённые модули не
// должны «протекать» в последующие тесты.
afterEach(() => {
  profileTabs.setCdpClientForTesting(null);
  profileTabs.setCdpPortProviderForTesting(null);
});

const cdpMock = {
  call: vi.fn(),
  connect: vi.fn(),
  discoverWsUrl: vi.fn(),
};

const portProvider = vi.fn();

function installCdpMocks({ targetInfos, createTargetResult, closeTargetImpl, callImpl }) {
  portProvider.mockReturnValue(9222);
  cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
  cdpMock.connect.mockResolvedValue(ws);
  let getTargetsCalls = 0;
  cdpMock.call.mockImplementation(async (w, method, params) => {
    if (callImpl) return callImpl(w, method, params);
    if (method === 'Target.createTarget') {
      return createTargetResult || { targetId: 'blank-1' };
    }
    if (method === 'Target.getTargets') {
      getTargetsCalls++;
      if (getTargetsCalls === 1) return { targetInfos };
      const blankId = (createTargetResult && createTargetResult.targetId) || 'blank-1';
      return { targetInfos: [{ targetId: blankId, type: 'page', url: 'about:blank' }] };
    }
    if (method === 'Target.closeTarget') {
      if (closeTargetImpl) return closeTargetImpl(params);
      return { success: true };
    }
    return {};
  });
}

let ws;

describe('profile-tabs.js — resetToSingleBlankTab (source-level)', () => {
  const content = readFileSync(
    new URL('../../src/cdp/profile-tabs.js', import.meta.url),
    'utf-8'
  );

  it('экспортирует resetToSingleBlankTab', () => {
    expect(profileTabs.resetToSingleBlankTab).toBeTypeOf('function');
    expect(content).toMatch(/resetToSingleBlankTab,?/);
  });

  it('создаёт about:blank через Target.createTarget и использует существующие примитивы', () => {
    expect(content).toMatch(/createTarget\(ws,\s*'about:blank'\)/);
    expect(content).toContain('listPageTargets(ws)');
    expect(content).toContain('closeTarget(ws');
    expect(content).toContain('withProfileSession');
  });

  it('не логирует URL', () => {
    expect(content).not.toMatch(/logger\.(info|debug|error|warn)\(\{[^}]*url/i);
  });

  it('гарантирует закрытие WebSocket через withProfileSession (finally)', () => {
    expect(content).toMatch(/function withProfileSession/);
    expect(content).toMatch(/finally\s*\{[\s\S]*if \(ws\) ws\.close\(\)/);
  });

  it('ждёт асинхронного уничтожения закрытых вкладок перед возвратом', () => {
    expect(content).toMatch(/подтверждает только приём команды/);
    expect(content).toMatch(/waitUntilSinglePageTarget/);
    expect(content).not.toMatch(/logger\.(info|debug|error|warn)\(\{[^}]*url/i);
  });
});

describe('profile-tabs.js — resetToSingleBlankTab (functional)', () => {
  beforeEach(() => {
    ws = { close: vi.fn() };
    vi.clearAllMocks();
    profileTabs.setCdpPortProviderForTesting(portProvider);
    profileTabs.setCdpClientForTesting(cdpMock);
  });

  it('создаёт новую about:blank и закрывает остальные page-вкладки', async () => {
    installCdpMocks({
      targetInfos: [
        { targetId: 't1', type: 'page', url: 'https://a.example' },
        { targetId: 't2', type: 'page', url: 'https://b.example' },
      ],
    });

    const result = await profileTabs.resetToSingleBlankTab('p1');

    expect(portProvider).toHaveBeenCalledWith('p1');
    expect(cdpMock.call).toHaveBeenCalledWith(ws, 'Target.createTarget', { url: 'about:blank' }, expect.anything());
    expect(result).toEqual({ closed: 2, kept: 1, errors: [] });

    const closedTargets = cdpMock.call.mock.calls
      .filter(c => c[1] === 'Target.closeTarget')
      .map(c => c[2].targetId);
    expect(closedTargets).toEqual(expect.arrayContaining(['t1', 't2']));
    expect(closedTargets).not.toContain('blank-1');
  });

  it('не закрывает devtools:// targets и не-page targets', async () => {
    installCdpMocks({
      targetInfos: [
        { targetId: 't1', type: 'page', url: 'https://a.example' },
        { targetId: 'devtools-1', type: 'page', url: 'devtools://devtools/bundled' },
        { targetId: 'sw-1', type: 'service_worker', url: 'chrome-extension://x/background.js' },
      ],
    });

    await profileTabs.resetToSingleBlankTab('p1');

    const closedTargets = cdpMock.call.mock.calls
      .filter(c => c[1] === 'Target.closeTarget')
      .map(c => c[2].targetId);
    expect(closedTargets).toContain('t1');
    expect(closedTargets).not.toContain('devtools-1');
    expect(closedTargets).not.toContain('sw-1');
  });

  it('корректно работает при отсутствии старых вкладок', async () => {
    installCdpMocks({ targetInfos: [] });

    const result = await profileTabs.resetToSingleBlankTab('p1');

    expect(result).toEqual({ closed: 0, kept: 1, errors: [] });
    expect(cdpMock.call.mock.calls.filter(c => c[1] === 'Target.closeTarget')).toHaveLength(0);
  });

  it('не падает при частичной ошибке закрытия и возвращает errors', async () => {
    installCdpMocks({
      targetInfos: [
        { targetId: 't1', type: 'page', url: 'https://a.example' },
        { targetId: 't2', type: 'page', url: 'https://b.example' },
      ],
      closeTargetImpl: async (params) => {
        if (params.targetId === 't2') throw new Error('close failed');
        return { success: true };
      },
    });

    const result = await profileTabs.resetToSingleBlankTab('p1');

    expect(result.closed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0].targetId).toBe('t2');
  });

  it('закрывает WebSocket-сессию после успешной операции', async () => {
    installCdpMocks({
      targetInfos: [{ targetId: 't1', type: 'page', url: 'https://a.example' }],
    });

    await profileTabs.resetToSingleBlankTab('p1');
    expect(ws.close).toHaveBeenCalled();
  });

  it('закрывает WebSocket-сессию при ошибке', async () => {
    portProvider.mockReturnValue(9222);
    cdpMock.discoverWsUrl.mockResolvedValue('ws://127.0.0.1:9222/devtools/browser');
    cdpMock.connect.mockResolvedValue(ws);
    cdpMock.call.mockRejectedValue(new Error('CDP timeout: Target.createTarget'));

    await expect(profileTabs.resetToSingleBlankTab('p1')).rejects.toThrow('CDP timeout');
    expect(ws.close).toHaveBeenCalled();
  });

  it('бросает ошибку, если CDP порт недоступен', async () => {
    portProvider.mockReturnValue(null);

    await expect(profileTabs.resetToSingleBlankTab('p1')).rejects.toThrow('CDP port is unavailable');
    expect(cdpMock.connect).not.toHaveBeenCalled();
  });

  it('ждёт асинхронного уничтожения закрытых вкладок (getTargets возвращает остаток)', async () => {
    const initial = [
      { targetId: 't1', type: 'page', url: 'https://a.example' },
      { targetId: 't2', type: 'page', url: 'https://b.example' },
    ];
    let getTargetsCount = 0;
    installCdpMocks({
      targetInfos: initial,
      callImpl: async (w, method, params) => {
        if (method === 'Target.createTarget') return { targetId: 'blank-1' };
        if (method === 'Target.getTargets') {
          getTargetsCount++;
          if (getTargetsCount <= 3) return { targetInfos: initial.concat([{ targetId: 'blank-1', type: 'page', url: 'about:blank' }]) };
          return { targetInfos: [{ targetId: 'blank-1', type: 'page', url: 'about:blank' }] };
        }
        if (method === 'Target.closeTarget') return { success: true };
        return {};
      },
    });

    const result = await profileTabs.resetToSingleBlankTab('p1');

    expect(result).toEqual({ closed: 2, kept: 1, errors: [] });
    expect(getTargetsCount).toBeGreaterThan(1);
  });

  it('сообщает об ошибке, если закрытые вкладки не удаляются до таймаута', async () => {
    vi.useFakeTimers();
    try {
      installCdpMocks({
        targetInfos: [
          { targetId: 't1', type: 'page', url: 'https://a.example' },
          { targetId: 't2', type: 'page', url: 'https://b.example' },
        ],
        callImpl: async (w, method, params) => {
          if (method === 'Target.createTarget') return { targetId: 'blank-1' };
          if (method === 'Target.getTargets') {
            return { targetInfos: [
              { targetId: 'blank-1', type: 'page', url: 'about:blank' },
              { targetId: 't2', type: 'page', url: 'https://b.example' },
            ] };
          }
          if (method === 'Target.closeTarget') return { success: true };
          return {};
        },
      });

      const promise = profileTabs.resetToSingleBlankTab('p1');
      await vi.advanceTimersByTimeAsync(10000);
      const result = await promise;

      expect(result.errors).toEqual([
        { targetId: 't2', error: 'target not destroyed within timeout' },
      ]);
    } finally {
      vi.useRealTimers();
    }
  });
});
