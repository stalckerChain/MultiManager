const pino = require('pino');
const path = require('path');
const fs = require('fs');

function getAppDir() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'CloakManager');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CloakManager');
  } else {
    return path.join(home, '.config', 'CloakManager');
  }
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

const appDir = getAppDir();
ensureDir(appDir);
ensureDir(path.join(appDir, 'logs'));

const targets = [
  {
    target: 'pino/file',
    options: { destination: path.join(appDir, 'logs', 'core.log'), mkdir: true },
    level: 'info',
  },
  {
    target: 'pino/file',
    options: { destination: 1 },
    level: 'info',
  },
];

if (process.env.NODE_ENV !== 'production') {
  targets.unshift({
    target: 'pino-pretty',
    options: {},
    level: 'info',
  });
}

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: { targets },
});

function createProfileLogger(profileId) {
  const logsDir = path.join(appDir, 'logs');
  ensureDir(logsDir);

  const logFile = path.join(logsDir, `profile_${profileId}.log`);
  const stream = fs.createWriteStream(logFile, { flags: 'a' });

  return pino({
    level: 'debug',
  }, stream);
}

module.exports = { logger, createProfileLogger, getAppDir };
