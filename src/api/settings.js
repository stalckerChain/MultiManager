const express = require('express');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { getDatabase } = require('../db');
const { createSystemConfigQueries, createProfileQueries, createProjectQueries, createMatrixQueries } = require('../db/queries');
const { hasMasterKey, getMasterKeySource, getRecoveryKey, clearRecoveryKey, unlockWithPassword, rotateKey, generateMasterKey, generateRecoveryKey, setMasterKey, clearMasterKey } = require('../crypto');
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

router.get('/crypto-status', (req, res) => {
  res.json({
    source: getMasterKeySource() || 'none',
    hasKey: hasMasterKey(),
    hasPassword: getMasterKeySource() === 'password',
  });
});

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

router.post('/recovery-key', (req, res) => {
  const db = getDatabase();
  const key = getRecoveryKey(db);
  if (key) {
    clearRecoveryKey(db);
  }
  res.json({ recovery_key: key || '' });
});

router.post('/set-master-password', (req, res) => {
  const { password } = req.body;
  if (!password || password.length < 4) {
    return res.status(400).json({ error: 'Пароль должен быть минимум 4 символа' });
  }

  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  const salt = require('crypto').randomBytes(32);
  const key = require('../crypto').deriveKeyFromPassword(password, salt);
  const keyHash = require('crypto').createHash('sha256').update(key).digest();

  if (hasMasterKey()) {
    const oldKey = require('../crypto').getMasterKey();
    const profileQueries = createProfileQueries(db);
    require('../crypto').rotateKey(oldKey, key, db, profileQueries);
  }

  configQueries.set('master_key_source', 'password');
  configQueries.set('master_key_salt', salt.toString('hex'));
  configQueries.set('master_key_hash', keyHash.toString('hex'));

  const recovery = generateRecoveryKey(key);

  clearMasterKey();
  setMasterKey(key, 'password');

  logger.info('Master-пароль установлен');
  res.json({ status: 'success', recovery_key: recovery });
});

router.post('/change-master-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword || newPassword.length < 4) {
    return res.status(400).json({ error: 'Проверьте введённые пароли' });
  }

  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  const unlocked = unlockWithPassword(currentPassword, db);
  if (!unlocked) {
    return res.status(403).json({ error: 'Неверный текущий пароль' });
  }

  const oldKey = require('../crypto').getMasterKey();
  const salt = require('crypto').randomBytes(32);
  const key = require('../crypto').deriveKeyFromPassword(newPassword, salt);
  const keyHash = require('crypto').createHash('sha256').update(key).digest();

  const profileQueries = createProfileQueries(db);
  rotateKey(oldKey, key, db, profileQueries);

  configQueries.set('master_key_salt', salt.toString('hex'));
  configQueries.set('master_key_hash', keyHash.toString('hex'));

  const recovery = generateRecoveryKey(key);

  clearMasterKey();
  setMasterKey(key, 'password');

  logger.info('Мастер-пароль изменён');
  res.json({ status: 'success', recovery_key: recovery });
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
