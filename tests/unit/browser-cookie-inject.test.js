import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import * as browserApi from '../../src/api/browser.js';

let injectMock;

function makeLogger() {
  return { info: vi.fn(), error: vi.fn(), warn: vi.fn() };
}

function makeLogQueries() {
  return { add: vi.fn() };
}

beforeEach(() => {
  injectMock = {
    applyCookiesToCdp: vi.fn(),
    getCookiesFromCdp: vi.fn(),
  };
  browserApi.setCookieInjectForTesting(injectMock);
});

afterEach(() => {
  browserApi.setCookieInjectForTesting(null);
  vi.clearAllMocks();
});

describe('Browser — applyProfileCookies (CDP-инъекция cookies)', () => {
  it('применяет cookies и логирует только количество', async () => {
    injectMock.applyCookiesToCdp.mockResolvedValue(3);
    const profileLogger = makeLogger();
    const logQueries = makeLogQueries();

    const applied = await browserApi.applyProfileCookies('p1', 9222, profileLogger, logQueries);

    expect(applied).toBe(3);
    expect(injectMock.applyCookiesToCdp).toHaveBeenCalledWith('p1', 9222);
    expect(logQueries.add).toHaveBeenCalledWith('p1', 'info', 'Применено cookies через CDP: 3');
    expect(profileLogger.info).toHaveBeenCalledWith(
      { profileId: 'p1', cookieCount: 3 },
      'Cookies применены через CDP'
    );
  });

  it('не логирует ничего, когда cookies отсутствуют', async () => {
    injectMock.applyCookiesToCdp.mockResolvedValue(0);
    const profileLogger = makeLogger();
    const logQueries = makeLogQueries();

    const applied = await browserApi.applyProfileCookies('p1', 9222, profileLogger, logQueries);

    expect(applied).toBe(0);
    expect(profileLogger.info).not.toHaveBeenCalled();
    expect(logQueries.add).not.toHaveBeenCalled();
  });

  it('ошибка CDP-инъекции не останавливает запуск и не логирует значения cookies', async () => {
    injectMock.applyCookiesToCdp.mockRejectedValue(new Error('cdp unavailable'));
    const profileLogger = makeLogger();
    const logQueries = makeLogQueries();

    const applied = await browserApi.applyProfileCookies('p1', 9222, profileLogger, logQueries);

    expect(applied).toBe(0);
    expect(logQueries.add).toHaveBeenCalledWith(
      'p1',
      'warn',
      'Ошибка применения cookies через CDP: cdp unavailable'
    );
    expect(profileLogger.warn).toHaveBeenCalledWith(
      { profileId: 'p1', error: 'cdp unavailable' },
      'Ошибка применения cookies через CDP'
    );
  });

  it('resolve выполняется без секретов в логах', async () => {
    injectMock.applyCookiesToCdp.mockRejectedValue(new Error('injection failed'));
    const profileLogger = makeLogger();
    const logQueries = makeLogQueries();

    await browserApi.applyProfileCookies('p1', 9222, profileLogger, logQueries);

    const allCalls = JSON.stringify([
      ...profileLogger.info.mock.calls,
      ...profileLogger.warn.mock.calls,
      ...profileLogger.error.mock.calls,
      ...logQueries.add.mock.calls,
    ]);
    expect(allCalls).not.toContain('SUPER_SECRET_COOKIE_VALUE');
    expect(allCalls).not.toContain('name=');
  });
});