const { getDatabase, createCookieQueries } = require('../db');

// Тестовые швы: подменяют зависимости без сети, браузера и БД. Передача
// null/undefined восстанавливает оригинальные модули.
const originalCdpClient = require('../cdp/client');
let cdpClient = originalCdpClient;

function setCdpClientForTesting(mod) {
  cdpClient = mod == null ? originalCdpClient : mod;
}

let databaseProvider = getDatabase;
let cookieQueriesFactory = createCookieQueries;

function setDatabaseForTesting(db) {
  databaseProvider = db == null ? getDatabase : () => db;
}

function setCookieQueriesForTesting(factory) {
  cookieQueriesFactory = factory == null ? createCookieQueries : factory;
}

// Разница между Windows epoch (1601-01-01, микросекунды) и Unix epoch
// (1970-01-01, секунды) в микросекундах.
const WINDOWS_EPOCH_DELTA = 11644473600000000;

/**
 * Нормализовать значение expires в Unix epoch seconds.
 *
 * - `-1`, `0`, `null`, `undefined` → `null` (session-cookie: ключ expires
 *   в CookieParam опускается полностью).
 * - Значения > 1e16 считаем Windows epoch в микросекундах с 1601 года и
 *   переводим по формуле `(winEpoch - 11644473600000000) / 1000000`.
 * - Значения > 1e12 считаем Unix epoch в миллисекундах.
 * - Остальное — Unix epoch seconds как есть.
 *
 * @param {number|null|undefined} expires
 * @returns {number|null}
 */
function normalizeExpiresForCdp(expires) {
  if (expires == null || expires === -1 || expires === 0) return null;

  let value = Number(expires);
  if (value > 1e16) {
    value = (value - WINDOWS_EPOCH_DELTA) / 1000000;
  } else if (value > 1e12) {
    value = value / 1000;
  }
  return value;
}

/**
 * Преобразовать записи таблицы `cookies` в параметры CDP `Network.setCookies`.
 *
 * Явный маппинг полей БД:
 * - `http_only` (INTEGER 0/1) → boolean `httpOnly`;
 * - `secure` (INTEGER 0/1) → boolean `secure`;
 * - `same_site` `Lax`/`Strict` → одноимённые значения CDP, `NoRestriction`
 *   → `None`;
 * - `expires` нормализуется в Unix epoch seconds; для session-cookie ключ
 *   `expires` полностью исключается из параметра.
 *
 * @param {Array<object>} dbCookies - строки таблицы cookies
 * @returns {Array<object>} массив CDP CookieParam
 */
function dbCookiesToCdpParams(dbCookies) {
  return (dbCookies || []).map((c) => {
    const param = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      httpOnly: c.http_only ? true : false,
      secure: c.secure ? true : false,
    };

    if (c.same_site) {
      param.sameSite = c.same_site === 'NoRestriction' ? 'None' : c.same_site;
    }

    const expires = normalizeExpiresForCdp(c.expires);
    if (expires != null) {
      param.expires = expires;
    }

    return param;
  });
}

// Дополнительные атрибуты CDP-ответа, для которых нет колонок в схеме БД.
// Они не добавляются в БД, но сохраняются в JSON-ответе экспорта.
const CDP_EXTRA_KEYS = ['priority', 'sameParty', 'sourceScheme', 'sourcePort', 'partitionKey'];

/**
 * Преобразовать ответ `Network.getAllCookies` в формат, совместимый с
 * существующими полями таблицы/API: `name`, `value`, `domain`, `path`,
 * `expires`, `http_only`, `secure`, `same_site`. Дополнительные атрибуты CDP
 * (priority, sameParty, sourceScheme, sourcePort, partitionKey) сохраняются в
 * объекте для JSON-экспорта без изменения схемы БД.
 *
 * @param {Array<object>} cdpCookies - cookies из CDP-ответа
 * @returns {Array<object>}
 */
function cdpCookiesToApi(cdpCookies) {
  return (cdpCookies || []).map((c) => {
    const result = {
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path || '/',
      expires: c.expires,
      http_only: c.httpOnly === true,
      secure: c.secure === true,
      same_site: c.sameSite || 'Lax',
    };

    for (const key of CDP_EXTRA_KEYS) {
      if (c[key] !== undefined) result[key] = c[key];
    }

    return result;
  });
}

// Ключ cookie для сверки по (domain, path, name) без сравнения value:
// Chromium может нормализовать значение или не вернуть его в ожидаемом виде
// из-за Secure/SameSite-контекста.
function cookieKey(cookie) {
  return `${cookie.domain}\u0000${cookie.path || '/'}\u0000${cookie.name}`;
}

/**
 * Применить сохранённые cookies профиля через CDP `Network.setCookies`.
 *
 * Выполняется на browser-level WebSocket (без `Target.attachToTarget` и без
 * `sessionId`). Таблица `cookies` — очередь одноразового импорта:
 *
 * 1. Снимается snapshot записей очереди для профиля.
 * 2. `Network.setCookies` одним запросом (при пустом списке запрос не
 *    выполняется).
 * 3. `Network.getAllCookies` подтверждает применение только по ключу
 *    `(domain, path, name)`.
 * 4. Удаляются только подтверждённые записи по их DB `id` из snapshot. Записи,
 *    добавленные после snapshot, и не подтверждённые записи остаются.
 * 5. При ошибке установки или проверки не удаляется ни одна запись — очередь
 *    остаётся для повторной попытки при следующем запуске.
 *
 * WebSocket гарантированно закрывается в `finally`.
 *
 * @param {string} profileId
 * @param {number} port - CDP-порт профиля
 * @returns {Promise<number>} количество подтверждённо применённых cookies
 */
async function applyCookiesToCdp(profileId, port) {
  const db = databaseProvider();
  const cookieQueries = cookieQueriesFactory(db);
  const snapshot = cookieQueries.getByProfileId(profileId);

  if (snapshot.length === 0) return 0;

  const params = dbCookiesToCdpParams(snapshot);

  let ws = null;
  try {
    const wsUrl = await cdpClient.discoverWsUrl(port);
    ws = await cdpClient.connect(wsUrl);

    await cdpClient.call(ws, 'Network.setCookies', { cookies: params });

    const { cookies } = await cdpClient.call(ws, 'Network.getAllCookies');
    const present = new Set((cookies || []).map(cookieKey));

    const confirmed = snapshot.filter(c => present.has(cookieKey(c)));

    if (confirmed.length > 0) {
      cookieQueries.deleteByIds(profileId, confirmed.map(c => c.id));
    }

    return confirmed.length;
  } finally {
    if (ws) ws.close();
  }
}

/**
 * Получить актуальные cookies запущенного профиля через CDP
 * `Network.getAllCookies` и нормализовать в API/DB-формат.
 *
 * WebSocket гарантированно закрывается в `finally`.
 *
 * @param {number} port - CDP-порт профиля
 * @returns {Promise<Array<object>>}
 */
async function getCookiesFromCdp(port) {
  let ws = null;
  try {
    const wsUrl = await cdpClient.discoverWsUrl(port);
    ws = await cdpClient.connect(wsUrl);
    const { cookies } = await cdpClient.call(ws, 'Network.getAllCookies');
    return cdpCookiesToApi(cookies);
  } finally {
    if (ws) ws.close();
  }
}

module.exports = {
  normalizeExpiresForCdp,
  dbCookiesToCdpParams,
  cdpCookiesToApi,
  applyCookiesToCdp,
  getCookiesFromCdp,
  setCdpClientForTesting,
  setDatabaseForTesting,
  setCookieQueriesForTesting,
};
