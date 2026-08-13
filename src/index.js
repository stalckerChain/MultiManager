const http = require('http');
const { app, setupWebSocket } = require('./core/app');
const { logger, cleanupRunLogs } = require('./logger');
const { initDatabase, getDatabase } = require('./db');
const { createSystemConfigQueries } = require('./db/queries');
const { setToken, notifyToken, resolveToken } = require('./api/auth');
const { performBackup } = require('./backup');
const crypto = require('crypto');

const args = process.argv.slice(2);
const tokenArg = args.find(arg => arg.startsWith('--api-token='));
const portArg = args.find(arg => arg.startsWith('--port='));
const explicitToken = tokenArg ? tokenArg.split('=')[1] : (process.env.API_TOKEN || null);
const port = portArg ? parseInt(portArg.split('=')[1], 10) : (process.env.PORT || 3000);

initDatabase();

const db = getDatabase();
const systemConfigQueries = createSystemConfigQueries(db);

// Приоритет источников токена: --api-token= → API_TOKEN → system_config.api_token → новая генерация.
const { token } = resolveToken({
  explicitToken,
  configQueries: systemConfigQueries,
  generate: () => crypto.randomBytes(32).toString('hex'),
});

setToken(token);
notifyToken(token);

// Сначала sync-операции, до async
const staleProfiles = db.prepare("SELECT id FROM profiles WHERE status IN ('running', 'starting')").all();
if (staleProfiles.length > 0) {
  db.prepare("UPDATE profiles SET status = 'stopped', pid = NULL WHERE status IN ('running', 'starting')").run();
  logger.info(`Сброшены ${staleProfiles.length} профилей со старыми статусами`);
}

// Затем async-операции
performBackup(db).catch(err => logger.warn(`Hot backup пропущен (некритично): ${err.message}`));

// Очистка старых run-логов при старте приложения (без отдельного процесса)
try {
  const result = cleanupRunLogs({ activeRunId: null });
  if (result.removed > 0) {
    logger.info(`Очищены устаревшие run-логи: ${result.removed} каталогов, освобождено ${result.freedBytes} байт`);
  }
} catch (err) {
  logger.warn(`Очистка run-логов при старте не удалась: ${err.message}`);
}

const server = http.createServer(app);
setupWebSocket(server);

server.listen(port, '127.0.0.1', () => {
  logger.info(`Core-движок запущен на http://127.0.0.1:${port}`);
  logger.info(`WebSocket доступен на ws://127.0.0.1:${port}/ws`);
});
