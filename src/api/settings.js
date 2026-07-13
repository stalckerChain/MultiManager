const express = require('express');
const { getDatabase } = require('../db');
const { createSystemConfigQueries, createProfileQueries } = require('../db/queries');
const { hasMasterKey, getMasterKeySource, getRecoveryKey, clearRecoveryKey, setupPasswordMode, unlockWithPassword, rotateKey, generateMasterKey, generateRecoveryKey, setMasterKey, clearMasterKey } = require('../crypto');
const { logger } = require('../logger');

const router = express.Router();

router.get('/crypto-status', (req, res) => {
  res.json({
    source: getMasterKeySource() || 'none',
    hasKey: hasMasterKey(),
    hasPassword: getMasterKeySource() === 'password',
  });
});

router.get('/recovery-key', (req, res) => {
  const db = getDatabase();
  const key = getRecoveryKey(db);
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
  configQueries.set('recovery_key', recovery);

  clearMasterKey();
  setMasterKey(key, 'password');

  logger.info('Master-пароль установлен');
  res.json({ status: 'success' });
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
  configQueries.set('recovery_key', recovery);

  clearMasterKey();
  setMasterKey(key, 'password');

  logger.info('Мастер-пароль изменён');
  res.json({ status: 'success' });
});

router.get('/automation', (req, res) => {
  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  const stAuto0Path = configQueries.get('stAuto0_path') || '';
  const pythonPath = configQueries.get('python_path') || 'python3';
  const parallelLimit = parseInt(configQueries.get('parallel_limit'), 10) || 2;

  let availableProjects = [];
  if (stAuto0Path) {
    const fs = require('fs');
    const path = require('path');
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
  const { stAuto0Path, pythonPath, parallelLimit } = req.body;

  const db = getDatabase();
  const configQueries = createSystemConfigQueries(db);

  if (stAuto0Path !== undefined) configQueries.set('stAuto0_path', stAuto0Path);
  if (pythonPath !== undefined) configQueries.set('python_path', pythonPath);
  if (parallelLimit !== undefined) configQueries.set('parallel_limit', String(parallelLimit));

  logger.info({ stAuto0Path, pythonPath, parallelLimit }, 'Настройки автоматизации сохранены');
  res.json({ status: 'success' });
});

module.exports = router;
