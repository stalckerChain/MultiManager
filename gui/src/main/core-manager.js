const net = require('net');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');

let coreProcess = null;
let corePort = 3000;
let coreToken = crypto.randomBytes(32).toString('hex');

const isDev = !require('electron').app.isPackaged;

const CORE_PATH = isDev
  ? path.join(__dirname, '..', '..', '..', 'src', 'index.js')
  : path.join(require('electron').app.getPath('exe'), '..', 'resources', 'backend', 'src', 'index.js');

function log(level, ...args) {
  const ts = new Date().toISOString();
  const msg = `[${ts}] [CORE-MANAGER] [${level}] ${args.join(' ')}`;
  console.log(msg);
  try {
    const LOG_DIR = path.join(require('electron').app.getPath('userData'), 'logs');
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    const LOG_FILE = path.join(LOG_DIR, `app-${new Date().toISOString().slice(0, 10)}.log`);
    fs.appendFileSync(LOG_FILE, msg + '\n');
  } catch (e) {}
}

log('INFO', 'CORE_PATH:', CORE_PATH);
log('INFO', 'CORE_PATH exists:', fs.existsSync(CORE_PATH));
log('INFO', 'isDev:', isDev);

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
  return startCoreProcess();
}

function startCoreProcess() {
  const { fork } = require('child_process');
  log('INFO', 'startCore: forking', isDev ? '(dev)' : '(packaged)', CORE_PATH);

  const forkEnv = { ...process.env, PORT: corePort };

  if (!isDev) {
    const asarNodeModules = path.join(
      require('electron').app.getPath('exe'), '..', 'resources', 'app.asar', 'node_modules'
    );
    forkEnv.NODE_PATH = asarNodeModules;
    log('INFO', 'NODE_PATH:', asarNodeModules);
  }

  coreProcess = fork(CORE_PATH, [
    `--api-token=${coreToken}`,
  ], {
    env: forkEnv,
    stdio: 'pipe',
  });

  coreProcess.stdout.on('data', (data) => {
    log('CORE-STDOUT', data.toString().trim());
  });

  coreProcess.stderr.on('data', (data) => {
    log('CORE-STDERR', data.toString().trim());
  });

  coreProcess.on('error', (err) => {
    log('ERROR', 'Core process error:', err.message);
  });

  coreProcess.on('exit', (code, signal) => {
    log('INFO', `Core process exited with code ${code}, signal ${signal}`);
    coreProcess = null;
  });

  return corePort;
}

function stopCore() {
  if (coreProcess) {
    log('INFO', 'stopCore: stopping');
    if (coreProcess.kill) {
      coreProcess.kill();
    }
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
