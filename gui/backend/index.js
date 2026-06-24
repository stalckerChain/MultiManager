const http = require('http');
const { app, setupWebSocket } = require('./core/app');
const { logger } = require('./logger');
const { initDatabase } = require('./db');
const { setToken } = require('./api/auth');
const crypto = require('crypto');

const args = process.argv.slice(2);
const tokenArg = args.find(arg => arg.startsWith('--api-token='));
const portArg = args.find(arg => arg.startsWith('--port='));
const token = tokenArg ? tokenArg.split('=')[1] : crypto.randomBytes(32).toString('hex');
const port = portArg ? parseInt(portArg.split('=')[1], 10) : (process.env.PORT || 3000);

setToken(token);
initDatabase();

const server = http.createServer(app);
setupWebSocket(server);

server.listen(port, '127.0.0.1', () => {
  logger.info(`Core-движок запущен на http://127.0.0.1:${port}`);
  logger.info(`WebSocket доступен на ws://127.0.0.1:${port}/ws`);
  logger.info(`API Token: ${token}`);
});
