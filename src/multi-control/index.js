const { logger } = require('../logger');
const { MouseSmoother } = require('./mouse-smoothing');

const SCROLL_STEP_PX = 40;
const SCROLL_TICK_MS = 16;

class MultiController {
  constructor(cdpManagerRef) {
    this.masterId = null;
    this.slaves = new Map();
    this.smoothers = new Map();
    this.active = false;
    this.masterScroll = { x: 0, y: 0 };
    this.windowPositions = new Map();
    this.cdp = cdpManagerRef || null;
    this.tabMapping = new Map();
    this.tabIndex = [];
    this.activeMasterTab = null;
  }

  setMaster(profileId) {
    this.masterId = profileId;
    for (const smoother of this.smoothers.values()) smoother.stop();
    this.smoothers.clear();
    this.slaves.clear();
    this.active = true;
    this._loadMasterScroll();
    logger.info(`Multi-control: master установлен — ${profileId}`);
    logger.info({ masterId: this.masterId, active: this.active }, 'Multi-control: setMaster DONE');
  }

  async addSlave(profileId) {
    this.slaves.set(profileId, { position: null });
    logger.info(`Multi-control: slave добавлен — ${profileId}, всего: ${this.slaves.size}`);
    await this._loadSlavePosition(profileId);

    const smoother = new MouseSmoother({
      dispatch: (x, y) => this._dispatchSlaveMove(profileId, x, y),
    });
    this.smoothers.set(profileId, smoother);
  }

  removeSlave(profileId) {
    const smoother = this.smoothers.get(profileId);
    if (smoother) {
      smoother.stop();
      this.smoothers.delete(profileId);
    }
    this.slaves.delete(profileId);
    logger.info(`Multi-control: slave удалён — ${profileId}, всего: ${this.slaves.size}`);
  }

  stop() {
    this.active = false;
    this.masterId = null;
    for (const smoother of this.smoothers.values()) {
      smoother.stop();
    }
    this.smoothers.clear();
    this.slaves.clear();
    this.masterScroll = { scrollX: 0, scrollY: 0 };
    this.windowPositions.clear();
    this.tabMapping.clear();
    this.tabIndex = [];
    this.activeMasterTab = null;
    logger.info('Multi-control: остановлен');
  }

  setWindowPosition(profileId, x, y, width, height) {
    this.windowPositions.set(profileId, { x, y, width, height });
  }

  mapTab(masterTargetId, slaveId, slaveTargetId) {
    let bySlave = this.tabMapping.get(masterTargetId);
    const isNewEntry = !bySlave;
    if (!bySlave) {
      bySlave = new Map();
      this.tabMapping.set(masterTargetId, bySlave);
      this.tabIndex.push(masterTargetId);
    }
    bySlave.set(slaveId, slaveTargetId);
    logger.info({ masterTargetId, slaveId, slaveTargetId }, 'Multi-control: tab mapped');
  }

  unmapTab(masterTargetId, slaveId) {
    const bySlave = this.tabMapping.get(masterTargetId);
    if (!bySlave) return;
    if (slaveId) {
      bySlave.delete(slaveId);
      if (bySlave.size === 0) {
        this.tabMapping.delete(masterTargetId);
        this._removeFromTabIndex(masterTargetId);
      }
    } else {
      this.tabMapping.delete(masterTargetId);
      this._removeFromTabIndex(masterTargetId);
    }
  }

  _removeFromTabIndex(masterTargetId) {
    const idx = this.tabIndex.indexOf(masterTargetId);
    if (idx !== -1) this.tabIndex.splice(idx, 1);
  }

  _unmapBySlaveTargetId(slaveTargetId) {
    for (const [masterTid, bySlave] of this.tabMapping) {
      for (const [sid, stid] of bySlave) {
        if (stid === slaveTargetId) {
          bySlave.delete(sid);
          logger.info({ masterTargetId: masterTid, slaveId: sid, slaveTargetId }, 'Multi-control: slave tab destroyed, unmapped');
          if (bySlave.size === 0) {
            this.tabMapping.delete(masterTid);
            this._removeFromTabIndex(masterTid);
          }
          this._maybeSwitchToPrevTab(masterTid);
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

  _maybeSwitchToPrevTab(destroyedMasterTargetId) {
    if (this.activeMasterTab !== destroyedMasterTargetId) return;
    const destroyedIdx = this.tabIndex.indexOf(destroyedMasterTargetId);
    if (destroyedIdx <= 0) {
      if (this.tabIndex.length > 0) {
        this.setActiveMasterTab(this.tabIndex[0]);
      }
      return;
    }
    const prevIdx = destroyedIdx - 1;
    const prevTargetId = this.tabIndex[prevIdx];
    if (prevTargetId) {
      this.setActiveMasterTab(prevTargetId);
    }
  }

  async _enforceSlaveFocusOnActiveTab(slaveId) {
    if (!this.activeMasterTab || !this.cdp) return;
    const slaveTargetId = this.getSlaveTabForMaster(this.activeMasterTab, slaveId);
    if (!slaveTargetId) return;
    const bc = this.cdp.browserConnections?.get(slaveId);
    if (!bc || !bc.targetSessions.has(slaveTargetId)) return;
    try {
      await this.cdp.activateAndFocusTarget(slaveId, slaveTargetId);
      logger.info({ slaveId, masterTab: this.activeMasterTab, slaveTargetId }, 'Multi-control: enforced focus on active tab in slave');
    } catch (err) {
      logger.error(`Multi-control: _enforceSlaveFocusOnActiveTab error slave ${slaveId}`, { error: err.message });
    }
  }

  getTabIndex(masterTargetId) {
    return this.tabIndex.indexOf(masterTargetId);
  }

  getActiveTabIndex() {
    if (!this.activeMasterTab) return -1;
    return this.getTabIndex(this.activeMasterTab);
  }

  setActiveMasterTab(targetId) {
    if (this.activeMasterTab === targetId) return;
    this.activeMasterTab = targetId;
    logger.info({ targetId }, 'Multi-control: active master tab changed, syncing to slaves');
    this._syncActiveTabToSlaves(targetId);
  }

  async _syncActiveTabToSlaves(masterTargetId) {
    if (!this.cdp) return;

    const bySlave = this.tabMapping.get(masterTargetId);
    if (bySlave && bySlave.size > 0) {
      for (const [slaveId, slaveTargetId] of bySlave) {
        try {
          await this.cdp.activateAndFocusTarget(slaveId, slaveTargetId);
        } catch (err) {
          logger.error(`Multi-control: activateAndFocusTarget error slave ${slaveId}`, { error: err.message });
        }
      }
      return;
    }

    const masterTargets = await this.cdp.getPageTargets(this.masterId);
    const masterTarget = masterTargets.find(t => t.targetId === masterTargetId);
    if (!masterTarget) {
      logger.warn({ masterTargetId }, 'Multi-control: master target not found in getPageTargets');
      return;
    }

    const masterUrl = masterTarget.url;
    const masterIndex = this.getTabIndex(masterTargetId);

    for (const [slaveId] of this.slaves) {
      try {
        const slaveTargets = await this.cdp.getPageTargets(slaveId);
        let slaveTarget = slaveTargets.find(t => t.url === masterUrl && t.url && t.url !== 'about:blank');
        if (!slaveTarget && masterIndex >= 0 && masterIndex < slaveTargets.length) {
          slaveTarget = slaveTargets[masterIndex];
        }
        if (slaveTarget) {
          this.mapTab(masterTargetId, slaveId, slaveTarget.targetId);
          await this.cdp.activateAndFocusTarget(slaveId, slaveTarget.targetId);
          logger.info({ slaveId, slaveTargetId: slaveTarget.targetId, url: masterUrl }, 'Multi-control: synced slave tab by URL/index');
        }
      } catch (err) {
        logger.error(`Multi-control: tab sync error slave ${slaveId}`, { error: err.message });
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

    const slaveX = pageX - slaveScroll.scrollX + offsetX;
    const slaveY = pageY - slaveScroll.scrollY + offsetY;

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
    } catch (err) {
      logger.debug({ profileId, error: err.message }, 'Multi-control: ошибка загрузки scroll позиции');
    }
  }

  async onMouseMoved(params) {
    if (!this.active) return;

    for (const [slaveId] of this.slaves) {
      const coords = this._toSlaveCoords(params.x || 0, params.y || 0, slaveId);
      const smoother = this.smoothers.get(slaveId);
      if (smoother) smoother.setTarget(coords.x, coords.y);
    }
  }

  async onMousePressed(params) {
    if (!this.active) return;
    for (const smoother of this.smoothers.values()) smoother.flush();
    await this._broadcastMouse('mousePressed', params);
  }

  async onMouseReleased(params) {
    if (!this.active) return;
    for (const smoother of this.smoothers.values()) smoother.flush();
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
    const totalY = params.deltaY || 0;
    const totalX = params.deltaX || 0;
    this.masterScroll.scrollX = (this.masterScroll.scrollX || 0) + totalX;
    this.masterScroll.scrollY = (this.masterScroll.scrollY || 0) + totalY;
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(totalY), Math.abs(totalX)) / SCROLL_STEP_PX));

    const promises = [];
    for (const [id] of this.slaves) {
      if (this.smoothers.has(id)) {
        promises.push(this._runScrollSequence(id, steps, totalX, totalY));
      }
    }
    await Promise.all(promises);
  }

  _runScrollSequence(slaveId, steps, totalX, totalY) {
    return new Promise((resolve) => {
      let i = 0;
      const stepX = totalX / steps;
      const stepY = totalY / steps;
      const fire = () => {
        if (i >= steps || !this.active || !this.slaves.has(slaveId)) {
          resolve();
          return;
        }
        i++;
        const isLast = i === steps;
        const dx = isLast ? totalX - stepX * (steps - 1) : stepX;
        const dy = isLast ? totalY - stepY * (steps - 1) : stepY;
        const session = this._getSlaveSession(slaveId);
        const wheelParams = { x: 0, y: 0, deltaX: dx, deltaY: dy };
        if (session) {
          this.cdp.dispatchMouseEventToSession(slaveId, session.sessionId, 'mouseWheel', wheelParams);
        } else {
          this.cdp.dispatchMouseEvent(slaveId, 'mouseWheel', wheelParams);
        }
        const slaveData = this.slaves.get(slaveId);
        if (slaveData && slaveData.scroll) {
          slaveData.scroll.scrollX = (slaveData.scroll.scrollX || 0) + dx;
          slaveData.scroll.scrollY = (slaveData.scroll.scrollY || 0) + dy;
        }
        if (isLast) {
          resolve();
        } else {
          setTimeout(fire, SCROLL_TICK_MS);
        }
      };
      fire();
    });
  }

  _dispatchSlaveMove(slaveId, x, y) {
    const session = this._getSlaveSession(slaveId);
    if (session) {
      this.cdp.dispatchMouseEventToSession(slaveId, session.sessionId, 'mouseMoved', { x, y });
    } else {
      this.cdp.dispatchMouseEvent(slaveId, 'mouseMoved', { x, y });
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
