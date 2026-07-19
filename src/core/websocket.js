const { WebSocketServer } = require('ws');
const { logger } = require('../logger');

let wss = null;
const clients = new Set();

function getToken() {
  return require('../api/auth').getToken();
}

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws, req) => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const token = url.searchParams.get('token') || '';
    const expectedToken = getToken();

    if (!expectedToken || token !== expectedToken) {
      ws.close(4401, 'Unauthorized');
      return;
    }

    clients.add(ws);
    logger.info({ total: clients.size }, 'WebSocket client connected');

    ws.on('close', () => {
      clients.delete(ws);
      logger.info({ total: clients.size }, 'WebSocket client disconnected');
    });

    ws.on('error', () => {
      clients.delete(ws);
    });
  });

  return wss;
}

function broadcast(data) {
  const msg = JSON.stringify(data);
  for (const client of clients) {
    if (client.readyState === 1) {
      client.send(msg);
    }
  }
}

function broadcastStatus(profileId, status, pid = null) {
  broadcast({ type: 'status', profileId, status, pid });
}

function broadcastLog(profileId, level, message) {
  broadcast({ type: 'log', profileId, level, message, timestamp: Date.now() });
}

module.exports = { setupWebSocket, broadcast, broadcastStatus, broadcastLog };
