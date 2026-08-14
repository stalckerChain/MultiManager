const { call, connect, discoverWsUrl } = require('../cdp/client');
const { getCdpPort } = require('../api/browser');
const { logger } = require('../logger');

const DEFAULT_WS_TIMEOUT = 10000;

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
  const port = getCdpPort(profileId);
  if (!port) {
    throw new Error(`CDP port is unavailable for profile ${profileId}`);
  }

  let ws = null;
  try {
    const wsUrl = await discoverWsUrl(port);
    ws = await connect(wsUrl, { timeout: DEFAULT_WS_TIMEOUT });
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
  const { targetInfos = [] } = await call(ws, 'Target.getTargets');
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
  const { targetId } = await call(ws, 'Target.createTarget', { url }, { timeout: DEFAULT_WS_TIMEOUT });
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
  const { success } = await call(ws, 'Target.closeTarget', { targetId }, { timeout: DEFAULT_WS_TIMEOUT });
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

module.exports = {
  withProfileSession,
  listPageTargets,
  createTarget,
  closeTarget,
  getPageTargets,
  createTab,
  closeTab,
};
