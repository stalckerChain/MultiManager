const { fork } = require('child_process');
const net = require('net');
const crypto = require('crypto');
const path = require('path');
const kill = require('tree-kill');

let coreProcess = null;
let corePort = 3000;
let coreToken = crypto.randomBytes(32).toString('hex');

const CORE_PATH = path.join(__dirname, '..', '..', '..', 'src', 'index.js');

function checkPort(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, '127.0.0.1', () => {
      server.close(() => resolve(true));
    });
    server.on('error', () => resolve(false));
  });
}

async function findFreePort(start = 3000, end = 3100) {
  for (let port = start; port <= end; port++) {
    if (await checkPort(port)) {
      return port;
    }
  }
  throw new Error(`Нет свободных портов в диапазоне ${start}-${end}`);
}

async function startCore() {
  corePort = await findFreePort();

  const args = [
    CORE_PATH,
    `--api-token=${coreToken}`,
    `PORT=${corePort}`,
  ];

  coreProcess = fork(CORE_PATH, [
    `--api-token=${coreToken}`,
  ], {
    env: { ...process.env, PORT: corePort },
    stdio: 'pipe',
  });

  coreProcess.on('error', (err) => {
    console.error('Core process error:', err);
  });

  coreProcess.on('exit', (code) => {
    console.log(`Core process exited with code ${code}`);
    coreProcess = null;
  });

  await new Promise(resolve => setTimeout(resolve, 1000));

  return corePort;
}

function stopCore() {
  if (coreProcess) {
    kill(coreProcess.pid, 'SIGTERM', (err) => {
      if (err) {
        console.error('Error stopping core:', err);
      }
    });
    coreProcess = null;
  }
}

function getCorePort() {
  return corePort;
}

function getCoreToken() {
  return coreToken;
}

module.exports = { startCore, stopCore, getCorePort, getCoreToken };
