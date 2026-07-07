const path = require('path');
const fs = require('fs');
const { logger, getAppDir } = require('../logger');

const BACKUP_DIR = 'backups';
const RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

function getBackupDir() {
  return path.join(getAppDir(), BACKUP_DIR);
}

function cleanupOldBackups(backupDir) {
  if (!fs.existsSync(backupDir)) return;
  const now = Date.now();
  let deleted = 0;
  for (const file of fs.readdirSync(backupDir)) {
    if (!file.startsWith('app_') || !file.endsWith('.db')) continue;
    const filePath = path.join(backupDir, file);
    try {
      if (now - fs.statSync(filePath).mtimeMs > RETENTION_MS) {
        fs.unlinkSync(filePath);
        deleted++;
      }
    } catch (err) {
      logger.warn(`Ошибка удаления ${file}: ${err.message}`);
    }
  }
  if (deleted > 0) logger.info(`Удалено старых бэкапов: ${deleted}`);
}

async function performBackup(db) {
  const backupDir = getBackupDir();
  if (!fs.existsSync(backupDir)) {
    fs.mkdirSync(backupDir, { recursive: true });
  }

  const now = new Date();
  const dateStr = now.getFullYear().toString() +
    String(now.getMonth() + 1).padStart(2, '0') +
    String(now.getDate()).padStart(2, '0') + '_' +
    String(now.getHours()).padStart(2, '0') +
    String(now.getMinutes()).padStart(2, '0') +
    String(now.getSeconds()).padStart(2, '0');
  const backupPath = path.join(backupDir, `app_${dateStr}.db`);

  try {
    await db.backup(backupPath);
    logger.info(`Hot backup создан: ${backupPath}`);
    cleanupOldBackups(backupDir);
    return backupPath;
  } catch (err) {
    logger.error(`Ошибка hot backup: ${err.message}`);
    throw err;
  }
}

module.exports = { performBackup, cleanupOldBackups, getBackupDir };
