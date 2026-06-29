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
    cdpManager.onEvent = (profileId, event) => {
      if (profileId === masterId && controller.active) {
        inputCapture.injectFromCdp(event);
      }
    };

    cdpManager.onNavigate = (profileId, url) => {
      if (profileId === masterId && controller.active) {
        logger.info({ masterId, url }, 'MULTI-CONTROL: master navigated, syncing to slaves');
        for (const [slaveId] of controller.slaves) {
          cdpManager.navigateTo(slaveId, url);
        }
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

router.post('/os-keyboard', (req, res) => {
  if (!controller.active) return res.json({ ok: true, skipped: 'inactive' });

  const event = req.body;
  logger.info({ type: event.type, key: event.key, ctrl: event.ctrlKey, alt: event.altKey, slaveCount: controller.slaves.size }, 'OS-KEYBOARD received');

  if (event.type === 'keyDown') {
    controller.onKeyDown(event);
  } else if (event.type === 'keyUp') {
    controller.onKeyUp(event);
  }

  res.json({ ok: true });
});

module.exports = router;
