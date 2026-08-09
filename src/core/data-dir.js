const path = require('path');

const DATA_DIR_ENV = 'MULTIMANAGER_DATA_DIR';
const APP_NAME = 'MultiManager';

function getDataDir() {
  const overrideDir = process.env[DATA_DIR_ENV];
  if (overrideDir !== undefined) {
    if (overrideDir === '' || typeof overrideDir !== 'string' || !path.isAbsolute(overrideDir)) {
      throw new Error(`MULTIMANAGER_DATA_DIR must be an absolute path, received: "${overrideDir}"`);
    }
    return path.resolve(overrideDir);
  }

  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'win32') {
    return path.join(process.env.APPDATA || path.join(home, 'AppData', 'Roaming'), APP_NAME);
  }
  if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', APP_NAME);
  }
  return path.join(home, '.config', APP_NAME);
}

module.exports = { getDataDir };