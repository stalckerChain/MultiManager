const http = require('http');
const { app, setupWebSocket } = require('./core/app');
const { logger } = require('./logger');
const { initDatabase, getDatabase } = require('./db');
const { setToken } = require('./api/auth');
const { initMasterKey, hasMasterKey } = require('./crypto');
const { performBackup } = require('./backup');
const crypto = require('crypto');

const args = process.argv.slice(2);
const tokenArg = args.find(arg => arg.startsWith('--api-token='));
const portArg = args.find(arg => arg.startsWith('--port='));
const token = tokenArg ? tokenArg.split('=')[1] : crypto.randomBytes(32).toString('hex');
const port = portArg ? parseInt(portArg.split('=')[1], 10) : (process.env.PORT || 3000);

setToken(token);
initDatabase();

const db = getDatabase();
performBackup(db).catch(err => logger.warn(`Hot backup пропущен (некритично): ${err.message}`));
initMasterKey(db).then(() => {
  if (hasMasterKey()) {
    logger.info('Master-ключ инициализирован');
  } else {
    logger.warn('Master-ключ не инициализирован — режим ожидания пароля');
  }
});

const staleProfiles = db.prepare("SELECT id FROM profiles WHERE status IN ('running', 'starting')").all();
if (staleProfiles.length > 0) {
  db.prepare("UPDATE profiles SET status = 'stopped', pid = NULL WHERE status IN ('running', 'starting')").run();
  logger.info(`Сброшены ${staleProfiles.length} профилей со старыми статусами`);
}

const server = http.createServer(app);
setupWebSocket(server);

server.listen(port, '127.0.0.1', () => {
  logger.info(`Core-движок запущен на http://127.0.0.1:${port}`);
  logger.info(`WebSocket доступен на ws://127.0.0.1:${port}/ws`);
});
