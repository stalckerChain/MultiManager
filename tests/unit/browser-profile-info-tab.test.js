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
      call: vi.fn().mockResolvedValue({ targetId: 'info-tab-1' }),
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

  it('does not break on Target.createTarget failure and logs only a safe category', async () => {
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
    expect(block).toContain('Target.createTarget');
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