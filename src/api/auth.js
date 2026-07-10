const crypto = require('crypto');

const state = { apiToken: null };

function setToken(token) {
  state.apiToken = token;
}

function getToken() {
  return state.apiToken;
}

function authMiddleware(req, res, next) {
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

module.exports = { setToken, getToken, authMiddleware };
