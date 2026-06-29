const EventEmitter = require('events');
const path = require('path');
const { logger } = require('../../logger');

const { vkToKey, vkToCode } = require('../vk-map');

class NativeKeyboardHooks extends EventEmitter {
  constructor() {
    super();
    this.running = false;
    this._addon = null;
    this._throttleTimer = null;
    this._lastEvent = null;
  }

  start() {
    if (this.running) return;

    try {
      const addonPath = path.join(__dirname, 'build', 'Release', 'hooks.node');
      this._addon = require(addonPath);
    } catch (err) {
      logger.error({ err: err.message }, 'NATIVE-HOOKS: Failed to load addon');
      throw err;
    }

    this._addon.start((event) => {
      this._onNativeEvent(event);
    });

    this.running = true;
    logger.info('NATIVE-HOOKS: Keyboard hooks started');
  }

  stop() {
    if (!this.running) return;

    if (this._addon) {
      this._addon.stop();
      this._addon = null;
    }

    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
    this._lastEvent = null;

    this.running = false;
    logger.info('NATIVE-HOOKS: Keyboard hooks stopped');
  }

  _onNativeEvent(event) {
    if (!this.running) return;

    const key = vkToKey(event.vkCode);
    const code = vkToCode(event.vkCode);

    const eventData = {
      key,
      code,
      windowsVirtualKeyCode: event.vkCode,
      ctrlKey: event.ctrlKey,
      shiftKey: event.shiftKey,
      altKey: event.altKey,
      metaKey: event.metaKey,
      isExtended: !!(event.flags & (1 << 0)),
      injected: !!(event.flags & (1 << 4)),
    };

    if (event.isDown) {
      this._lastEvent = eventData;

      if (!this._throttleTimer) {
        this._throttleTimer = setTimeout(() => {
          this._throttleTimer = null;
          this._lastEvent = null;
        }, 10);
      }

      this.emit('keyDown', eventData);

      if (key.length === 1 && !event.ctrlKey && !event.altKey) {
        this.emit('charInput', { text: key });
      }
    } else if (event.isUp) {
      this._lastEvent = null;
      this.emit('keyUp', eventData);
    }
  }
}

const nativeKeyboardHooks = new NativeKeyboardHooks();

module.exports = { NativeKeyboardHooks, nativeKeyboardHooks };
