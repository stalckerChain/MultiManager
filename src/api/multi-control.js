const express = require('express');
const { exec, spawn } = require('child_process');
const { promisify } = require('util');
const { controller } = require('../multi-control');
const { cdpManager } = require('../multi-control/cdp-manager');
const { inputCapture, windowTracker } = require('../os-input');
const { getCdpPort } = require('./browser');
const path = require('path');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');
const extensionsApi = require('./extensions');
const { getBrowserDataDir } = require('../core/profile-path');

const execAsync = promisify(exec);

// PowerShell через spawn + -EncodedCommand — см. подробный комментарий
// в window-arranger.js. Кратко: Add-Type + here-string ломается при чтении
// скрипта из stdin (`-Command -`), а execAsync упирается в лимит длины
// командной строки cmd.exe (~8191 символов) для больших encoded-скриптов.
function toPSEncoded(script) {
  return Buffer.from(script, 'utf16le').toString('base64');
}

function runPowerShellScript(script) {
  return new Promise((resolve, reject) => {
    const child = spawn('powershell', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', toPSEncoded(script),
    ], { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`PowerShell exited with code ${code}: ${stderr || 'unknown error'}`));
    });
  });
}

const router = express.Router();

controller.cdp = cdpManager;

const pendingSync = new Set();
const attachedMasterTabs = new Set();

// Zerion popup reconciliation state
const pendingPopupReconciliations = new Map(); // key `${masterTargetId}:${slaveId}` -> entry
const createdPopupFallbackTargets = new Map(); // key `${masterTargetId}:${slaveId}` -> slaveTargetId — defensive, остаётся пустой пока fallback для Zerion запрещён (см. TASK Риски)
const POPUP_INITIAL_WAIT_MS = 2500;
const POPUP_POLL_INTERVAL_MS = 200;
const POPUP_RECONCILIATION_EXTRA_MS = 5500;
const runtimeIdCache = new Map(); // profileId -> { id, fetchedAt }
const RUNTIME_ID_CACHE_TTL_MS = 5000;

// PID foreground-окна мастера для фильтрации источника в /os-keyboard.
// Кэшируется до смены masterId: при stop() controller.masterId становится null,
// поэтому повторный старт (даже с тем же профилем) пересчитает значение.
let masterKeyboardPidCache = { masterId: null, pid: null };

function getMasterKeyboardPid() {
  const masterId = controller.masterId;
  if (masterKeyboardPidCache.masterId !== masterId) {
    let pid = null;
    if (masterId) {
      const db = getDatabase();
      const pq = createProfileQueries(db);
      const profile = pq.getById(masterId);
      pid = profile?.pid ?? null;
    }
    masterKeyboardPidCache = { masterId, pid };
  }
  return masterKeyboardPidCache.pid;
}

function getChromeExtensionInfo(url) {
  if (!url || typeof url !== 'string' || !url.startsWith('chrome-extension://')) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== 'chrome-extension:') return null;
    const extId = u.hostname;
    if (!/^[a-z]{32}$/.test(extId)) return null;
    return { extId, pathname: u.pathname || '/' };
  } catch {
    return null;
  }
}

async function getZerionRuntimeIdForProfile(profileId) {
  const cached = runtimeIdCache.get(profileId);
  if (cached && Date.now() - cached.fetchedAt < RUNTIME_ID_CACHE_TTL_MS) return cached.id;
  let resolved = null;
  try {
    const db = getDatabase();
    const pq = createProfileQueries(db);
    const profile = pq.getById(profileId);
    if (!profile) {
      runtimeIdCache.set(profileId, { id: null, fetchedAt: Date.now() });
      return null;
    }
    let extIds;
    try {
      extIds = JSON.parse(profile.extensions || '[]');
    } catch {
      runtimeIdCache.set(profileId, { id: null, fetchedAt: Date.now() });
      return null;
    }
    if (!Array.isArray(extIds) || extIds.length === 0) {
      runtimeIdCache.set(profileId, { id: null, fetchedAt: Date.now() });
      return null;
    }
    const folder = extIds[0];
    if (typeof folder !== 'string' || !folder) {
      runtimeIdCache.set(profileId, { id: null, fetchedAt: Date.now() });
      return null;
    }
    const extPath = path.join(extensionsApi.getExtensionsDir(), folder);
    const profileDir = getBrowserDataDir(profile);
    const runtimeId = await extensionsApi.resolveRuntimeId(extPath, profileDir);
    if (runtimeId && /^[a-z]{32}$/.test(runtimeId)) resolved = runtimeId;
    runtimeIdCache.set(profileId, { id: resolved, fetchedAt: Date.now() });
    return resolved;
  } catch (err) {
    logger.warn({ profileId, error: err.message }, 'Failed to resolve Zerion runtime ID');
    runtimeIdCache.set(profileId, { id: null, fetchedAt: Date.now() });
    return null;
  }
}

async function classifyMasterUrl(url) {
  if (!url || typeof url !== 'string') return 'http';
  if (url.startsWith('chrome-extension://')) {
    const info = getChromeExtensionInfo(url);
    if (!info) return 'unknown-extension';
    try {
      const runtimeId = await getZerionRuntimeIdForProfile(controller.masterId);
      if (!runtimeId) {
        logger.warn({ masterId: controller.masterId }, 'Could not resolve Zerion runtime ID for master');
        return 'unknown-extension';
      }
      if (info.extId === runtimeId) return 'zerion-popup';
      return 'unknown-extension';
    } catch (err) {
      logger.warn({ error: err.message }, 'Failed to classify chrome-extension URL');
      return 'unknown-extension';
    }
  }
  if (url.startsWith('http://') || url.startsWith('https://')) return 'http';
  return 'unknown-extension';
}

function registerPendingPopupSync(masterTargetId, masterUrl, slaveId, expectedPathname, slaveRuntimeId, masterRuntimeId) {
  const key = `${masterTargetId}:${slaveId}`;
  if (pendingPopupReconciliations.has(key)) return;
  pendingPopupReconciliations.set(key, {
    masterTargetId,
    masterUrl,
    slaveId,
    expectedPathname,
    slaveRuntimeId,
    masterRuntimeId,
    createdAt: Date.now(),
    expiresAt: Date.now() + POPUP_INITIAL_WAIT_MS + POPUP_RECONCILIATION_EXTRA_MS,
  });
  logger.info({ masterTargetId, slaveId, pathname: expectedPathname }, 'SYNC: registered pending popup reconciliation');
}

async function tryReconcileOnePending(key) {
  const entry = pendingPopupReconciliations.get(key);
  if (!entry) return false;
  if (Date.now() > entry.expiresAt) {
    pendingPopupReconciliations.delete(key);
    logger.warn({ masterTargetId: entry.masterTargetId, slaveId: entry.slaveId }, 'SYNC: pending popup reconciliation expired');
    return false;
  }
  let slaveTabs;
  try {
    slaveTabs = await cdpManager.getHttpTabs(entry.slaveId);
  } catch {
    return false;
  }
  const candidate = slaveTabs.find(t => {
    if (t.type !== 'page') return false;
    const info = getChromeExtensionInfo(t.url);
    if (!info) return false;
    if (entry.slaveRuntimeId && info.extId !== entry.slaveRuntimeId) return false;
    if (info.pathname !== entry.expectedPathname) return false;
    const bySlave = controller.tabMapping.get(entry.masterTargetId);
    const alreadyMapped = bySlave?.get(entry.slaveId);
    if (alreadyMapped === t.targetId) return false;
    return true;
  });
  if (!candidate) {
    const bySlaveCheck = controller.tabMapping.get(entry.masterTargetId);
    const existingCheck = bySlaveCheck?.get(entry.slaveId);
    if (existingCheck) {
      const existingTab = slaveTabs.find(t => t.targetId === existingCheck);
      if (existingTab) {
        const existingInfo = getChromeExtensionInfo(existingTab.url);
        if (existingInfo && existingInfo.extId === entry.slaveRuntimeId && existingInfo.pathname === entry.expectedPathname) {
          pendingPopupReconciliations.delete(key);
          return true;
        }
      }
    }
    return false;
  }
  try {
    await cdpManager.attachToExistingTarget(entry.slaveId, candidate.targetId);
  } catch (err) {
    logger.warn({ slaveId: entry.slaveId, error: err.message }, 'RECONCILE: attach failed');
    return false;
  }
  const bySlave = controller.tabMapping.get(entry.masterTargetId);
  const existingSlaveTargetId = bySlave ? bySlave.get(entry.slaveId) : null;
  const fallbackKey = `${entry.masterTargetId}:${entry.slaveId}`;
  let isFallback = existingSlaveTargetId && createdPopupFallbackTargets.get(fallbackKey) === existingSlaveTargetId;
  if (bySlave && existingSlaveTargetId && !isFallback) {
    const oldTab = slaveTabs.find(t => t.targetId === existingSlaveTargetId);
    if (oldTab) {
      const oldInfo = getChromeExtensionInfo(oldTab.url);
      if (oldInfo && oldInfo.extId === entry.slaveRuntimeId && oldInfo.pathname === entry.expectedPathname) {
        isFallback = true;
      }
    }
  }
  if (bySlave && existingSlaveTargetId) {
    if (isFallback) {
      try {
        cdpManager.closeTarget(entry.slaveId, existingSlaveTargetId);
        logger.info({ slaveId: entry.slaveId, oldTargetId: existingSlaveTargetId, newTargetId: candidate.targetId }, 'RECONCILE: closed erroneous fallback target');
      } catch (e) {
        logger.warn({ error: e.message }, 'RECONCILE: close fallback failed');
      }
      createdPopupFallbackTargets.delete(fallbackKey);
    }
    bySlave.set(entry.slaveId, candidate.targetId);
    logger.info({ slaveId: entry.slaveId, masterTargetId: entry.masterTargetId, newTargetId: candidate.targetId }, 'RECONCILE: in-place remapped to native popup');
  } else if (bySlave) {
    bySlave.set(entry.slaveId, candidate.targetId);
    logger.info({ slaveId: entry.slaveId, masterTargetId: entry.masterTargetId, newTargetId: candidate.targetId }, 'RECONCILE: remapped to native popup');
  } else {
    controller.mapTab(entry.masterTargetId, entry.slaveId, candidate.targetId);
    logger.info({ slaveId: entry.slaveId, masterTargetId: entry.masterTargetId, newTargetId: candidate.targetId }, 'RECONCILE: mapped late native popup');
  }
  if (entry.masterTargetId !== controller.activeMasterTab) {
    try {
      await controller._enforceSlaveFocusOnActiveTab(entry.slaveId);
    } catch (err) {
      logger.debug({ error: err.message }, 'RECONCILE: enforce focus failed');
    }
  }
  pendingPopupReconciliations.delete(key);
  return true;
}

async function reconcilePendingPopups() {
  if (pendingPopupReconciliations.size === 0) return;
  const keys = Array.from(pendingPopupReconciliations.keys());
  await Promise.all(keys.map(k => tryReconcileOnePending(k).catch(() => false)));
}

/**
 * Синхронизация нового таба мастера в слейвы.
 *
 * Для каждого слейва: создаёт таб через CDP, немедленно attach'ит его (антидетект
 * не шлёт Target.attachedToTarget), маппит и активирует. Также attach'ит таб в самом
 * мастере и переводит activeMasterTab на него (вновь открытый таб = активный).
 *
 * @param {string} masterTargetId - targetId нового таба мастера
 * @param {string} masterTabUrl - URL нового таба (для создания аналогичных в слейвах)
 */
async function syncNewMasterTab(masterTargetId, masterTabUrl) {
  if (!controller.active || !controller.masterId) return;
  if (pendingSync.has(masterTargetId)) return;
  pendingSync.add(masterTargetId);

  try {
    // Attach таб мастера (если ещё не подключён), чтобы на нём работал ввод
    if (!attachedMasterTabs.has(masterTargetId)) {
      const masterBc = cdpManager.browserConnections.get(controller.masterId);
      if (masterBc && !masterBc.targetSessions.has(masterTargetId)) {
        await cdpManager.attachToExistingTarget(controller.masterId, masterTargetId);
      }
      attachedMasterTabs.add(masterTargetId);
    }

    logger.info({ masterTargetId, url: masterTabUrl }, 'SYNC: discovered new master tab, syncing slaves');
    const urlType = await classifyMasterUrl(masterTabUrl);
    const slaves = Array.from(controller.slaves.keys());
    if (urlType === 'zerion-popup') {
      const info = getChromeExtensionInfo(masterTabUrl);
      const expectedPathname = info ? info.pathname : '/';
      const masterRuntimeId = await getZerionRuntimeIdForProfile(controller.masterId);
      await Promise.all(slaves.map(async (slaveId) => {
        try {
          const nativeTab = await _findNativeSlaveTab(slaveId, masterTabUrl);
          if (nativeTab) {
            await cdpManager.attachToExistingTarget(slaveId, nativeTab.targetId);
            controller.mapTab(masterTargetId, slaveId, nativeTab.targetId);
            if (masterTargetId !== controller.activeMasterTab) {
              await controller._enforceSlaveFocusOnActiveTab(slaveId);
            }
            logger.info({ slaveId, slaveTargetId: nativeTab.targetId }, 'SYNC: mapped existing native slave popup');
            const key = `${masterTargetId}:${slaveId}`;
            pendingPopupReconciliations.delete(key);
          } else {
            logger.warn({ slaveId, masterTargetId, url: masterTabUrl }, 'SYNC: Zerion popup not found in slave within timeout, not creating fallback tab');
            const slaveRuntimeId = await getZerionRuntimeIdForProfile(slaveId);
            registerPendingPopupSync(masterTargetId, masterTabUrl, slaveId, expectedPathname, slaveRuntimeId, masterRuntimeId);
          }
        } catch (err) {
          logger.error({ slaveId, error: err.message }, 'SYNC: failed to sync slave popup tab');
        }
      }));
    } else if (urlType === 'unknown-extension') {
      logger.warn({ masterTargetId, url: masterTabUrl }, 'SYNC: unknown chrome-extension URL, not creating fallback tab');
      const info = getChromeExtensionInfo(masterTabUrl);
      const expectedPathname = info ? info.pathname : '/';
      const masterRuntimeId = await getZerionRuntimeIdForProfile(controller.masterId);
      await Promise.all(slaves.map(async (slaveId) => {
        const slaveRuntimeId = await getZerionRuntimeIdForProfile(slaveId);
        registerPendingPopupSync(masterTargetId, masterTabUrl, slaveId, expectedPathname, slaveRuntimeId, masterRuntimeId);
      }));
    } else {
      await Promise.all(slaves.map(async (slaveId) => {
        try {
          const nativeTab = await _findNativeSlaveTab(slaveId, masterTabUrl);
          if (nativeTab) {
            await cdpManager.attachToExistingTarget(slaveId, nativeTab.targetId);
            controller.mapTab(masterTargetId, slaveId, nativeTab.targetId);
            if (masterTargetId !== controller.activeMasterTab) {
              await controller._enforceSlaveFocusOnActiveTab(slaveId);
            }
            logger.info({ slaveId, slaveTargetId: nativeTab.targetId }, 'SYNC: mapped existing native slave tab');
          } else {
            const slaveTargetId = await cdpManager.createTab(slaveId, masterTabUrl);
            if (slaveTargetId) {
              await cdpManager.attachToExistingTarget(slaveId, slaveTargetId);
              controller.mapTab(masterTargetId, slaveId, slaveTargetId);
              if (masterTargetId !== controller.activeMasterTab) {
                await controller._enforceSlaveFocusOnActiveTab(slaveId);
              }
              logger.info({ slaveId, slaveTargetId }, 'SYNC: created and mapped slave tab');
            }
          }
        } catch (err) {
          logger.error({ slaveId, error: err.message }, 'SYNC: failed to sync slave tab');
        }
      }));
    }
  } finally {
    pendingSync.delete(masterTargetId);
  }
}

/**
 * Поиск нативного таба в слейве, открытого от диспатченного ивента.
 *
 * В отличие от старой логики (сравнение /json с targetSessions), этот метод
 * сравнивает /json с уже замапленными в tabMapping табами слейва.
 *
 * Для Zerion-popup выполняет polling ~2–3 секунды с шагом 150–250 мс и
 * принимает только page-target, чей URL совпадает с ожидаемым Zerion extension
 * ID конкретного slave и pathname из master URL. Случайная немапленная
 * вкладка не принимается.
 *
 * Для обычных http(s) страниц сохраняет короткое ожидание (2 попытки, 150 мс).
 *
 * @param {string} slaveId
 * @param {string} expectedUrl - URL master-popup для режима Zerion
 * @returns {Promise<{targetId: string, url: string}|null>}
 */
async function _findNativeSlaveTab(slaveId, expectedUrl) {
  if (expectedUrl && expectedUrl.startsWith('chrome-extension://')) {
    const masterInfo = getChromeExtensionInfo(expectedUrl);
    if (masterInfo) {
      let isZerion = false;
      try {
        const masterRuntimeId = await getZerionRuntimeIdForProfile(controller.masterId);
        if (masterRuntimeId && masterInfo.extId === masterRuntimeId) isZerion = true;
      } catch (err) {
        logger.debug({ error: err.message }, 'Failed to check Zerion popup');
      }
      if (isZerion) {
        let slaveRuntimeId;
        try {
          slaveRuntimeId = await getZerionRuntimeIdForProfile(slaveId);
        } catch {
          slaveRuntimeId = null;
        }
        if (!slaveRuntimeId) {
          logger.warn({ slaveId }, 'Could not resolve Zerion runtime for slave');
          return null;
        }
        const expectedPathname = masterInfo.pathname;
        const attempts = Math.ceil(POPUP_INITIAL_WAIT_MS / POPUP_POLL_INTERVAL_MS);
        for (let attempt = 0; attempt < attempts; attempt++) {
          const slaveTabs = await cdpManager.getHttpTabs(slaveId);
          const mappedIds = _getMappedSlaveTabIds(slaveId);
          const candidate = slaveTabs.find(t => {
            if (t.type !== 'page') return false;
            if (mappedIds.has(t.targetId)) return false;
            const candInfo = getChromeExtensionInfo(t.url);
            if (!candInfo) return false;
            return candInfo.extId === slaveRuntimeId && candInfo.pathname === expectedPathname;
          });
          if (candidate) return candidate;
          if (attempt < attempts - 1) await new Promise(r => setTimeout(r, POPUP_POLL_INTERVAL_MS));
        }
        return null;
      } else {
        return null;
      }
    }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const slaveTabs = await cdpManager.getHttpTabs(slaveId);
    const mappedIds = _getMappedSlaveTabIds(slaveId);
    const candidate = slaveTabs.find(t => t.type === 'page' && !mappedIds.has(t.targetId));
    if (candidate) return candidate;
    if (attempt === 0) await new Promise(r => setTimeout(r, 150));
  }
  return null;
}

function _getMappedSlaveTabIds(slaveId) {
  const ids = new Set();
  for (const [, bySlave] of controller.tabMapping) {
    const tid = bySlave.get(slaveId);
    if (tid) ids.add(tid);
  }
  return ids;
}

let discovering = false;

/**
 * Обнаружение новых табов мастера через HTTP /json.
 *
 * Антидетект НЕ шлёт Target.targetCreated для нативно открытых табов через WS,
 * поэтому единственный надёжный источник — HTTP DevTools endpoint. Сравниваем
 * список табов из /json с уже подключёнными (targetSessions) мастера. Вновь
 * появившийся page-таб = новый активный таб (браузер автофокусирует его).
 */
async function discoverActiveTab() {
  if (!controller.active || !controller.masterId || discovering) return;
  discovering = true;
  try {
    const tabs = await cdpManager.getHttpTabs(controller.masterId);
    if (tabs.length === 0) {
      await reconcilePendingPopups().catch(() => {});
      return;
    }

    const masterBc = cdpManager.browserConnections.get(controller.masterId);
    const knownTargets = masterBc ? masterBc.targetSessions : null;

    // Новый таб = его ещё нет в targetSessions мастера
    const newTab = knownTargets
      ? tabs.find(t => !knownTargets.has(t.targetId))
      : tabs[0];

    if (newTab) {
      const urlType = await classifyMasterUrl(newTab.url);
      if (urlType === 'zerion-popup') {
        syncNewMasterTab(newTab.targetId, newTab.url).catch(err => logger.error({ error: err.message }, 'DISCOVERY: syncNewMasterTab failed'));
      } else {
        await syncNewMasterTab(newTab.targetId, newTab.url);
      }
    }
    await reconcilePendingPopups().catch(() => {});
  } catch (err) {
    logger.warn({ error: err.message }, 'DISCOVERY: getHttpTabs failed');
  } finally {
    discovering = false;
  }
}

// Listeners, зарегистрированные multi-control на singleton inputCapture.
// Ключ — имя события, значение — та же ссылка на функцию, которую передали в
// `inputCapture.on(...)`. Это позволяет снять ровно свои listeners через
// `inputCapture.off(name, handler)`, не трогая чужие и не вызывая
// `removeAllListeners()`. Listening monkey: mouse/wheel идут из CDP, клавиатура —
// из native hook через /os-keyboard и через inputCapture не проходит.
const inputListeners = new Map();

function wireInputToController() {
  if (inputListeners.size > 0) {
    logger.info('MULTI-CONTROL: Input already wired, skipping');
    return;
  }

  const handlers = {
    mouseMove: (event) => {
      if (controller.active) controller.onMouseMoved(event);
    },
    mouseDown: (event) => {
      if (controller.active) controller.onMousePressed(event);
    },
    mouseUp: (event) => {
      if (controller.active) controller.onMouseReleased(event);
    },
    scroll: (event) => {
      if (controller.active) controller.scrollTo(event);
    },
  };

  for (const [name, handler] of Object.entries(handlers)) {
    inputCapture.on(name, handler);
    inputListeners.set(name, handler);
  }
  logger.info('MULTI-CONTROL: Input wired to controller');
}

function unwireInputFromController() {
  if (inputListeners.size === 0) return;
  for (const [name, handler] of inputListeners) {
    inputCapture.off(name, handler);
  }
  inputListeners.clear();
  logger.info('MULTI-CONTROL: Input unwired from controller');
}

router.get('/status', (req, res) => {
  res.json(controller.getStatus());
});

router.post('/start', async (req, res) => {
  const { masterId } = req.body;

  if (!masterId) {
    return res.status(400).json({ error: 'Поле masterId обязательно' });
  }

  const port = getCdpPort(masterId);
  if (!port) {
    return res.status(412).json({ error: 'CDP порт недоступен. Убедитесь, что профиль запущен.' });
  }

  try {
    cdpManager.onEvent = (profileId, event, sessionId) => {
      if (profileId === masterId && controller.active) {
        logger.debug({
          eventType: event.type,
          sessionId,
          activeMasterTab: controller.activeMasterTab,
        }, 'MC-EVENT: received from master');

        if (event.type === 'tabActivated') {
          const targetId = cdpManager.targetBySid.get(sessionId);
          if (targetId) {
            controller.setActiveMasterTab(targetId);
          }
          return;
        }
        const targetId = cdpManager.targetBySid.get(sessionId);
        if (targetId) {
          controller.setActiveMasterTab(targetId);
        }
        inputCapture.injectFromCdp(event);
      }
    };

    cdpManager.onNewTab = async (profileId, targetInfo, newSession) => {
      if (!controller.active) return;

      if (profileId === masterId) {
        attachedMasterTabs.add(targetInfo.targetId);
        logger.info({ masterTargetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: master new tab tracked, waiting for activation');
        return;
      }

      if (getChromeExtensionInfo(targetInfo.url)) {
        logger.info({ slaveId: profileId, targetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: slave extension target detected, skipping tabIndex mapping');
        for (const [key, entry] of pendingPopupReconciliations) {
          if (entry.slaveId !== profileId) continue;
          const candInfo = getChromeExtensionInfo(targetInfo.url);
          if (!candInfo) continue;
          if (entry.slaveRuntimeId && candInfo.extId !== entry.slaveRuntimeId) continue;
          if (candInfo.pathname !== entry.expectedPathname) continue;
          try {
            await tryReconcileOnePending(key);
          } catch (err) {
            logger.debug({ error: err.message }, 'onNewTab reconcile failed');
          }
          break;
        }
        return;
      }

      const bc = cdpManager.browserConnections.get(profileId);
      if (bc) {
        const slaveIdx = bc.targetSessions.size - 1;
        const masterTargetId = controller.tabIndex[slaveIdx];
        if (masterTargetId) {
          controller.mapTab(masterTargetId, profileId, targetInfo.targetId);
          logger.info({ slaveId: profileId, masterTargetId, slaveTargetId: targetInfo.targetId, tabIndex: slaveIdx }, 'MULTI-CONTROL: mapped slave tab by tabIndex order');
        } else {
          logger.info({ profileId, targetId: targetInfo.targetId, url: targetInfo.url, slaveIdx }, 'MULTI-CONTROL: slave opened new tab (no matching master tab in tabIndex)');
        }
      }
    };

    cdpManager.onTabAttached = (profileId, targetInfo, newSession) => {
      if (!controller.active) return;
      if (profileId === masterId) return;
      if (getChromeExtensionInfo(targetInfo.url)) return;

      const bc = cdpManager.browserConnections.get(profileId);
      if (bc) {
        const slaveIdx = bc.targetSessions.size - 1;
        const masterTargetId = controller.tabIndex[slaveIdx];
        if (masterTargetId && masterTargetId !== controller.activeMasterTab) {
          controller._enforceSlaveFocusOnActiveTab(profileId).catch(err => {
            logger.error({ slaveId: profileId, error: err.message }, 'MULTI-CONTROL: _enforceSlaveFocusOnActiveTab failed after attach');
          });
          logger.info({ slaveId: profileId, masterTargetId, slaveTargetId: targetInfo.targetId }, 'MULTI-CONTROL: enforced focus on active tab after attach');
        }
      }
    };

    cdpManager.onNavigate = (profileId, navUrl, sessionId) => {
      if (profileId === masterId && controller.active) {
        logger.info({ masterId, url: navUrl, sessionId }, 'MULTI-CONTROL: master navigated, syncing to slaves');

        if (sessionId) {
          const masterTargetId = cdpManager.targetBySid.get(sessionId);
          if (masterTargetId) {
            controller.setActiveMasterTab(masterTargetId);
            let navigatedMapped = false;
            for (const [slaveId] of controller.slaves) {
              const slaveTargetId = controller.getSlaveTabForMaster(masterTargetId, slaveId);
              if (slaveTargetId) {
                const bc = cdpManager.browserConnections.get(slaveId);
                if (bc) {
                  const slaveSession = bc.targetSessions.get(slaveTargetId);
                  if (slaveSession) {
                    cdpManager.navigateToSession(slaveId, slaveSession.sessionId, navUrl);
                    logger.info({ slaveId, slaveTargetId, url: navUrl }, 'MULTI-CONTROL: navigated mapped slave tab');
                    navigatedMapped = true;
                    continue;
                  }
                }
              }
            }
            if (navigatedMapped) return;
          }
        }

        for (const [slaveId] of controller.slaves) {
          cdpManager.navigateTo(slaveId, navUrl);
        }
      }
    };

    cdpManager.onTabDestroyed = (profileId, targetId) => {
      if (!controller.active) {
        logger.warn({ profileId, targetId }, 'MC-DESTROYED: controller not active, skipping');
        return;
      }
      if (profileId === masterId) {
        const bySlave = controller.tabMapping.get(targetId);
        logger.info({
          masterTargetId: targetId,
          hasMapping: !!bySlave,
          slaveCount: bySlave ? bySlave.size : 0,
          activeMasterTab: controller.activeMasterTab,
        }, 'MC-DESTROYED: master tab destroyed');
        if (bySlave) {
          for (const [slaveId, slaveTargetId] of bySlave) {
            cdpManager.closeTarget(slaveId, slaveTargetId);
            logger.info({ slaveId, slaveTargetId, masterTargetId: targetId }, 'MC-DESTROYED: closed slave tab');
          }
        }
        controller.unmapTab(targetId);
        controller._maybeSwitchToPrevTab(targetId);
        logger.info({ targetId, newActiveTab: controller.activeMasterTab }, 'MC-DESTROYED: done');
      } else {
        controller._unmapBySlaveTargetId(targetId);
      }
    };

    cdpManager.onTabActivated = (profileId, targetId) => {
      if (profileId === masterId && controller.active) {
        controller.setActiveMasterTab(targetId);
        controller._syncActiveTabToSlaves(targetId);
      }
    };

    await cdpManager.connect(masterId, port, { enableInput: true });

    const db = getDatabase();
    const pq = createProfileQueries(db);
    const profile = pq.getById(masterId);
    if (profile) {
      cdpManager.setWindowTitle(masterId, `${profile.name} [MASTER]`);
    }

    controller.setMaster(masterId);

    wireInputToController();
    inputCapture.start();

    discoverActiveTab();
    controller._discoveryTimer = setInterval(discoverActiveTab, 300);
    logger.info('MULTI-CONTROL: CDP input capture started for master');

    res.json({ status: 'active', masterId, mode: 'cdp' });
  } catch (err) {
    // Если запуск упал уже после подключения listeners, не оставляем обработчики,
    // чтобы частично запущенный режим не дублировал события при следующем старте.
    inputCapture.stop();
    unwireInputFromController();
    logger.error({ err: err.message }, 'Multi-control: failed to start');
    res.status(500).json({ error: `Ошибка запуска: ${err.message}` });
  }
});

router.post('/stop', async (req, res) => {
  if (controller._discoveryTimer) {
    clearInterval(controller._discoveryTimer);
    controller._discoveryTimer = null;
  }
  pendingSync.clear();
  attachedMasterTabs.clear();
  pendingPopupReconciliations.clear();
  createdPopupFallbackTargets.clear();
  runtimeIdCache.clear();
  inputCapture.stop();
  unwireInputFromController();
  cdpManager.onEvent = null;
  cdpManager.onNavigate = null;
  cdpManager.onNewTab = null;
  cdpManager.onTabAttached = null;
  cdpManager.onTabDestroyed = null;
  cdpManager.onTabActivated = null;
  cdpManager.disconnectAll();
  controller.stop();
  logger.info('MULTI-CONTROL: STOPPED');
  res.json({ status: 'stopped' });
});

router.post('/slave/add', async (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }

  if (!controller.getStatus().active) {
    return res.status(409).json({ error: 'Multi-control не активен' });
  }

  const port = getCdpPort(profileId);
  if (!port) {
    return res.status(412).json({ error: `CDP порт недоступен для ${profileId}` });
  }

  try {
    await cdpManager.connect(profileId, port, { enableInput: false });

    const masterSession = cdpManager.sessions.get(controller.masterId);
    const slaveSession = cdpManager.sessions.get(profileId);
    if (masterSession && slaveSession) {
      controller.mapTab(masterSession.targetId, profileId, slaveSession.targetId);
      logger.info({ masterTargetId: masterSession.targetId, slaveId: profileId, slaveTargetId: slaveSession.targetId }, 'MULTI-CONTROL: mapped initial tabs');
    }

    const db = getDatabase();
    const pq = createProfileQueries(db);
    const profile = pq.getById(profileId);
    if (profile) {
      cdpManager.setWindowTitle(profileId, `${profile.name} [SYNC]`);
    }

    await controller.addSlave(profileId);
    res.json({ status: 'added', profileId, slaveCount: controller.getStatus().slaveCount });
  } catch (err) {
    logger.error({ err: err.message }, `Multi-control: failed to connect CDP to slave ${profileId}`);
    res.status(500).json({ error: `Ошибка подключения CDP: ${err.message}` });
  }
});

router.post('/slave/remove', (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }

  cdpManager.disconnect(profileId);
  controller.removeSlave(profileId);
  for (const key of Array.from(pendingPopupReconciliations.keys())) {
    if (key.endsWith(`:${profileId}`)) pendingPopupReconciliations.delete(key);
  }
  for (const key of Array.from(createdPopupFallbackTargets.keys())) {
    if (key.endsWith(`:${profileId}`)) createdPopupFallbackTargets.delete(key);
  }
  runtimeIdCache.delete(profileId);
  res.json({ status: 'removed', profileId });
});

router.post('/window-position', (req, res) => {
  const { profileId, x, y, width, height } = req.body;
  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }
  controller.setWindowPosition(profileId, x || 0, y || 0, width || 800, height || 600);
  res.json({ status: 'ok' });
});

router.get('/cdp-status', (req, res) => {
  const result = {};
  for (const [id] of controller.slaves) {
    result[id] = cdpManager.isConnected(id);
  }
  if (controller.masterId) {
    result[controller.masterId] = cdpManager.isConnected(controller.masterId);
  }
  res.json(result);
});

router.post('/os-keyboard', async (req, res) => {
  if (!controller.active) return res.json({ ok: true, skipped: 'inactive' });

  const event = req.body;

  // Native hook видит клавиатуру глобально: источник определяем по PID
  // foreground-окна из payload. Рассылаются только события, пришедшие из окна
  // master (PID master из профиля). Ввод из slave или событие с неизвестным PID
  // считаем локальным и не трогаем controller — иначе slave получит собственный
  // ввод повторно, а состояние клавиш рассинхронизируется.
  const masterPid = getMasterKeyboardPid();
  if (typeof event.sourcePid !== 'number' || event.sourcePid !== masterPid) {
    return res.json({ ok: true, skipped: 'source-not-master' });
  }

  logger.debug({
    type: event.type,
    activeMasterTab: controller.activeMasterTab,
    tabMappingSize: controller.tabMapping.size,
    hasActiveMapping: controller.activeMasterTab ? controller.tabMapping.has(controller.activeMasterTab) : false,
    slaveCount: controller.slaves.size,
  }, 'OS-KEYBOARD: received event');

  if (event.type === 'keyDown' && event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = (event.key || '').toLowerCase();

    if (key === 't') {
      logger.info('OS-KEYBOARD: Ctrl+T detected, letting browser handle natively (discoverActiveTab will sync)');
      return res.json({ ok: true, action: 'skip' });
    }

    if (key === 'w') {
      logger.info({ activeMasterTab: controller.activeMasterTab }, 'OS-KEYBOARD: Ctrl+W detected, closing slave tabs via CDP');
      const activeTab = controller.activeMasterTab;
      if (activeTab) {
        const bySlave = controller.tabMapping.get(activeTab);
        if (bySlave) {
          for (const [slaveId, slaveTargetId] of bySlave) {
            cdpManager.closeTarget(slaveId, slaveTargetId);
            logger.info({ slaveId, slaveTargetId, masterTargetId: activeTab }, 'OS-KEYBOARD: closed slave tab on Ctrl+W');
          }
        }
        controller.unmapTab(activeTab);
      }
      logger.info({
        activeMasterTab: controller.activeMasterTab,
        tabMappingHadEntry: !!controller.tabMapping.get(activeTab || ''),
      }, 'OS-KEYBOARD: Ctrl+W handling complete');
      // Browser сам закроет master-таб (preventDefault для KeyW удалён из sync script)
      return res.json({ ok: true, action: 'closeTab' });
    }
  }

  // Перед Enter убеждаемся, что activeMasterTab актуален. Антидетект не сообщает
  // о нативно открытых табах через WS, поэтому polling /json может отставать на
  // ≤300мс. Enter критичен (навигация по адресу/отправка формы), остальные клавиши
  // только накапливаются в адресной строке. Без этого Enter уходит в устаревший таб.
  if (event.type === 'keyDown' && event.key === 'Enter') {
    await discoverActiveTab();
  }

  if (event.type === 'keyDown') {
    controller.onKeyDown(event);
  } else if (event.type === 'keyUp') {
    controller.onKeyUp(event);
  } else if (event.type === 'charInput') {
    // Printable text, вычисленный native hook'ом (ToUnicodeEx) с учётом раскладки.
    // Не логируем содержимое текста.
    controller.onCharInput({ text: event.text || '' });
  }

  res.json({ ok: true });
});

async function focusWindowByPid(pid) {
  const platform = process.platform;
  try {
    if (platform === 'linux') {
      const { stdout } = await execAsync(`xdotool search --pid ${pid} 2>/dev/null | head -1`);
      const windowId = stdout.trim();
      if (windowId) await execAsync(`xdotool windowactivate ${windowId}`);
    } else if (platform === 'darwin') {
      const { stdout } = await execAsync(`ps -p ${pid} -o comm= 2>/dev/null`);
      const appName = stdout.trim().replace(/\.app\/.*$/, '.app');
      if (appName) await execAsync(`osascript -e 'tell application "${appName}" to activate'`);
    } else if (platform === 'win32') {
      const ps = `Add-Type @"
using System;
using System.Runtime.InteropServices;
public class WinFocus {
    public delegate bool EnumWindowsProc(IntPtr hWnd, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowsProc lpEnumFunc, IntPtr lParam);
    [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr hWnd);
    [DllImport("user32.dll")] static extern int GetWindowTextLength(IntPtr hWnd);
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hWnd);

    public static void Focus(uint targetPid) {
        EnumWindows(delegate(IntPtr hWnd, IntPtr lParam) {
            if (!IsWindowVisible(hWnd)) return true;
            int len = GetWindowTextLength(hWnd);
            if (len <= 0) return true;
            uint pid = 0;
            GetWindowThreadProcessId(hWnd, out pid);
            if (pid == targetPid) {
                SetForegroundWindow(hWnd);
                return false;
            }
            return true;
        }, IntPtr.Zero);
    }
}
"@
[WinFocus]::Focus(${pid})
`;
      await runPowerShellScript(ps);
    }
  } catch (err) {
    logger.error({ err: err.message, pid }, 'Error focusing window by PID');
  }
}

router.post('/focus-windows', async (req, res) => {
  try {
    const db = getDatabase();
    const pq = createProfileQueries(db);
    const masterId = controller.masterId;
    const slaveIds = Array.from(controller.slaves.keys());
    const allIds = [...slaveIds, masterId].filter(Boolean);
    const pidMap = new Map();

    for (const id of allIds) {
      const profile = pq.getById(id);
      if (profile?.pid) pidMap.set(id, profile.pid);
    }

    for (const id of slaveIds) {
      const pid = pidMap.get(id);
      if (pid) {
        await focusWindowByPid(pid);
        await new Promise(r => setTimeout(r, 100));
      }
    }

    if (masterId) {
      const pid = pidMap.get(masterId);
      if (pid) {
        await new Promise(r => setTimeout(r, 150));
        await focusWindowByPid(pid);
      }
    }

    logger.info({ slavePids: slaveIds.filter(id => pidMap.has(id)).length, masterPid: pidMap.has(masterId) }, 'MULTI-CONTROL: focused sync windows by PID');
    res.json({ focused: true });
  } catch (err) {
    logger.error({ err: err.message }, 'MULTI-CONTROL: focus-windows failed');
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.wireInputToController = wireInputToController;
module.exports.unwireInputFromController = unwireInputFromController;
module.exports.getChromeExtensionInfo = getChromeExtensionInfo;
module.exports.getZerionRuntimeIdForProfile = getZerionRuntimeIdForProfile;
module.exports.classifyMasterUrl = classifyMasterUrl;
module.exports._findNativeSlaveTab = _findNativeSlaveTab;
module.exports.syncNewMasterTab = syncNewMasterTab;
module.exports.discoverActiveTab = discoverActiveTab;
module.exports.reconcilePendingPopups = reconcilePendingPopups;
module.exports.pendingPopupReconciliations = pendingPopupReconciliations;
module.exports.createdPopupFallbackTargets = createdPopupFallbackTargets;
module.exports.pendingSync = pendingSync;
module.exports.attachedMasterTabs = attachedMasterTabs;
