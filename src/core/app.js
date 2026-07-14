const express = require('express');
const { authMiddleware } = require('../api/auth');
const { logger } = require('../logger');
const profilesRouter = require('../api/profiles');
const proxiesRouter = require('../api/proxies');
const cookiesRouter = require('../api/cookies');
const browserRouter = require('../api/browser');
const multiControlRouter = require('../api/multi-control');
const windowArrangerRouter = require('../api/window-arranger');
const extensionsRouter = require('../api/extensions');
const logsRouter = require('../api/logs');
const fingerprintRouter = require('../api/fingerprint');
const { router: internalRouter } = require('../api/internal');
const settingsRouter = require('../api/settings');
const { createProjectsRouter } = require('../api/projects');
const { createMatrixRouter } = require('../api/matrix');
const { createRunsRouter } = require('../api/runs');
const { createInternalRunsRouter } = require('../api/internal-runs');
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
app.use('/api/fingerprint', fingerprintRouter);
app.use('/api/internal', internalRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/projects', createProjectsRouter());
app.use('/api/matrix', createMatrixRouter());
app.use('/api/runs', createRunsRouter());
app.use('/api/internal/runs', createInternalRunsRouter());

app.use((err, req, res, next) => {
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled server error');
  res.status(500).json({ error: 'Внутренняя ошибка сервера' });
});

module.exports = { app, setupWebSocket };
