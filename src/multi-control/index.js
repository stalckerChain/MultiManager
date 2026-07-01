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
    this.tabMapping = new Map();
    this.activeMasterTab = null;
  }

  setMaster(profileId) {
    this.masterId = profileId;
    this.slaves.clear();
    this.active = true;
    this._loadMasterScroll();
    logger.info(`Multi-control: master установлен — ${profileId}`);
    logger.info({ masterId: this.masterId, active: this.active }, 'Multi-control: setMaster DONE');
  }

  async addSlave(profileId) {
    this.slaves.set(profileId, { position: null });
    logger.info(`Multi-control: slave добавлен — ${profileId}, всего: ${this.slaves.size}`);
    logger.info({ masterId: this.masterId, slaves: Array.from(this.slaves.keys()) }, 'Multi-control: addSlave DONE');
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
    this.tabMapping.clear();
    this.activeMasterTab = null;
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

  mapTab(masterTargetId, slaveId, slaveTargetId) {
    let bySlave = this.tabMapping.get(masterTargetId);
    if (!bySlave) {
      bySlave = new Map();
      this.tabMapping.set(masterTargetId, bySlave);
    }
    bySlave.set(slaveId, slaveTargetId);
    logger.info({ masterTargetId, slaveId, slaveTargetId }, 'Multi-control: tab mapped');
  }

  unmapTab(masterTargetId, slaveId) {
    const bySlave = this.tabMapping.get(masterTargetId);
    if (!bySlave) return;
    if (slaveId) {
      bySlave.delete(slaveId);
    } else {
      this.tabMapping.delete(masterTargetId);
    }
  }

  _unmapBySlaveTargetId(slaveTargetId) {
    for (const [masterTid, bySlave] of this.tabMapping) {
      for (const [sid, stid] of bySlave) {
        if (stid === slaveTargetId) {
          bySlave.delete(sid);
          logger.info({ masterTargetId: masterTid, slaveId: sid, slaveTargetId }, 'Multi-control: slave tab destroyed, unmapped');
          if (bySlave.size === 0) this.tabMapping.delete(masterTid);
          return;
        }
      }
    }
  }

  getSlaveTabForMaster(masterTargetId, slaveId) {
    const bySlave = this.tabMapping.get(masterTargetId);
    if (!bySlave) return null;
    if (slaveId) return bySlave.get(slaveId) || null;
    return bySlave.values().next().value || null;
  }

  setActiveMasterTab(targetId) {
    if (this.activeMasterTab === targetId) return;
    this.activeMasterTab = targetId;
    logger.info({ targetId }, 'Multi-control: active master tab changed, syncing to slaves');
    this._syncActiveTabToSlaves(targetId);
  }

  _syncActiveTabToSlaves(masterTargetId) {
    if (!this.cdp) return;
    const bySlave = this.tabMapping.get(masterTargetId);
    if (!bySlave) return;
    for (const [slaveId, slaveTargetId] of bySlave) {
      try {
        this.cdp.activateTarget(slaveId, slaveTargetId);
      } catch (err) {
        logger.error(`Multi-control: activateTarget error slave ${slaveId}`, { error: err.message });
      }
    }
  }

  _toCdpButton(raw) {
    if (typeof raw === 'string') return raw;
    if (raw === 1) return 'middle';
    if (raw === 2) return 'right';
    return 'left';
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
    if (!this.active) {
      logger.warn('Multi-control: onMouseMoved called but controller NOT active');
      return;
    }

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
    if (params.ctrlKey && ['t', 'n', 'w'].includes((params.key || '').toLowerCase())) return;
    for (const [id] of this.slaves) {
      try {
        const session = this._getSlaveSession(id);
        if (session) {
          this.cdp.dispatchKeyEventToSession(id, session.sessionId, 'keyDown', params);
        } else {
          this.cdp.dispatchKeyEvent(id, 'keyDown', params);
        }
      } catch (err) {
        logger.error(`Multi-control: keyboard error slave ${id}`, { error: err.message });
      }
    }
  }

  async onKeyUp(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        const session = this._getSlaveSession(id);
        if (session) {
          this.cdp.dispatchKeyEventToSession(id, session.sessionId, 'keyUp', params);
        } else {
          this.cdp.dispatchKeyEvent(id, 'keyUp', params);
        }
      } catch (err) {
        logger.error(`Multi-control: keyboard error slave ${id}`, { error: err.message });
      }
    }
  }

  async onCharInput(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        const session = this._getSlaveSession(id);
        if (session) {
          this.cdp.insertTextToSession(id, session.sessionId, params.text);
        } else {
          this.cdp.insertText(id, params.text);
        }
      } catch (err) {
        logger.error(`Multi-control: charInput error slave ${id}`, { error: err.message });
      }
    }
  }

  async onClick(params) {
    // click is generated by browser from mousePressed+mouseReleased pair
    // dispatched by _broadcastMouse via onMousePressed/onMouseReleased — no extra dispatch needed
  }

  async scrollTo(params) {
    if (!this.active || !this.cdp) return;
    for (const [id] of this.slaves) {
      try {
        const session = this._getSlaveSession(id);
        if (session) {
          this.cdp.dispatchMouseEventToSession(id, session.sessionId, 'mouseWheel', {
            x: 0, y: 0,
            deltaX: params.deltaX || 0,
            deltaY: params.deltaY || 0,
          });
        } else {
          this.cdp.dispatchMouseEvent(id, 'mouseWheel', {
            x: 0, y: 0,
            deltaX: params.deltaX || 0,
            deltaY: params.deltaY || 0,
          });
        }
      } catch (err) {
        logger.error(`Multi-control: scroll error slave ${id}`, { error: err.message });
      }
    }
  }

  async _broadcastMouse(type, params) {
    if (!this.cdp) {
      logger.warn('Multi-control: _broadcastMouse called but cdp is null');
      return;
    }
    logger.info({
      type,
      x: params.x,
      y: params.y,
      slaveCount: this.slaves.size,
      masterId: this.masterId,
    }, 'Multi-control: BROADCAST to slaves');
    for (const [id] of this.slaves) {
      try {
        const coords = this._toSlaveCoords(params.x || 0, params.y || 0, id);
        const session = this._getSlaveSession(id);
        const cdpBtn = this._toCdpButton(params.button);
        if (session) {
          this.cdp.dispatchMouseEventToSession(id, session.sessionId, type, {
            ...coords,
            button: cdpBtn,
            clickCount: params.clickCount,
            deltaX: params.deltaX,
            deltaY: params.deltaY,
          });
        } else {
          this.cdp.dispatchMouseEvent(id, type, {
            ...coords,
            button: cdpBtn,
            clickCount: params.clickCount,
            deltaX: params.deltaX,
            deltaY: params.deltaY,
          });
        }
        logger.info({ slaveId: id, type, coords }, 'Multi-control: SENT to slave');
      } catch (err) {
        logger.error(`Multi-control: mouse error slave ${id}`, { error: err.message });
      }
    }
  }

  _getSlaveSession(slaveId) {
    if (!this.cdp) return null;
    if (!this.cdp.browserConnections) return null;
    const bc = this.cdp.browserConnections.get(slaveId);
    if (!bc) return null;
    if (this.activeMasterTab) {
      const bySlave = this.tabMapping.get(this.activeMasterTab);
      if (bySlave) {
        const slaveTargetId = bySlave.get(slaveId);
        if (slaveTargetId) {
          const mapped = bc.targetSessions.get(slaveTargetId);
          if (mapped) return mapped;
        }
      }
    }
    const first = bc.targetSessions.values().next().value;
    return first || null;
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
