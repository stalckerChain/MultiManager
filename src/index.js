const { app } = require('./core/app');
const { logger } = require('./logger');

const PORT = process.env.PORT || 3000;

app.listen(PORT, '127.0.0.1', () => {
  logger.info(`Core-движок запущен на http://127.0.0.1:${PORT}`);
});
