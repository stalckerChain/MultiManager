const crypto = require('crypto');

const state = { apiToken: null };

function setToken(token) {
  state.apiToken = token;
}

function getToken() {
  return state.apiToken;
}

function resolveToken({ explicitToken, configQueries, generate }) {
  if (explicitToken) {
    return { token: explicitToken, generated: false };
  }
  const saved = configQueries.get('api_token');
  if (saved) {
    return { token: saved, generated: false };
  }
  const token = generate();
  configQueries.set('api_token', token);
  return { token, generated: true };
}

function notifyToken(token) {
  if (typeof process.send === 'function') {
    try {
      process.send({ type: 'api-token', token });
    } catch (e) {
      // ignore: standalone/CI run without IPC channel
    }
  }
}

function authMiddleware(req, res, next) {
  if (!state.apiToken) {
    return res.status(503).json({ error: 'Service unavailable: token not initialized' });
  }

  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);

  if (token.length !== state.apiToken.length ||
      !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(state.apiToken))) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

module.exports = { setToken, getToken, notifyToken, authMiddleware, resolveToken };
