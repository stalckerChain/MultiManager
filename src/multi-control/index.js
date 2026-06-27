const { logger } = require('../logger');

const MOUSE_THROTTLE_MS = 25;

class MultiController {
  constructor(cdpManagerRef) {
    this.masterId = null;
    this.slaves = new Map();
    this.mouseBuffer = null;
    this.throttleTimer = null;
    this.active = false;
    this.masterScroll = { x: 0, y: 0 };
    this.windowPositions = new Map();
    this.cdp = cdpManagerRef || null;
  }

  setMaster(profileId) {
    this.masterId = profileId;
    this.slaves.clear();
    this.active = true;
    this._loadMasterScroll();
    logger.info(`Multi-control: master установлен — ${profileId}`);
  }

  async addSlave(profileId) {
    this.slaves.set(profileId, { position: null });
    logger.info(`Multi-control: slave добавлен — ${profileId}, всего: ${this.slaves.size}`);
    await this._loadSlavePosition(profileId);
  }

  removeSlave(profileId) {
    this.slaves.delete(profileId);
    logger.info(`Multi-control: slave удалён — ${profileId}, всего: ${this.slaves.size}`);
  }

  stop() {
    this.active = false;
    this.masterId = null;
    this.slaves.clear();
    this.masterScroll = { scrollX: 0, scrollY: 0 };
    this.windowPositions.clear();
    if (this.throttleTimer) {
      clearTimeout(this.throttleTimer);
      this.throttleTimer = null;
    }
    this.mouseBuffer = null;
    logger.info('Multi-control: остановлен');
  }

  setWindowPosition(profileId, x, y, width, height) {
    this.windowPositions.set(profileId, { x, y, width, height });
  }

  _toSlaveCoords(pageX, pageY, slaveId) {
    const slavePos = this.windowPositions.get(slaveId);
    const masterPos = this.windowPositions.get(this.masterId);

    const offsetX = (slavePos?.x || 0) - (masterPos?.x || 0);
    const offsetY = (slavePos?.y || 0) - (masterPos?.y || 0);

    const slaveScroll = this.slaves.get(slaveId)?.scroll || { scrollX: 0, scrollY: 0 };

    const slaveX = pageX - this.masterScroll.scrollX + slaveScroll.scrollX + offsetX;
    const slaveY = pageY - this.masterScroll.scrollY + slaveScroll.scrollY + offsetY;

    return { x: Math.max(0, Math.round(slaveX)), y: Math.max(0, Math.round(slaveY)) };
  }

  async _loadMasterScroll() {
    if (!this.masterId || !this.cdp) return;
    try {
      this.masterScroll = await this.cdp.getPageScroll(this.masterId);
    } catch {
      this.masterScroll = { scrollX: 0, scrollY: 0 };
    }
  }

  async _loadSlavePosition(profileId) {
    if (!this.cdp) return;
    try {
      const scroll = await this.cdp.getPageScroll(profileId);
      const slaveData = this.slaves.get(profileId);
      if (slaveData) slaveData.scroll = scroll;
    } catch {}
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
          await this._broadcastMouse('mouseMoved', buffered);
        }
      }, MOUSE_THROTTLE_MS);
    }
  }

  async onMousePressed(params) {
    if (!this.active) return;
    await this._broadcastMouse('mousePressed', params);
  }

  async onMouseReleased(params) {
    if (!this.active) return;
    await this._broadcastMouse('mouseReleased', params);
  }

  async onKeyDown(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        this.cdp.dispatchKeyEvent(id, 'keyDown', params);
      } catch (err) {
        logger.error(`Multi-control: keyboard error slave ${id}`, { error: err.message });
      }
    }
  }

  async onKeyUp(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        this.cdp.dispatchKeyEvent(id, 'keyUp', params);
      } catch (err) {
        logger.error(`Multi-control: keyboard error slave ${id}`, { error: err.message });
      }
    }
  }

  async onCharTyped(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        this.cdp.dispatchKeyEvent(id, 'char', params);
      } catch (err) {
        logger.error(`Multi-control: char error slave ${id}`, { error: err.message });
      }
    }
  }

  async onClick(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        const coords = this._toSlaveCoords(params.x, params.y, id);
        this.cdp.dispatchMouseEvent(id, 'mousePressed', {
          ...coords, button: params.button || 'left', clickCount: params.clickCount || 1,
        });
        this.cdp.dispatchMouseEvent(id, 'mouseReleased', {
          ...coords, button: params.button || 'left', clickCount: params.clickCount || 1,
        });
      } catch (err) {
        logger.error(`Multi-control: click error slave ${id}`, { error: err.message });
      }
    }
  }

  async scrollTo(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        this.cdp.dispatchMouseEvent(id, 'mouseWheel', {
          x: 0, y: 0,
          deltaX: params.deltaX || 0,
          deltaY: params.deltaY || 0,
        });
      } catch (err) {
        logger.error(`Multi-control: scroll error slave ${id}`, { error: err.message });
      }
    }
  }

  async _broadcastMouse(type, params) {
    if (!this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        const coords = this._toSlaveCoords(params.x || 0, params.y || 0, id);
        this.cdp.dispatchMouseEvent(id, type, {
          ...coords,
          button: params.button,
          clickCount: params.clickCount,
          deltaX: params.deltaX,
          deltaY: params.deltaY,
        });
      } catch (err) {
        logger.error(`Multi-control: mouse error slave ${id}`, { error: err.message });
      }
    }
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
