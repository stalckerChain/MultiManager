import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { readFileSync } from 'fs';

import * as browserApi from '../../src/api/browser.js';

const BROWSER_JS = new URL('../../src/api/browser.js', import.meta.url);

afterEach(() => {
  browserApi.setCdpClientForTesting(null);
});

describe('openProfileInfoTab — functional', () => {
  let ws;
  let cdpMock;
  let profileLogger;
  let logQueries;

  const makeLogger = () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() });

  beforeEach(() => {
    vi.clearAllMocks();
    ws = { close: vi.fn() };
    cdpMock = {
      call: vi.fn(async (w, method) => {
        if (method === 'Target.getTargets') {
          return { targetInfos: [] };
        }
        if (method === 'Target.attachToTarget') {
          return { sessionId: 'sess-1' };
        }
        return { targetId: 'info-tab-1' };
      }),
      connect: vi.fn().mockResolvedValue(ws),
      discoverWsUrl: vi.fn().mockResolvedValue('ws://127.0.0.1:9222/devtools/browser'),
    };
    browserApi.setCdpClientForTesting(cdpMock);
    profileLogger = makeLogger();
    logQueries = { add: vi.fn() };
  });

  it('creates the info tab via Target.createTarget with the correct URL', async () => {
    await browserApi.openProfileInfoTab('p1', 9222, 3000, profileLogger, logQueries);

    expect(cdpMock.discoverWsUrl).toHaveBeenCalledWith(9222);
    expect(cdpMock.connect).toHaveBeenCalled();
    expect(cdpMock.call).toHaveBeenCalledWith(
      ws,
      'Target.createTarget',
      { url: 'http://127.0.0.1:3000/profile-info/p1' }
    );
    expect(ws.close).toHaveBeenCalled();
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'info', expect.stringContaining('Информационная вкладка'));
  });

  it('logs a warning and continues when cdpPort is missing', async () => {
    await browserApi.openProfileInfoTab('p1', null, 3000, profileLogger, logQueries);

    expect(cdpMock.connect).not.toHaveBeenCalled();
    expect(cdpMock.call).not.toHaveBeenCalled();
    expect(profileLogger.warn).toHaveBeenCalled();
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'warn', expect.stringContaining('CDP порт'));
  });

  it('logs a warning and continues when server port is missing', async () => {
    await browserApi.openProfileInfoTab('p1', 9222, null, profileLogger, logQueries);

    expect(cdpMock.connect).not.toHaveBeenCalled();
    expect(profileLogger.warn).toHaveBeenCalled();
  });

  it('does not break on CDP failure and logs only a safe category', async () => {
    cdpMock.call.mockRejectedValue(new Error('some CDP error containing http://127.0.0.1:3000/profile-info/p1'));

    await expect(
      browserApi.openProfileInfoTab('p1', 9222, 3000, profileLogger, logQueries)
    ).resolves.toBeUndefined();

    const allCalls = JSON.stringify([
      ...profileLogger.info.mock.calls,
      ...profileLogger.warn.mock.calls,
      ...profileLogger.error.mock.calls,
      ...logQueries.add.mock.calls,
    ]);
    expect(allCalls).not.toContain('http://127.0.0.1:3000/profile-info');
    expect(allCalls).not.toContain('some CDP error');
    expect(ws.close).toHaveBeenCalled();
  });

  it('never logs the info URL in the success path', async () => {
    await browserApi.openProfileInfoTab('p1', 9222, 3000, profileLogger, logQueries);

    const allCalls = JSON.stringify([
      ...profileLogger.info.mock.calls,
      ...profileLogger.warn.mock.calls,
      ...profileLogger.error.mock.calls,
      ...logQueries.add.mock.calls,
    ]);
    expect(allCalls).not.toContain('profile-info');
  });

  it('encodes the profileId in the URL', async () => {
    await browserApi.openProfileInfoTab('id with spaces', 9222, 3000, profileLogger, logQueries);

    expect(cdpMock.call).toHaveBeenCalledWith(
      ws,
      'Target.createTarget',
      { url: 'http://127.0.0.1:3000/profile-info/id%20with%20spaces' }
    );
  });

  it('navigates an existing blank tab instead of creating a new one', async () => {
    cdpMock.call.mockImplementation(async (w, method) => {
      if (method === 'Target.getTargets') {
        return { targetInfos: [{ targetId: 'blank-1', type: 'page', url: 'about:blank' }] };
      }
      if (method === 'Target.attachToTarget') {
        return { sessionId: 'sess-1' };
      }
      return { targetId: 'info-tab-1' };
    });

    await browserApi.openProfileInfoTab('p1', 9222, 3000, profileLogger, logQueries);

    expect(cdpMock.call).toHaveBeenCalledWith(ws, 'Target.getTargets');
    expect(cdpMock.call).toHaveBeenCalledWith(ws, 'Target.attachToTarget', { targetId: 'blank-1', flatten: true });
    expect(cdpMock.call).toHaveBeenCalledWith(
      ws,
      'Page.navigate',
      { url: 'http://127.0.0.1:3000/profile-info/p1' },
      { sessionId: 'sess-1' }
    );
    expect(cdpMock.call).not.toHaveBeenCalledWith(ws, 'Target.createTarget', expect.anything());
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'info', expect.stringContaining('в существующей вкладке'));
    expect(ws.close).toHaveBeenCalled();
  });

  it('matches a blank tab with a hash suffix (about:blank#... )', async () => {
    cdpMock.call.mockImplementation(async (w, method) => {
      if (method === 'Target.getTargets') {
        return { targetInfos: [{ targetId: 'blank-2', type: 'page', url: 'about:blank#frag' }] };
      }
      if (method === 'Target.attachToTarget') {
        return { sessionId: 'sess-2' };
      }
      return { targetId: 'info-tab-1' };
    });

    await browserApi.openProfileInfoTab('p1', 9222, 3000, profileLogger, logQueries);

    expect(cdpMock.call).toHaveBeenCalledWith(ws, 'Target.attachToTarget', { targetId: 'blank-2', flatten: true });
    expect(cdpMock.call).not.toHaveBeenCalledWith(ws, 'Target.createTarget', expect.anything());
  });

  it('falls back to Target.createTarget when only non-blank pages exist', async () => {
    cdpMock.call.mockImplementation(async (w, method) => {
      if (method === 'Target.getTargets') {
        return {
          targetInfos: [
            { targetId: 'page-1', type: 'page', url: 'https://example.com' },
            { targetId: 'dev-1', type: 'page', url: 'devtools://devtools/bundled/inspector.html' },
          ],
        };
      }
      return { targetId: 'info-tab-1' };
    });

    await browserApi.openProfileInfoTab('p1', 9222, 3000, profileLogger, logQueries);

    expect(cdpMock.call).toHaveBeenCalledWith(
      ws,
      'Target.createTarget',
      { url: 'http://127.0.0.1:3000/profile-info/p1' }
    );
    expect(cdpMock.call).not.toHaveBeenCalledWith(ws, 'Page.navigate', expect.anything());
  });
});

describe('openProfileInfoTab — source-level safety', () => {
  const block = (() => {
    const content = readFileSync(BROWSER_JS, 'utf-8');
    return content.slice(
      content.indexOf('async function openProfileInfoTab'),
      content.indexOf("router.post('/:id/start'")
    );
  })();

  it('uses the existing CDP client primitives (no new connection mechanism)', () => {
    expect(block).toContain('cdpClient.discoverWsUrl');
    expect(block).toContain('cdpClient.connect');
    expect(block).toContain('Target.getTargets');
    expect(block).toContain('Target.attachToTarget');
    expect(block).toContain('Page.navigate');
    expect(block).toContain('Target.createTarget');
  });

  it('reuses an existing blank tab when present and falls back to a new target', () => {
    const blankIdx = block.indexOf('about:blank');
    expect(blankIdx).toBeGreaterThan(-1);
    const afterBlank = block.slice(blankIdx);
    expect(afterBlank).toMatch(/if \(blankTarget\)/);
    expect(afterBlank).toMatch(/Page\.navigate/);
    expect(afterBlank).toMatch(/Target\.createTarget/);
  });

  it('checks cdpPort before touching CDP', () => {
    expect(block).toContain('if (!cdpPort)');
    expect(block).toMatch(/if \(!cdpPort\)[\s\S]*warn/);
  });

  it('does not log the URL or CDP error text', () => {
    expect(block).not.toMatch(/logger\.[a-z]+\(\{[^}]*url/i);
    expect(block).not.toMatch(/logQueries\.add\([^)]*profile-info/);
    expect(block).not.toMatch(/err\.message/);
  });

  it('does not log profile data beyond profileId', () => {
    expect(block).not.toContain('profile.name');
    expect(block).not.toContain('wallet');
    expect(block).not.toContain('password');
  });

  it('is exported for reuse', () => {
    const content = readFileSync(BROWSER_JS, 'utf-8');
    expect(content).toMatch(/module\.exports\.openProfileInfoTab\s*=\s*openProfileInfoTab/);
  });
});

describe('Start handler dispatches the info tab (source-level)', () => {
  const content = readFileSync(BROWSER_JS, 'utf-8');
  const startBlock = content.slice(
    content.indexOf("router.post('/:id/start'"),
    content.indexOf("router.post('/:id/stop'")
  );

  it('creates the info tab after manual autologin and right before res.json', () => {
    const autologinIdx = startBlock.indexOf('await runManualAutologin(');
    const infoTabIdx = startBlock.indexOf('await openProfileInfoTab(');
    const resIdx = startBlock.indexOf('res.json({');
    expect(autologinIdx).toBeGreaterThan(-1);
    expect(infoTabIdx).toBeGreaterThan(-1);
    expect(resIdx).toBeGreaterThan(-1);
    expect(infoTabIdx).toBeGreaterThan(autologinIdx);
    expect(infoTabIdx).toBeLessThan(resIdx);
  });

  it('takes the server port from req.socket.localPort of the start request', () => {
    expect(startBlock).toMatch(/req\.socket\.localPort/);
  });

  it('does not hardcode port 3000 or pass the port through spawnBrowserWithCdp', () => {
    expect(startBlock).not.toMatch(/profile-info\/\$\{3000\}/);
    expect(content).not.toMatch(/spawnBrowserWithCdp\([\s\S]{0,300}localPort/);
  });

  it('runs for both manual and automation/MM launch (single dispatch point after runId block)', () => {
    // Вызов вне if (!runId) — один для обоих режимов запуска.
    expect(startBlock).toMatch(/if \(!runId\)[\s\S]*runManualAutologin/);
    expect(startBlock).not.toMatch(/if \(!runId\)[\s\S]{0,1200}openProfileInfoTab/);
  });
});