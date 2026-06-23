const { app } = require('./core/app');
const { logger } = require('./logger');
const { initDatabase } = require('./db');
const { setToken } = require('./api/auth');
const crypto = require('crypto');

const args = process.argv.slice(2);
const tokenArg = args.find(arg => arg.startsWith('--api-token='));
const token = tokenArg ? tokenArg.split('=')[1] : crypto.randomBytes(32).toString('hex');

setToken(token);
initDatabase();

const PORT = process.env.PORT || 3000;

app.listen(PORT, '127.0.0.1', () => {
  logger.info(`Core-движок запущен на http://127.0.0.1:${PORT}`);
  logger.info(`API Token: ${token}`);
});
