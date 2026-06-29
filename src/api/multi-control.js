const express = require('express');
const { controller } = require('../multi-control');
const { cdpManager } = require('../multi-control/cdp-manager');
const { inputCapture, windowTracker } = require('../os-input');
const { getCdpPort } = require('./browser');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');

const router = express.Router();

controller.cdp = cdpManager;

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
        logger.info({ masterTargetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: master opened new tab, syncing to slaves');

        for (const [slaveId] of controller.slaves) {
          try {
            const slaveTargetId = await cdpManager.createTab(slaveId);
            if (slaveTargetId) {
              controller.mapTab(targetInfo.targetId, slaveId, slaveTargetId);
              if (targetInfo.url && !targetInfo.url.startsWith('chrome://')) {
                cdpManager.navigateToSession(slaveId, cdpManager.sessionBySid.get(Array.from(cdpManager.browserConnections.get(slaveId)?.targetSessions?.keys() || [])[0]) || '', targetInfo.url);
              }
            }
          } catch (err) {
            logger.error({ slaveId, error: err.message }, 'MULTI-CONTROL: failed to create tab in slave');
          }
        }
        return;
      }

      logger.info({ profileId, targetId: targetInfo.targetId, url: targetInfo.url }, 'MULTI-CONTROL: slave opened new tab (detected)');
    };

    cdpManager.onNavigate = (profileId, navUrl, sessionId) => {
      if (profileId === masterId && controller.active) {
        logger.info({ masterId, url: navUrl, sessionId }, 'MULTI-CONTROL: master navigated, syncing to slaves');

        if (sessionId) {
          const masterTargetId = cdpManager.targetBySid.get(sessionId);
          if (masterTargetId) {
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

    logger.info('MULTI-CONTROL: CDP input capture started for master');
    res.json({ status: 'active', masterId, mode: 'cdp' });
  } catch (err) {
    logger.error({ err: err.message }, 'Multi-control: failed to start');
    res.status(500).json({ error: `Ошибка запуска: ${err.message}` });
  }
});

router.post('/stop', async (req, res) => {
  inputCapture.stop();
  cdpManager.onEvent = null;
  cdpManager.onNavigate = null;
  cdpManager.onNewTab = null;
  cdpManager.onTabDestroyed = null;
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

  if (event.type === 'keyDown' && event.ctrlKey && !event.altKey && !event.metaKey) {
    const key = (event.key || '').toLowerCase();

    if (key === 't') {
      logger.info('OS-KEYBOARD: Ctrl+T detected — letting master handle natively, onNewTab will sync');
      return res.json({ ok: true, action: 'letMasterHandle' });
    }

    if (key === 'w') {
      logger.info('OS-KEYBOARD: Ctrl+W detected — skipping (close tab not supported)');
      return res.json({ ok: true, action: 'skip' });
    }
  }

  if (event.type === 'keyDown') {
    controller.onKeyDown(event);
  } else if (event.type === 'keyUp') {
    controller.onKeyUp(event);
  }

  res.json({ ok: true });
});

module.exports = router;
