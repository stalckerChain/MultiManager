const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getDatabase } = require('../db');
const { createSystemConfigQueries, createProjectQueries, createMatrixQueries } = require('../db/queries');
const { setToken, notifyToken } = require('./auth');
const { closeAllWebSocketClients } = require('../core/websocket');
const { logger } = require('../logger');

function resolvePath(p) {
  if (!p || typeof p !== 'string') return '';
  p = p.trim();
  if (p.startsWith('~')) {
    p = path.join(os.homedir(), p.slice(1));
  }
  return path.resolve(p);
}

const router = express.Router();

router.post('/api-token/regenerate', (req, res) => {
  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);
  const newToken = crypto.randomBytes(32).toString('hex');

  configQueries.set('api_token', newToken);
  setToken(newToken);
  closeAllWebSocketClients();
  notifyToken(newToken);

  logger.info('API token regenerated');
  res.json({ token: newToken });
});

router.get('/automation', (req, res) => {
  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  const rawPath = configQueries.get('stAuto0_path') || '';
  const rawPython = configQueries.get('python_path') || '';

  const defaultStAuto0 = path.join(os.homedir(), 'AI', 'stAuto0');
  const defaultPython = path.join(os.homedir(), 'AI', 'stAuto0', 'venv', 'Scripts', 'python.exe');

  const stAuto0Path = resolvePath(rawPath) || resolvePath(defaultStAuto0);
  const pythonPath = resolvePath(rawPython) || resolvePath(defaultPython);
  const parallelLimit = parseInt(configQueries.get('parallel_limit'), 10) || 2;

  let availableProjects = [];
  if (stAuto0Path) {
    const projectsDir = path.join(stAuto0Path, 'projects');
    try {
      if (fs.existsSync(projectsDir)) {
        availableProjects = fs.readdirSync(projectsDir)
          .filter(f => f.endsWith('.py'))
          .map(f => f.replace(/\.py$/, ''));
      }
    } catch {
      availableProjects = [];
    }
  }

  res.json({ stAuto0Path, pythonPath, parallelLimit, availableProjects });
});

router.put('/automation', (req, res) => {
  let { stAuto0Path, pythonPath, parallelLimit } = req.body;

  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  stAuto0Path = resolvePath(stAuto0Path) || resolvePath('~/AI/stAuto0');
  pythonPath = resolvePath(pythonPath) || resolvePath('~/AI/stAuto0/venv/Scripts/python.exe');

  configQueries.set('stAuto0_path', stAuto0Path);
  configQueries.set('python_path', pythonPath);
  if (parallelLimit !== undefined) configQueries.set('parallel_limit', String(parallelLimit));

  logger.info({ stAuto0Path, pythonPath, parallelLimit }, 'Настройки автоматизации сохранены');
  res.json({ status: 'success', syncResult: { added: 0, removed: 0, total: 0 } });
});

// --- CloakBrowser Version ---

const { detectVersionFromCache, getCloakBrowserVersion, DEFAULT_VERSION } = require('../core/cloakbrowser-version');

router.get('/cloakbrowser-version', (req, res) => {
  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  const manual = configQueries.get('cloakbrowser_version') || '';
  const detected = detectVersionFromCache();
  const current = getCloakBrowserVersion((key) => configQueries.get(key));

  res.json({
    manual,
    detected,
    current,
    default: DEFAULT_VERSION,
  });
});

router.put('/cloakbrowser-version', (req, res) => {
  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  const { version } = req.body;

  if (version && !/^\d+\.\d+\.\d+/.test(version)) {
    return res.status(400).json({ error: 'Невалидный формат версии. Ожидается: major.minor.patch (например 146.0.7680)' });
  }

  if (version) {
    configQueries.set('cloakbrowser_version', version);
  } else {
    configQueries.del('cloakbrowser_version');
  }

  const current = getCloakBrowserVersion((key) => configQueries.get(key));
  logger.info({ version: current }, 'CloakBrowser version updated');

  res.json({ status: 'success', version: current });
});

module.exports = router;
