const express = require('express');
const { controller } = require('../multi-control');

const router = express.Router();

router.get('/status', (req, res) => {
  res.json(controller.getStatus());
});

router.post('/start', (req, res) => {
  const { masterId } = req.body;

  if (!masterId) {
    return res.status(400).json({ error: 'Поле masterId обязательно' });
  }

  controller.setMaster(masterId, null);
  res.json({ status: 'active', masterId });
});

router.post('/stop', (req, res) => {
  controller.stop();
  res.json({ status: 'stopped' });
});

router.post('/slave/add', (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }

  if (!controller.getStatus().active) {
    return res.status(409).json({ error: 'Multi-control не активен' });
  }

  controller.addSlave(profileId, null);
  res.json({ status: 'added', profileId, slaveCount: controller.getStatus().slaveCount });
});

router.post('/slave/remove', (req, res) => {
  const { profileId } = req.body;

  if (!profileId) {
    return res.status(400).json({ error: 'Поле profileId обязательно' });
  }

  controller.removeSlave(profileId);
  res.json({ status: 'removed', profileId });
});

router.post('/mouse/move', async (req, res) => {
  try {
    await controller.onMouseMoved(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mouse/click', async (req, res) => {
  try {
    await controller.onClick(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mouse/scroll', async (req, res) => {
  try {
    await controller.scrollTo(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/keyboard/type', async (req, res) => {
  try {
    const { text, delay } = req.body;
    if (text) {
      await controller.broadcastToSlaves('Input.insertText', { text });
    }
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/keyboard/key', async (req, res) => {
  try {
    await controller.onKeyDown(req.body);
    await controller.onKeyUp(req.body);
    res.json({ status: 'ok' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
