const express = require('express');
const rateLimit = require('express-rate-limit');
const { authMiddleware } = require('../api/auth');
const { hasMasterKey } = require('../crypto');
const { logger } = require('../logger');
const { ApiError } = require('../api/errors');

function requireMasterKey(req, res, next) {
  if (!hasMasterKey() && req.method !== 'GET') {
    return res.status(503).json({ error: 'Master key not initialized', code: 'MASTER_KEY_NOT_READY' });
  }
  next();
}
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

app.use(express.json({ limit: '1mb' }));

const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Слишком много запросов', code: 'RATE_LIMIT' },
  skip: (req) => req.path === '/health',
});

app.use('/api/', apiLimiter);
app.use(authMiddleware);

app.get('/health', (req, res) => {
  res.json({ status: 'ok' });
});

app.use('/api/profiles', requireMasterKey, profilesRouter);
app.use('/api/proxies', requireMasterKey, proxiesRouter);
app.use('/api/cookies', requireMasterKey, cookiesRouter);
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
  if (err instanceof ApiError) {
    return res.status(err.status).json(err.toJSON());
  }
  logger.error({ err: err.message, stack: err.stack }, 'Unhandled server error');
  res.status(500).json({ error: 'Внутренняя ошибка сервера', code: 'INTERNAL_ERROR' });
});

module.exports = { app, setupWebSocket };
