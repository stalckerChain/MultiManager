const { logger } = require('../logger');

const MOUSE_THROTTLE_MS = 25;

class MultiController {
  constructor() {
    this.masterId = null;
    this.slaves = new Map();
    this.mouseBuffer = null;
    this.throttleTimer = null;
    this.active = false;
  }

  setMaster(profileId, cdpSession) {
    this.masterId = profileId;
    this.slaves.clear();
    this.active = true;
    logger.info(`Multi-control: master установлен — ${profileId}`);
  }

  addSlave(profileId, cdpSession) {
    this.slaves.set(profileId, cdpSession);
    logger.info(`Multi-control: slave добавлен — ${profileId}, всего: ${this.slaves.size}`);
  }

  removeSlave(profileId) {
    this.slaves.delete(profileId);
    logger.info(`Multi-control: slave удалён — ${profileId}, всего: ${this.slaves.size}`);
  }

  stop() {
    this.active = false;
    this.masterId = null;
    this.slaves.clear();
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.mouseBuffer = null;
    logger.info('Multi-control: остановлен');
  }

  async broadcastToSlaves(method, params) {
    if (!this.active) return;

    const promises = [];
    for (const [id, session] of this.slaves) {
      try {
        promises.push(session.send(method, params));
      } catch (err) {
        logger.error(`Multi-control: ошибка отправки в slave ${id}`, { error: err.message });
      }
    }
    await Promise.allSettled(promises);
  }

  async onMouseMoved(params) {
    if (!this.active) return;

    this.mouseBuffer = params;

    if (!this.throttleTimer) {
      this.throttleTimer = setTimeout(async () => {
        const buffered = this.mouseBuffer;
        this.mouseBuffer = null;
        this.throttleTimer = null;

        if (buffered) {
          await this.broadcastToSlaves('Input.dispatchMouseEvent', {
            ...buffered,
            type: 'mouseMoved',
          });
        }
      }, MOUSE_THROTTLE_MS);
    }
  }

  async onMousePressed(params) {
    if (!this.active) return;
    await this.broadcastToSlaves('Input.dispatchMouseEvent', {
      ...params,
      type: 'mousePressed',
    });
  }

  async onMouseReleased(params) {
    if (!this.active) return;
    await this.broadcastToSlaves('Input.dispatchMouseEvent', {
      ...params,
      type: 'mouseReleased',
    });
  }

  async onKeyDown(params) {
    if (!this.active) return;
    await this.broadcastToSlaves('Input.dispatchKeyEvent', {
      ...params,
      type: 'keyDown',
    });
  }

  async onKeyUp(params) {
    if (!this.active) return;
    await this.broadcastToSlaves('Input.dispatchKeyEvent', {
      ...params,
      type: 'keyUp',
    });
  }

  async onCharTyped(params) {
    if (!this.active) return;
    await this.broadcastToSlaves('Input.dispatchKeyEvent', {
      ...params,
      type: 'char',
    });
  }

  async onClick(params) {
    if (!this.active) return;

    await this.broadcastToSlaves('Input.dispatchMouseEvent', {
      ...params,
      type: 'mousePressed',
    });
    await this.broadcastToSlaves('Input.dispatchMouseEvent', {
      ...params,
      type: 'mouseReleased',
    });
  }

  async scrollTo(params) {
    if (!this.active) return;
    await this.broadcastToSlaves('Input.dispatchMouseEvent', {
      type: 'mouseWheel',
      x: params.x || 0,
      y: params.y || 0,
      deltaX: params.deltaX || 0,
      deltaY: params.deltaY || 0,
    });
  }

  getStatus() {
    return {
      active: this.active,
      masterId: this.masterId,
      slaveCount: this.slaves.size,
      slaves: Array.from(this.slaves.keys()),
    };
  }
}

const controller = new MultiController();

module.exports = { MultiController, controller };
