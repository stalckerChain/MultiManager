const express = require('express');
const { controller } = require('../multi-control');
const { cdpManager } = require('../multi-control/cdp-manager');
const { inputCapture, windowTracker } = require('../os-input');
const { getCdpPort } = require('./browser');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');

const router = express.Router();

controller.cdp = cdpManager;

const pendingSync = new Set();
const attachedMasterTabs = new Set();

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

    // Если маппинг уже есть (таб синхронизирован ранее) — только обновляем активный
    if (controller.tabMapping.has(masterTargetId)) {
      if (masterTargetId !== controller.activeMasterTab) {
        controller.setActiveMasterTab(masterTargetId);
      }
      return;
    }

    logger.info({ masterTargetId, url: masterTabUrl }, 'SYNC: discovered new master tab, syncing slaves');
    for (const [slaveId] of controller.slaves) {
      try {
        // Сначала ищем нативный таб в слейве — мог открыться от диспатченного ивента.
        // Делаем 2 попытки с паузой, т.к. браузер может не успеть открыть таб сразу.
        let nativeTab = null;
        for (let attempt = 0; attempt < 2; attempt++) {
          const slaveTabs = await cdpManager.getHttpTabs(slaveId);
          const slaveBc = cdpManager.browserConnections.get(slaveId);
          const slaveKnown = slaveBc ? slaveBc.targetSessions : null;
          nativeTab = slaveKnown
            ? slaveTabs.find(t => t.type === 'page' && !slaveKnown.has(t.targetId))
            : null;
          if (nativeTab) break;
          if (attempt === 0) await new Promise(r => setTimeout(r, 150));
        }

        if (nativeTab) {
          await cdpManager.attachToExistingTarget(slaveId, nativeTab.targetId);
          controller.mapTab(masterTargetId, slaveId, nativeTab.targetId);
          logger.info({ slaveId, slaveTargetId: nativeTab.targetId }, 'SYNC: mapped existing native slave tab');
        } else {
          const slaveTargetId = await cdpManager.createTab(slaveId, masterTabUrl);
          if (slaveTargetId) {
            await cdpManager.attachToExistingTarget(slaveId, slaveTargetId);
            controller.mapTab(masterTargetId, slaveId, slaveTargetId);
            logger.info({ slaveId, slaveTargetId }, 'SYNC: created and mapped slave tab');
          }
        }
      } catch (err) {
        logger.error({ slaveId, error: err.message }, 'SYNC: failed to sync slave tab');
      }
    }
    controller.setActiveMasterTab(masterTargetId);
    controller._syncActiveTabToSlaves(masterTargetId);
  } finally {
    pendingSync.delete(masterTargetId);
  }
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
    if (tabs.length === 0) return;

    const masterBc = cdpManager.browserConnections.get(controller.masterId);
    const knownTargets = masterBc ? masterBc.targetSessions : null;

    // Новый таб = его ещё нет в targetSessions мастера
    const newTab = knownTargets
      ? tabs.find(t => !knownTargets.has(t.targetId))
      : tabs[0];

    if (newTab) {
      await syncNewMasterTab(newTab.targetId, newTab.url);
    }
  } catch (err) {
    logger.warn({ error: err.message }, 'DISCOVERY: getHttpTabs failed');
  } finally {
    discovering = false;
  }
}

function wireInputToController() {
  inputCapture.on('mouseMove', (event) => {
    if (!controller.active) return;
    controller.onMouseMoved(event);
  });

  inputCapture.on('mouseDown', (event) => {
    if (!controller.active) return;
    controller.onMousePressed(event);
  });

  inputCapture.on('mouseUp', (event) => {
    if (!controller.active) return;
    controller.onMouseReleased(event);
  });

  inputCapture.on('scroll', (event) => {
    if (!controller.active) return;
    controller.scrollTo(event);
  });

  inputCapture.on('keyDown', (event) => {
    if (!controller.active) return;
    controller.onKeyDown(event);
  });

  inputCapture.on('keyUp', (event) => {
    if (!controller.active) return;
    controller.onKeyUp(event);
  });

  inputCapture.on('charInput', (event) => {
    if (!controller.active) return;
    controller.onCharInput(event);
  });

  logger.info('MULTI-CONTROL: Input wired to controller');
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
        if (event.type === 'tabActivated') {
          return;
        }

        const targetId = cdpManager.targetBySid.get(sessionId);
        if (targetId && !['mouseUp', 'mouseMove', 'scroll', 'keyUp', 'charInput'].includes(event.type)) {
          controller.setActiveMasterTab(targetId);
        }
        inputCapture.injectFromCdp(event);
      }
    };

    cdpManager.onNewTab = async (profileId, targetInfo, newSession) => {
      if (!controller.active) return;

      if (profileId === masterId) {
        attachedMasterTabs.add(targetInfo.targetId);
        controller.setActiveMasterTab(targetInfo.targetId);
        logger.info({ masterTargetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: master new tab tracked, slave sync deferred to syncNewMasterTab');
        return;
      }

      if (controller.activeMasterTab) {
        controller.mapTab(controller.activeMasterTab, profileId, targetInfo.targetId);
        logger.info({ slaveId: profileId, masterTargetId: controller.activeMasterTab, slaveTargetId: targetInfo.targetId }, 'MULTI-CONTROL: mapped slave tab from targetCreated');
      } else {
        logger.info({ profileId, targetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: slave opened new tab (no active master tab to map)');
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
      if (!controller.active) return;
      if (profileId === masterId) {
        controller.unmapTab(targetId);
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
  inputCapture.stop();
  cdpManager.onEvent = null;
  cdpManager.onNavigate = null;
  cdpManager.onNewTab = null;
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

  logger.info({
    type: event.type,
    key: event.key,
    activeMasterTab: controller.activeMasterTab,
    tabMappingSize: controller.tabMapping.size,
    hasActiveMapping: controller.activeMasterTab ? controller.tabMapping.has(controller.activeMasterTab) : false,
    slaveCount: controller.slaves.size,
  }, 'OS-KEYBOARD: received event');

  if (event.type === 'keyDown' && event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = (event.key || '').toLowerCase();

    if (key === 't') {
      logger.info('OS-KEYBOARD: Ctrl+T detected, creating master tab (syncNewMasterTab will handle slaves)');
      try {
        const masterTargetId = await cdpManager.createTab(controller.masterId);
        if (masterTargetId) {
          await syncNewMasterTab(masterTargetId, 'about:blank');
          logger.info({ masterTargetId }, 'OS-KEYBOARD: created master tab');
        }
      } catch (err) {
        logger.error({ error: err.message }, 'OS-KEYBOARD: failed to create tab in master');
      }
      return res.json({ ok: true, action: 'createTab' });
    }

    if (key === 'w') {
      logger.info('OS-KEYBOARD: Ctrl+W detected — skipping (close tab not supported)');
      return res.json({ ok: true, action: 'skip' });
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
  }

  res.json({ ok: true });
});

module.exports = router;
