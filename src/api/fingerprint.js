const express = require('express');
const { getDatabase, createSystemConfigQueries } = require('../db');
const { generateFingerprint } = require('../fingerprint');
const { getCloakBrowserVersion } = require('../core/cloakbrowser-version');

const router = express.Router();

router.post('/generate', (req, res) => {
  const { platform } = req.body;

  if (!platform) {
    return res.status(400).json({ error: 'Обязательное поле: platform' });
  }

  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);
  const chromeVersion = getCloakBrowserVersion((key) => configQueries.get(key));

  const fingerprint = generateFingerprint(platform, chromeVersion);
  res.json(fingerprint);
});

module.exports = router;
