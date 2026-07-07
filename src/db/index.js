const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const { logger } = require('../logger');
const { createTables, migrateTables } = require('./schema');
const { createProfileQueries, createProxyQueries, createCookieQueries, createLogQueries, createTaskQueries, createSystemConfigQueries } = require('./queries');

let db = null;

function getDbPath() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;
  
  if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'CloakManager', 'app.db');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CloakManager', 'app.db');
  } else {
    return path.join(home, '.config', 'CloakManager', 'app.db');
  }
}

function initDatabase() {
  if (db) return db;

  const dbPath = getDbPath();
  const dir = path.dirname(dbPath);
  
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(dbPath);
  
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  createTables(db);
  migrateTables(db);

  logger.info(`База данных инициализирована: ${dbPath}`);
  
  return db;
}

function getDatabase() {
  if (!db) {
    throw new Error('База данных не инициализирована. Вызовите initDatabase()');
  }
  return db;
}

function closeDatabase() {
  if (db) {
    db.close();
    db = null;
    logger.info('База данных закрыта');
  }
}

module.exports = { 
  initDatabase, 
  getDatabase, 
  closeDatabase, 
  getDbPath,
  createProfileQueries,
  createProxyQueries,
  createCookieQueries,
  createLogQueries,
  createTaskQueries,
  createSystemConfigQueries,
};
