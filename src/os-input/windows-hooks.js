const { fork } = require('child_process');
const path = require('path');
const { logger } = require('../logger');

const WORKER_PATH = path.join(__dirname, 'hook-worker.js');

class WindowsHooks {
  constructor() {
    this.running = false;
    this.onMouseMove = null;
    this.onMouseButton = null;
    this.onMouseWheel = null;
    this.onKeyDown = null;
    this.onKeyUp = null;
    this._worker = null;
  }

  start() {
    if (this.running) return;
    this.running = true;

    this._worker = fork(WORKER_PATH, [], {
      stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
      silent: true,
      env: { ...process.env },
    });

    this._worker.stderr.on('data', (chunk) => {
      logger.error({ stderr: chunk.toString().trim() }, 'OS-INPUT: Hook worker stderr');
    });

    this._worker.stdout.on('data', (chunk) => {
      logger.info({ stdout: chunk.toString().trim() }, 'OS-INPUT: Hook worker stdout');
    });

    this._worker.on('message', (msg) => {
      if (msg.type === 'ready') {
        logger.info('OS-INPUT: Hook worker ready');
        return;
      }
      if (msg.type === 'heartbeat') {
        logger.info({ eventCount: msg.data.eventCount, pumpCount: msg.data.pumpCount }, 'OS-INPUT: Hook worker heartbeat');
        return;
      }
      if (msg.type === 'error') {
        logger.error({ err: msg.data }, 'OS-INPUT: Hook worker error');
        return;
      }
      this._dispatch(msg.type, msg.data);
    });

    this._worker.on('error', (err) => {
      logger.error({ err: err.message }, 'OS-INPUT: Hook worker crashed');
      this.running = false;
    });

    this._worker.on('exit', (code, signal) => {
      if (this.running) {
        logger.warn({ code, signal }, 'OS-INPUT: Hook worker exited unexpectedly');
        this.running = false;
      }
    });

    logger.info('OS-INPUT: Hook worker spawned');
  }

  stop() {
    if (!this.running) return;
    this.running = false;

    if (this._worker) {
      this._worker.kill();
      this._worker = null;
    }

    this.onMouseMove = null;
    this.onMouseButton = null;
    this.onMouseWheel = null;
    this.onKeyDown = null;
    this.onKeyUp = null;

    logger.info('OS-INPUT: Hook worker stopped');
  }

  _dispatch(type, data) {
    switch (type) {
      case 'mouseMove':
        if (this.onMouseMove) this.onMouseMove(data);
        break;
      case 'mouseDown':
      case 'mouseUp': {
        if (this.onMouseButton) {
          this.onMouseButton({ x: data.x, y: data.y, button: data.button, pressed: data.pressed });
        }
        break;
      }
      case 'scroll':
        if (this.onMouseWheel) this.onMouseWheel(data);
        break;
      case 'keyDown':
        if (this.onKeyDown) this.onKeyDown(data);
        break;
      case 'keyUp':
        if (this.onKeyUp) this.onKeyUp(data);
        break;
      default:
        logger.warn({ type }, 'OS-INPUT: Unknown event from hook worker');
    }
  }
}

const windowsHooks = new WindowsHooks();

module.exports = { WindowsHooks, windowsHooks };
