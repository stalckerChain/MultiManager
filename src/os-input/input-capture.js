const EventEmitter = require('events');
const { logger } = require('../logger');

class InputCapture extends EventEmitter {
  constructor() {
    super();
    this.active = false;
  }

  start() {
    if (this.active) return;
    this.active = true;
    logger.info('OS-INPUT: InputCapture started (CDP mode)');
  }

  stop() {
    if (!this.active) return;
    this.active = false;
    logger.info('OS-INPUT: InputCapture stopped');
  }

  injectFromCdp(event) {
    if (!this.active) return;

    switch (event.type) {
      case 'mouseMove':
        this._onMouseMove(event);
        break;
      case 'mouseDown':
        this.emit('mouseDown', { x: event.x, y: event.y, button: event.button });
        break;
      case 'mouseUp':
        this.emit('mouseUp', { x: event.x, y: event.y, button: event.button });
        break;
      case 'click':
        if ((event.button || 0) === 0) {
          this.emit('click', { x: event.x, y: event.y, button: 0, clickCount: event.clickCount || 1 });
        }
        break;
      case 'scroll':
        this.emit('scroll', { x: event.x, y: event.y, deltaX: event.deltaX || 0, deltaY: event.deltaY || 0 });
        break;
      case 'keyDown':
        this.emit('keyDown', event);
        if (event.key && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          this.emit('charInput', { text: event.key });
        }
        break;
      case 'keyUp':
        this.emit('keyUp', event);
        break;
    }
  }

  _onMouseMove(data) {
    if (!this.active) return;
    this.emit('mouseMove', { x: data.x, y: data.y });
  }
}

const inputCapture = new InputCapture();

module.exports = { InputCapture, inputCapture };
