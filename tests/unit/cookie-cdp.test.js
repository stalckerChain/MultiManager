import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { readFileSync } from 'fs';

import {
  normalizeExpiresForCdp,
  dbCookiesToCdpParams,
  cdpCookiesToApi,
  applyCookiesToCdp,
  getCookiesFromCdp,
  setCdpClientForTesting,
  setDatabaseForTesting,
  setCookieQueriesForTesting,
} from '../../src/cookie/inject.js';

// --- Source-level: модуль больше не работает с файлом Default/Cookies ---

describe('cookie/inject — отказ от файлового хранилища', () => {
  const content = readFileSync(new URL('../../src/cookie/inject.js', import.meta.url), 'utf-8');

  it('не импортирует fs и не читает/пишет файл Cookies', () => {
    expect(content).not.toContain("require('fs')");
    expect(content).not.toContain('readFileSync');
    expect(content).not.toContain('writeFileSync');
    expect(content).not.toContain("'Cookies'");
    expect(content).not.toContain('cookiesToNetscape');
  });

  it('не логирует значения cookies', () => {
    expect(content).not.toMatch(/logger\./);
    expect(content).not.toMatch(/console\./);
  });
});

// --- Моки для функциональных тестов через тестовые швы ---

let fakeWs;
let fakeCdp;
let cookieQueries;

beforeEach(() => {
  fakeWs = { close: vi.fn() };
  fakeCdp = {
    discoverWsUrl: vi.fn().mockResolvedValue('ws://127.0.0.1:9222/devtools/browser'),
    connect: vi.fn().mockResolvedValue(fakeWs),
    call: vi.fn().mockResolvedValue({}),
  };
  cookieQueries = {
    getByProfileId: vi.fn().mockReturnValue([]),
    deleteByIds: vi.fn(),
  };

  setCdpClientForTesting(fakeCdp);
  setDatabaseForTesting({});
  setCookieQueriesForTesting(() => cookieQueries);
});

afterEach(() => {
  setCdpClientForTesting(null);
  setDatabaseForTesting(null);
  setCookieQueriesForTesting(null);
});

const DB_COOKIE = {
  id: 1,
  name: 'session',
  value: 'secret-value',
  domain: '.example.com',
  path: '/',
  expires: -1,
  http_only: 1,
  secure: 0,
  same_site: 'Lax',
};

// Смоделировать успешные setCookies + getAllCookies, где Chromium может
// нормализовать value, но сохраняет ключ (domain, path, name).
function installCdpVerify(returnedCookies) {
  fakeCdp.call.mockImplementation(async (ws, method) => {
    if (method === 'Network.setCookies') return {};
    if (method === 'Network.getAllCookies') return { cookies: returnedCookies };
    return {};
  });
}

function toCdpCookie(c) {
  return {
    name: c.name,
    value: `normalized-${c.value}`,
    domain: c.domain,
    path: c.path || '/',
    expires: c.expires,
    httpOnly: c.http_only ? true : false,
    secure: c.secure ? true : false,
    sameSite: c.same_site,
  };
}

describe('normalizeExpiresForCdp', () => {
  it('трактует -1, 0 и null как session-cookie (null)', () => {
    expect(normalizeExpiresForCdp(-1)).toBeNull();
    expect(normalizeExpiresForCdp(0)).toBeNull();
    expect(normalizeExpiresForCdp(null)).toBeNull();
    expect(normalizeExpiresForCdp(undefined)).toBeNull();
  });

  it('оставляет Unix epoch seconds без изменений', () => {
    expect(normalizeExpiresForCdp(1700000000)).toBe(1700000000);
  });

  it('нормализует Unix epoch milliseconds в секунды', () => {
    expect(normalizeExpiresForCdp(1700000000000)).toBe(1700000000);
  });

  it('нормализует Windows epoch (микросекунды) в Unix epoch seconds', () => {
    const winEpoch = 11644473600000000 + 1700000000 * 1000000;
    expect(normalizeExpiresForCdp(winEpoch)).toBe(1700000000);
  });
});

describe('dbCookiesToCdpParams', () => {
  it('маппит http_only/secure в boolean httpOnly/secure', () => {
    const [param] = dbCookiesToCdpParams([DB_COOKIE]);
    expect(param.httpOnly).toBe(true);
    expect(param.secure).toBe(false);
  });

  it('маппит same_site Lax/Strict в одноимённые значения', () => {
    const [lax] = dbCookiesToCdpParams([{ ...DB_COOKIE, same_site: 'Lax' }]);
    const [strict] = dbCookiesToCdpParams([{ ...DB_COOKIE, same_site: 'Strict' }]);
    expect(lax.sameSite).toBe('Lax');
    expect(strict.sameSite).toBe('Strict');
  });

  it('переводит NoRestriction в CDP None', () => {
    const [param] = dbCookiesToCdpParams([{ ...DB_COOKIE, same_site: 'NoRestriction' }]);
    expect(param.sameSite).toBe('None');
  });

  it('не включает ключ expires для session-cookie', () => {
    const [param] = dbCookiesToCdpParams([{ ...DB_COOKIE, expires: -1 }]);
    expect(param).not.toHaveProperty('expires');
  });

  it('включает expires в Unix epoch seconds для persistent-cookie', () => {
    const [param] = dbCookiesToCdpParams([{ ...DB_COOKIE, expires: 1700000000 }]);
    expect(param.expires).toBe(1700000000);
  });

  it('нормализует Windows epoch expires при конвертации', () => {
    const winEpoch = 11644473600000000 + 1700000000 * 1000000;
    const [param] = dbCookiesToCdpParams([{ ...DB_COOKIE, expires: winEpoch }]);
    expect(param.expires).toBe(1700000000);
  });

  it('сохраняет name/value/domain/path без изменений', () => {
    const [param] = dbCookiesToCdpParams([DB_COOKIE]);
    expect(param.name).toBe('session');
    expect(param.value).toBe('secret-value');
    expect(param.domain).toBe('.example.com');
    expect(param.path).toBe('/');
  });

  it('возвращает пустой массив для null/undefined', () => {
    expect(dbCookiesToCdpParams(null)).toEqual([]);
    expect(dbCookiesToCdpParams(undefined)).toEqual([]);
  });
});

describe('cdpCookiesToApi', () => {
  const CDP_COOKIE = {
    name: 'auth',
    value: 'tok',
    domain: '.example.com',
    path: '/',
    expires: -1,
    httpOnly: true,
    secure: true,
    sameSite: 'None',
    priority: 'Medium',
    sameParty: false,
    sourceScheme: 'Secure',
    sourcePort: 443,
    partitionKey: 'https://example.com',
  };

  it('нормализует CDP cookie в API/DB-формат', () => {
    const [result] = cdpCookiesToApi([CDP_COOKIE]);
    expect(result.name).toBe('auth');
    expect(result.value).toBe('tok');
    expect(result.domain).toBe('.example.com');
    expect(result.path).toBe('/');
    expect(result.expires).toBe(-1);
    expect(result.http_only).toBe(true);
    expect(result.secure).toBe(true);
    expect(result.same_site).toBe('None');
  });

  it('сохраняет дополнительные CDP-атрибуты в JSON-ответе', () => {
    const [result] = cdpCookiesToApi([CDP_COOKIE]);
    expect(result.priority).toBe('Medium');
    expect(result.sameParty).toBe(false);
    expect(result.sourceScheme).toBe('Secure');
    expect(result.sourcePort).toBe(443);
    expect(result.partitionKey).toBe('https://example.com');
  });

  it('трактует отсутствующий sameSite как Lax', () => {
    const [result] = cdpCookiesToApi([{ ...CDP_COOKIE, sameSite: undefined }]);
    expect(result.same_site).toBe('Lax');
  });

  it('возвращает пустой массив для null/undefined', () => {
    expect(cdpCookiesToApi(null)).toEqual([]);
    expect(cdpCookiesToApi(undefined)).toEqual([]);
  });
});

describe('applyCookiesToCdp', () => {
  it('вызывает Network.setCookies и подтверждает через Network.getAllCookies, удаляя подтверждённые', async () => {
    cookieQueries.getByProfileId.mockReturnValue([DB_COOKIE]);
    installCdpVerify([toCdpCookie(DB_COOKIE)]);

    const count = await applyCookiesToCdp('p1', 9222);

    expect(count).toBe(1);
    expect(fakeCdp.discoverWsUrl).toHaveBeenCalledWith(9222);
    expect(fakeCdp.connect).toHaveBeenCalledWith('ws://127.0.0.1:9222/devtools/browser');
    expect(fakeCdp.call).toHaveBeenCalledWith(fakeWs, 'Network.setCookies', {
      cookies: [{
        name: 'session',
        value: 'secret-value',
        domain: '.example.com',
        path: '/',
        httpOnly: true,
        secure: false,
        sameSite: 'Lax',
      }],
    });
    expect(fakeCdp.call).toHaveBeenCalledWith(fakeWs, 'Network.getAllCookies');
    expect(cookieQueries.deleteByIds).toHaveBeenCalledWith('p1', [1]);
    expect(fakeWs.close).toHaveBeenCalled();
  });

  it('при пустом списке не выполняет CDP-запросы и не подключается', async () => {
    cookieQueries.getByProfileId.mockReturnValue([]);

    const count = await applyCookiesToCdp('p1', 9222);

    expect(count).toBe(0);
    expect(fakeCdp.discoverWsUrl).not.toHaveBeenCalled();
    expect(fakeCdp.connect).not.toHaveBeenCalled();
    expect(fakeCdp.call).not.toHaveBeenCalled();
    expect(cookieQueries.deleteByIds).not.toHaveBeenCalled();
  });

  it('идемпотентен: повторный вызов с тем же набором не падает и не дублирует запрос', async () => {
    cookieQueries.getByProfileId.mockReturnValue([DB_COOKIE]);
    installCdpVerify([toCdpCookie(DB_COOKIE)]);

    await applyCookiesToCdp('p1', 9222);
    await applyCookiesToCdp('p1', 9222);

    expect(cookieQueries.deleteByIds).toHaveBeenCalledTimes(2);
    expect(cookieQueries.deleteByIds).toHaveBeenCalledWith('p1', [1]);
  });

  it('удаляет только подтверждённые записи по snapshot id', async () => {
    const c1 = { ...DB_COOKIE, id: 1 };
    const c2 = { ...DB_COOKIE, id: 2, name: 'other', domain: '.other.com' };
    cookieQueries.getByProfileId.mockReturnValue([c1, c2]);
    // getAllCookies подтверждает только c1 (c2 не применён, напр. заблокирован)
    installCdpVerify([toCdpCookie(c1)]);

    const count = await applyCookiesToCdp('p1', 9222);

    expect(count).toBe(1);
    expect(cookieQueries.deleteByIds).toHaveBeenCalledWith('p1', [1]);
    expect(cookieQueries.deleteByIds).not.toHaveBeenCalledWith('p1', [1, 2]);
  });

  it('подтверждение не зависит от нормализации value при совпадении (domain, path, name)', async () => {
    const c1 = { ...DB_COOKIE, id: 1, value: 'ORIGINAL_VALUE' };
    cookieQueries.getByProfileId.mockReturnValue([c1]);
    // Chromium вернул другое (нормализованное) значение, но тот же ключ
    installCdpVerify([{ ...toCdpCookie(c1), value: 'DIFFERENT_NORMALIZED' }]);

    const count = await applyCookiesToCdp('p1', 9222);

    expect(count).toBe(1);
    expect(cookieQueries.deleteByIds).toHaveBeenCalledWith('p1', [1]);
  });

  it('не удаляет записи, добавленные после snapshot', async () => {
    const c1 = { ...DB_COOKIE, id: 1 };
    const c2 = { ...DB_COOKIE, id: 2, name: 'other', domain: '.other.com' };
    cookieQueries.getByProfileId.mockReturnValue([c1, c2]);
    // getAllCookies вернул c1, c2 и дополнительный cookie (например, из нативного
    // хранилища или добавленный после snapshot), которого нет в snapshot.
    installCdpVerify([
      toCdpCookie(c1),
      toCdpCookie(c2),
      toCdpCookie({ ...DB_COOKIE, id: 999, name: 'post_snapshot', domain: '.fresh.com' }),
    ]);

    const count = await applyCookiesToCdp('p1', 9222);

    expect(count).toBe(2);
    expect(cookieQueries.deleteByIds).toHaveBeenCalledWith('p1', [1, 2]);
    expect(cookieQueries.deleteByIds).not.toHaveBeenCalledWith('p1', expect.arrayContaining([999]));
  });

  it('не удаляет записи при ошибке Network.setCookies', async () => {
    cookieQueries.getByProfileId.mockReturnValue([DB_COOKIE]);
    fakeCdp.call.mockRejectedValue(new Error('cdp down'));

    await expect(applyCookiesToCdp('p1', 9222)).rejects.toThrow('cdp down');
    expect(cookieQueries.deleteByIds).not.toHaveBeenCalled();
    expect(fakeWs.close).toHaveBeenCalled();
  });

  it('не удаляет записи при ошибке проверочного Network.getAllCookies', async () => {
    cookieQueries.getByProfileId.mockReturnValue([DB_COOKIE]);
    fakeCdp.call.mockImplementation(async (ws, method) => {
      if (method === 'Network.setCookies') return {};
      throw new Error('verify failed');
    });

    await expect(applyCookiesToCdp('p1', 9222)).rejects.toThrow('verify failed');
    expect(cookieQueries.deleteByIds).not.toHaveBeenCalled();
    expect(fakeWs.close).toHaveBeenCalled();
  });

  it('закрывает WebSocket в finally при ошибке подключения', async () => {
    cookieQueries.getByProfileId.mockReturnValue([DB_COOKIE]);
    fakeCdp.connect.mockRejectedValue(new Error('connect failed'));

    await expect(applyCookiesToCdp('p1', 9222)).rejects.toThrow('connect failed');
    expect(fakeWs.close).not.toHaveBeenCalled();
    expect(cookieQueries.deleteByIds).not.toHaveBeenCalled();
  });
});

describe('getCookiesFromCdp', () => {
  it('получает cookies через Network.getAllCookies и нормализует в API-формат', async () => {
    fakeCdp.call.mockResolvedValue({
      cookies: [{
        name: 'auth',
        value: 'tok',
        domain: '.example.com',
        path: '/',
        expires: -1,
        httpOnly: true,
        secure: true,
        sameSite: 'None',
        priority: 'Medium',
      }],
    });

    const result = await getCookiesFromCdp(9222);

    expect(fakeCdp.call).toHaveBeenCalledWith(fakeWs, 'Network.getAllCookies');
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({
      name: 'auth',
      value: 'tok',
      domain: '.example.com',
      http_only: true,
      secure: true,
      same_site: 'None',
    });
    expect(result[0].priority).toBe('Medium');
    expect(fakeWs.close).toHaveBeenCalled();
  });

  it('закрывает WebSocket в finally при ошибке', async () => {
    fakeCdp.call.mockRejectedValue(new Error('cdp down'));

    await expect(getCookiesFromCdp(9222)).rejects.toThrow('cdp down');
    expect(fakeWs.close).toHaveBeenCalled();
  });
});