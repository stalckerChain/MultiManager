let apiToken = null;

function setToken(token) {
  apiToken = token;
}

function getToken() {
  return apiToken;
}

function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const token = authHeader.slice(7);
  
  if (token !== apiToken) {
    return res.status(401).json({ error: 'Invalid token' });
  }

  next();
}

module.exports = { setToken, getToken, authMiddleware };
