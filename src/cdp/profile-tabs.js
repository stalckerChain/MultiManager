const { logger } = require('../logger');

const DEFAULT_WS_TIMEOUT = 10000;

// Тестовые швы: подменяют CDP-клиент и провайдер порта без сети и браузера.
// Передача null/undefined восстанавливает оригинальные зависимости.
const originalCdpClient = require('../cdp/client');
let cdpClient = originalCdpClient;

const originalCdpPortProvider = require('../api/browser').getCdpPort;
let cdpPortProvider = originalCdpPortProvider;

function setCdpClientForTesting(mod) {
  cdpClient = mod == null ? originalCdpClient : mod;
}

function setCdpPortProviderForTesting(fn) {
  cdpPortProvider = fn == null ? originalCdpPortProvider : fn;
}

/**
 * Краткоживущая CDP-сессия, явно привязанная к profileId.
 *
 * Порт берётся из экспортированного метода `getCdpPort(profileId)`, а не через
 * внутренние `browserConnections` CdpManager. Это позволяет выполнять массовые
 * операции с вкладками без пересечения с mapping master/slave multi-control.
 *
 * WebSocket гарантированно закрывается в finally.
 *
 * @param {string} profileId
 * @param {(ws: WebSocket) => Promise<T>} fn
 * @returns {Promise<T>}
 * @template T
 */
async function withProfileSession(profileId, fn) {
  const port = cdpPortProvider(profileId);
  if (!port) {
    throw new Error(`CDP port is unavailable for profile ${profileId}`);
  }

  let ws = null;
  try {
    const wsUrl = await cdpClient.discoverWsUrl(port);
    ws = await cdpClient.connect(wsUrl, { timeout: DEFAULT_WS_TIMEOUT });
    return await fn(ws);
  } catch (err) {
    // Сообщение не логируется: оно может содержать URL (например, CDP-ошибку навигации).
    logger.warn({ profileId }, 'profile-tabs: CDP session failed');
    throw err;
  } finally {
    if (ws) ws.close();
  }
}

/**
 * Получить page targets браузера профиля.
 *
 * @param {WebSocket} ws
 * @returns {Promise<Array<{targetId: string, url: string, type: string}>>}
 */
async function listPageTargets(ws) {
  const { targetInfos = [] } = await cdpClient.call(ws, 'Target.getTargets');
  return targetInfos.filter(
    (t) => t.type === 'page' && !(t.url || '').startsWith('devtools://')
  );
}

/**
 * Создать вкладку с указанным URL. URL передаётся только параметром CDP,
 * в логи и сообщения об ошибках не попадает.
 *
 * @param {WebSocket} ws
 * @param {string} url
 * @returns {Promise<string>} targetId
 */
async function createTarget(ws, url) {
  const { targetId } = await cdpClient.call(ws, 'Target.createTarget', { url }, { timeout: DEFAULT_WS_TIMEOUT });
  return targetId;
}

/**
 * Закрыть вкладку по её targetId.
 *
 * @param {WebSocket} ws
 * @param {string} targetId
 * @returns {Promise<boolean>}
 */
async function closeTarget(ws, targetId) {
  const { success } = await cdpClient.call(ws, 'Target.closeTarget', { targetId }, { timeout: DEFAULT_WS_TIMEOUT });
  return success === true;
}

/**
 * Удобные обёртки, открывающие собственную сессию на одну операцию.
 * Для пакетных операций предпочтителен `withProfileSession` + примитивы,
 * чтобы не плодить WebSocket-соединения на каждый таб.
 */

async function getPageTargets(profileId) {
  return withProfileSession(profileId, (ws) => listPageTargets(ws));
}

async function createTab(profileId, url) {
  return withProfileSession(profileId, (ws) => createTarget(ws, url));
}

async function closeTab(profileId, targetId) {
  return withProfileSession(profileId, (ws) => closeTarget(ws, targetId));
}

/**
 * Дождаться, пока в списке page-targets останется только targetId,
 * или до истечения timeoutMs. Возвращает таргеты, которые ещё остались.
 * URL не логируются.
 *
 * @param {WebSocket} ws
 * @param {string} targetId
 * @param {number} timeoutMs
 * @returns {Promise<Array<{targetId: string, url: string, type: string}>>}
 */
async function waitUntilSinglePageTarget(ws, targetId, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const targets = await listPageTargets(ws);
    const others = targets.filter((t) => t.targetId !== targetId);
    if (others.length === 0) return [];
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  return (await listPageTargets(ws)).filter((t) => t.targetId !== targetId);
}

/**
 * Привести профиль к состоянию с одной чистой вкладкой `about:blank`.
 *
 * Вся операция выполняется внутри одного вызова `withProfileSession`, чтобы
 * не открывать несколько CDP WebSocket-сессий. Порядок: сначала создаётся
 * новая `about:blank` вкладка, затем закрываются все остальные page-targets.
 * `devtools://` targets не закрываются. WebSocket гарантированно закрывается
 * в `finally` внутри `withProfileSession`. URL не логируются.
 *
 * Частичная ошибка закрытия не прерывает операцию: ошибки собираются в
 * `errors`, закрытие остальных вкладок продолжается.
 *
 * @param {string} profileId
 * @returns {Promise<{closed: number, kept: number, errors: Array<{targetId: string, error: string}>}>}
 */
async function resetToSingleBlankTab(profileId) {
  return withProfileSession(profileId, async (ws) => {
    const blankId = await createTarget(ws, 'about:blank');

    const targets = await listPageTargets(ws);
    const errors = [];
    let closed = 0;

    for (const target of targets) {
      if (target.targetId === blankId) continue;
      try {
        const ok = await closeTarget(ws, target.targetId);
        if (ok) {
          closed++;
        } else {
          errors.push({ targetId: target.targetId, error: 'closeTarget returned false' });
        }
      } catch (err) {
        errors.push({ targetId: target.targetId, error: err.message });
      }
    }

    // Ожидание фактического удаления закрытых вкладок: Target.closeTarget
    // подтверждает только приём команды, уничтожение таргета асинхронно.
    // Если следующий шаг (например, открытие информационной вкладки) увидит
    // ещё живую старую about:blank, он может навигировать вкладку, которая
    // вот-вот закроется, и итоговая страница останется пустой.
    const remaining = await waitUntilSinglePageTarget(ws, blankId, DEFAULT_WS_TIMEOUT);
    if (remaining.length > 0) {
      for (const target of remaining) {
        if (target.targetId === blankId) continue;
        errors.push({ targetId: target.targetId, error: 'target not destroyed within timeout' });
      }
    }

    return { closed, kept: 1, errors };
  });
}

module.exports = {
  withProfileSession,
  listPageTargets,
  createTarget,
  closeTarget,
  getPageTargets,
  createTab,
  closeTab,
  resetToSingleBlankTab,
  waitUntilSinglePageTarget,
  setCdpClientForTesting,
  setCdpPortProviderForTesting,
};
