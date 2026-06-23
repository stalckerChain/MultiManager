const { WebSocketServer } = require('ws');

let wss = null;
const clients = new Set();

function setupWebSocket(server) {
  wss = new WebSocketServer({ server, path: '/ws' });

  wss.on('connection', (ws) => {
    clients.add(ws);
    console.log(`WebSocket client connected. Total: ${clients.size}`);

    ws.on('close', () => {
      clients.delete(ws);
      console.log(`WebSocket client disconnected. Total: ${clients.size}`);
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
