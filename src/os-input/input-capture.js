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
      case 'wheel':
        // Wheel — только диагностика: обработчик wheel выполняется ДО browser
        // default action и не отражает фактический document scroll. Authoritative
        // scroll приходит событием type 'scroll' из window.scroll listener.
        // inputCapture НЕ превращает wheel в authoritative scroll и не запускает
        // scroll runner.
        break;
      case 'scroll':
        // Сохраняем scrollX/scrollY как есть: document scroll в slave применяется
        // по абсолютному состоянию мастера (Runtime.callFunctionOn window.scrollTo).
        // clientX/clientY сохраняются для будущей поддержки контейнеров, но НЕ
        // являются условием допуска document scroll. Отсутствие числовых
        // scrollX/scrollY → controller безопасно пропускает событие.
        this.emit('scroll', {
          x: event.x,
          y: event.y,
          clientX: event.clientX,
          clientY: event.clientY,
          deltaX: event.deltaX || 0,
          deltaY: event.deltaY || 0,
          scrollX: event.scrollX,
          scrollY: event.scrollY,
        });
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
