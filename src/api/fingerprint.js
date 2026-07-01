const express = require('express');
const { generateFingerprint } = require('../fingerprint');

const router = express.Router();

router.post('/generate', (req, res) => {
  const { platform } = req.body;

  if (!platform) {
    return res.status(400).json({ error: 'Обязательное поле: platform' });
  }

  const fingerprint = generateFingerprint(platform);
  res.json(fingerprint);
});

module.exports = router;
