const EventEmitter = require('events');
const { windowsHooks } = require('./windows-hooks');
const { logger } = require('../logger');

class InputCapture extends EventEmitter {
  constructor() {
    super();
    this.active = false;
    this.throttleTimer = null;
    this.lastMousePos = null;
  }

  start() {
    if (this.active) return;
    this.active = true;

    windowsHooks.onMouseMove = (data) => this._onMouseMove(data);
    windowsHooks.onMouseButton = (data) => this._onMouseButton(data);
    windowsHooks.onMouseWheel = (data) => this._onMouseWheel(data);
    windowsHooks.onKeyDown = (data) => this._onKeyDown(data);
    windowsHooks.onKeyUp = (data) => this._onKeyUp(data);

    windowsHooks.start();
    logger.info('OS-INPUT: InputCapture started');
  }

  stop() {
    if (!this.active) return;
    this.active = false;

    windowsHooks.onMouseMove = null;
    windowsHooks.onMouseButton = null;
    windowsHooks.onMouseWheel = null;
    windowsHooks.onKeyDown = null;
    windowsHooks.onKeyUp = null;

    windowsHooks.stop();

    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.lastMousePos = null;

    logger.info('OS-INPUT: InputCapture stopped');
  }

  _onMouseMove(data) {
    if (!this.active) return;

    this.lastMousePos = { x: data.x, y: data.y };

    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(() => {
        this.throttleTimer = null;
        if (this.lastMousePos) {
          this.emit('mouseMove', this.lastMousePos);
        }
      }, 16);
    }
  }

  _onMouseButton(data) {
    if (!this.active) return;

    if (data.pressed) {
      this.emit('mouseDown', { x: data.x, y: data.y, button: data.button });
    } else {
      this.emit('mouseUp', { x: data.x, y: data.y, button: data.button });
    }

    if (data.button === 0 && !data.pressed) {
      this.emit('click', { x: data.x, y: data.y, button: 0, clickCount: 1 });
    }
  }

  _onMouseWheel(data) {
    if (!this.active) return;
    this.emit('scroll', { x: data.x, y: data.y, deltaX: data.deltaX, deltaY: data.deltaY });
  }

  _onKeyDown(data) {
    if (!this.active) return;
    this.emit('keyDown', data);

    if (data.key.length === 1 && !data.ctrlKey && !data.metaKey && !data.altKey) {
      this.emit('charInput', { text: data.key });
    }
  }

  _onKeyUp(data) {
    if (!this.active) return;
    this.emit('keyUp', data);
  }
}

const inputCapture = new InputCapture();

module.exports = { InputCapture, inputCapture };
