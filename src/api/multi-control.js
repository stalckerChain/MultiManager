const express = require('express');
const { controller } = require('../multi-control');
const { cdpManager } = require('../multi-control/cdp-manager');
const { getCdpPort } = require('./browser');
const { getDatabase, createProfileQueries } = require('../db');
const { logger } = require('../logger');

const router = express.Router();

controller.cdp = cdpManager;

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
    cdpManager.onEvent = (profileId, event) => {
      logger.info({
        profileId,
        eventType: event.type,
        masterId: controller.masterId,
        active: controller.active,
        matchMaster: profileId === controller.masterId,
      }, 'MULTI-CONTROL: onEvent received');

      if (profileId !== controller.masterId) {
        logger.info({ profileId, masterId: controller.masterId }, 'MULTI-CONTROL: onEvent SKIPPED — not master');
        return;
      }
      if (!controller.active) {
        logger.info({ profileId }, 'MULTI-CONTROL: onEvent SKIPPED — controller not active');
        return;
      }

      logger.info({ profileId, eventType: event.type }, 'MULTI-CONTROL: onEvent DISPATCHING');
      switch (event.type) {
        case 'mouseMove': controller.onMouseMoved(event); break;
        case 'mouseDown': controller.onMousePressed(event); break;
        case 'mouseUp': controller.onMouseReleased(event); break;
        case 'click': controller.onClick(event); break;
        case 'scroll': controller.scrollTo(event); break;
        case 'keyDown': controller.onKeyDown(event); break;
        case 'keyUp': controller.onKeyUp(event); break;
        default: logger.warn({ eventType: event.type }, 'MULTI-CONTROL: unknown event type');
      }
    };
    logger.info('MULTI-CONTROL: onEvent callback assigned to cdpManager');

    await cdpManager.connect(masterId, port, { enableInput: true });

    const db = getDatabase();
    const pq = createProfileQueries(db);
    const profile = pq.getById(masterId);
    if (profile) {
      cdpManager.setWindowTitle(masterId, `${profile.name} [MASTER]`);
    }

    controller.setMaster(masterId);
    res.json({ status: 'active', masterId });
  } catch (err) {
    logger.error({ err: err.message }, 'Multi-control: failed to connect CDP to master');
    res.status(500).json({ error: `Ошибка подключения CDP: ${err.message}` });
  }
});

router.post('/stop', async (req, res) => {
  cdpManager.onEvent = null;
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

module.exports = router;
