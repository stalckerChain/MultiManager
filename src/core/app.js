const express = require('express');
const { authMiddleware } = require('../api/auth');
const profilesRouter = require('../api/profiles');
const proxiesRouter = require('../api/proxies');
const cookiesRouter = require('../api/cookies');
const browserRouter = require('../api/browser');
const multiControlRouter = require('../api/multi-control');
const windowArrangerRouter = require('../api/window-arranger');
const extensionsRouter = require('../api/extensions');
const logsRouter = require('../api/logs');
const { setupWebSocket } = require('./websocket');

const app = express();

app.use(express.json());
app.use(authMiddleware);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/profiles', profilesRouter);
app.use('/api/proxies', proxiesRouter);
app.use('/api/cookies', cookiesRouter);
app.use('/api/browser', browserRouter);
app.use('/api/multi-control', multiControlRouter);
app.use('/api/window-arranger', windowArrangerRouter);
app.use('/api/extensions', extensionsRouter);
app.use('/api/logs', logsRouter);

app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

module.exports = { app, setupWebSocket };
