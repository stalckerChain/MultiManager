const { logger } = require('../logger');
const { MouseSmoother } = require('./mouse-smoothing');

const SCROLL_TICK_MS = 16;

class MultiController {
  constructor(cdpManagerRef) {
    this.masterId = null;
    this.slaves = new Map();
    this.smoothers = new Map();
    this.active = false;
    this.masterScroll = { scrollX: 0, scrollY: 0 };
    this.windowPositions = new Map();
    this.cdp = cdpManagerRef || null;
    this.tabMapping = new Map();
    this.tabIndex = [];
    this.activeMasterTab = null;
    this._throttleInterval = 16;
    this._throttleTimer = null;
    this._pendingMove = null;
    this._scrollRunners = new Map();
    this._debugStats = this._createDebugStats();
    this._lastDebugLogAt = 0;
  }

  setMaster(profileId) {
    this.masterId = profileId;
    for (const smoother of this.smoothers.values()) smoother.stop();
    this.smoothers.clear();
    this.slaves.clear();
    this.active = true;
    this._clearThrottle();
    this._debugStats = this._createDebugStats();
    this._lastDebugLogAt = 0;
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
      onStats: (stats) => this._accumulateSmootherStats(stats),
    });
    this.smoothers.set(profileId, smoother);
    this._applySmootherProfile();
  }

  removeSlave(profileId) {
    const smoother = this.smoothers.get(profileId);
    if (smoother) {
      smoother.stop();
      this.smoothers.delete(profileId);
    }
    this.slaves.delete(profileId);
    this._cancelScrollTimers(profileId);
    this._scrollRunners.delete(profileId);
    if (this.slaves.size === 0) {
      this._clearThrottle();
    } else {
      this._applySmootherProfile();
    }
    logger.info(`Multi-control: slave удалён — ${profileId}, всего: ${this.slaves.size}`);
  }

  stop() {
    this.active = false;
    this.masterId = null;
    this._clearThrottle();
    this._cancelScrollTimers();
    this._scrollRunners.clear();
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
    this._debugStats = this._createDebugStats();
    this._lastDebugLogAt = 0;
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
      this.tabIndex.push(masterTargetId);
    }
    bySlave.set(slaveId, slaveTargetId);
    logger.info({ masterTargetId, slaveId, slaveTargetId }, 'Multi-control: tab mapped');
  }

  unmapTab(masterTargetId, slaveId) {
    const bySlave = this.tabMapping.get(masterTargetId);
    if (!bySlave) {
      logger.debug({ masterTargetId, slaveId }, 'MC-UNMAP: no mapping found');
      return;
    }
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

  // pageX/pageY — документные координаты события (e.pageX/e.pageY): masterScroll
  // уже учтён в них. CDP Input.dispatchMouseEvent принимает viewport-координаты
  // slave, поэтому вычитаем только фактический slaveScroll. Положение окон на
  // рабочем столе (windowPositions) не участвует: оно не меняет систему
  // координат CDP target/session.
  _toSlaveCoords(pageX, pageY, slaveId) {
    const slaveScroll = this.slaves.get(slaveId)?.scroll || { scrollX: 0, scrollY: 0 };

    const slaveX = pageX - (slaveScroll.scrollX || 0);
    const slaveY = pageY - (slaveScroll.scrollY || 0);

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
    if (!this.active || this.slaves.size === 0) return;

    // Controller-level throttling, latest-event-wins: за интервал хранится
    // только последнее событие master, по истечении интервала обрабатывается оно.
    this._debugStats.mousemoveReceived += 1;
    this._pendingMove = {
      x: params.x || 0,
      y: params.y || 0,
      scrollX: params.scrollX || 0,
      scrollY: params.scrollY || 0,
    };
    if (this._throttleTimer) {
      this._debugStats.mousemoveCoalesced += 1;
      return;
    }

    this._throttleTimer = setTimeout(() => {
      this._throttleTimer = null;
      const event = this._pendingMove;
      this._pendingMove = null;
      if (event && this.active && this.slaves.size > 0) this._processMove(event);
    }, this._throttleInterval);
  }

  _processMove(params) {
    this._debugStats.mousemoveProcessed += 1;
    for (const [slaveId] of this.slaves) {
      const coords = this._toSlaveCoords(params.x || 0, params.y || 0, slaveId);
      const smoother = this.smoothers.get(slaveId);
      if (smoother) smoother.setTarget(coords.x, coords.y);
    }
    this._logDebugStats();
  }

  _cancelThrottle() {
    if (this._throttleTimer) {
      clearTimeout(this._throttleTimer);
      this._throttleTimer = null;
    }
  }

  _clearThrottle() {
    this._cancelThrottle();
    this._pendingMove = null;
  }

  _createDebugStats() {
    return {
      mousemoveReceived: 0,
      mousemoveProcessed: 0,
      mousemoveCoalesced: 0,
      stalePointsSkipped: 0,
      dispatchCount: 0,
      scrollEventsReceived: 0,
      scrollSyncApplied: 0,
      scrollSyncDiscarded: 0,
      currentLagMs: 0,
      maxLagMs: 0,
      windowStartedAt: Date.now(),
    };
  }

  _accumulateSmootherStats(stats) {
    const d = this._debugStats;
    d.stalePointsSkipped += stats.stalePointsSkipped;
    d.currentLagMs = stats.currentLagMs;
    if (stats.currentLagMs > d.maxLagMs) d.maxLagMs = stats.currentLagMs;
    this._logDebugStats();
  }

  _logDebugStats() {
    const now = Date.now();
    if (now - this._lastDebugLogAt < 1000) return;
    this._lastDebugLogAt = now;
    const d = this._debugStats;
    const elapsedSec = Math.max(1, (now - d.windowStartedAt) / 1000);
    const dispatchPerSecond = Math.round(d.dispatchCount / elapsedSec);
    const coalescingRate = d.mousemoveReceived > 0
      ? Math.round((d.mousemoveCoalesced / d.mousemoveReceived) * 100) / 100
      : 0;
    logger.debug({
      mousemoveReceived: d.mousemoveReceived,
      mousemoveProcessed: d.mousemoveProcessed,
      mousemoveCoalesced: d.mousemoveCoalesced,
      stalePointsSkipped: d.stalePointsSkipped,
      dispatchCount: d.dispatchCount,
      scrollEventsReceived: d.scrollEventsReceived,
      scrollSyncApplied: d.scrollSyncApplied,
      scrollSyncDiscarded: d.scrollSyncDiscarded,
      currentLagMs: d.currentLagMs,
      maxLagMs: d.maxLagMs,
      dispatchPerSecond,
      coalescingRate,
    }, 'Multi-control: debug stats');
  }

  _getSmootherProfile() {
    const count = this.slaves.size;
    if (count >= 5) return { stepInterval: 16, maxPoints: 30 };
    if (count >= 3) return { stepInterval: 12, maxPoints: 40 };
    return { stepInterval: 8, maxPoints: 60 };
  }

  _applySmootherProfile() {
    const profile = this._getSmootherProfile();
    for (const smoother of this.smoothers.values()) {
      smoother.updateOptions(profile);
    }
  }

  async onMousePressed(params) {
    if (!this.active) return;
    const hasPendingMove = this._pendingMove !== null || this._throttleTimer !== null;
    this._clearThrottle();
    for (const [slaveId, smoother] of this.smoothers) {
      // Если последний mousemove ещё не обработан throttling — координаты клика
      // становятся актуальной целью smoother, чтобы курсор точно попал в цель.
      if (hasPendingMove) {
        const coords = this._toSlaveCoords(params.x || 0, params.y || 0, slaveId);
        smoother.setTarget(coords.x, coords.y);
      }
      smoother.flush();
    }
    await this._broadcastMouse('mousePressed', params);
  }

  async onMouseReleased(params) {
    if (!this.active) return;
    const hasPendingMove = this._pendingMove !== null || this._throttleTimer !== null;
    this._clearThrottle();
    for (const [slaveId, smoother] of this.smoothers) {
      if (hasPendingMove) {
        const coords = this._toSlaveCoords(params.x || 0, params.y || 0, slaveId);
        smoother.setTarget(coords.x, coords.y);
      }
      smoother.flush();
    }
    await this._broadcastMouse('mouseReleased', params);
  }

  async onKeyDown(params) {
    if (!this.active || !this.cdp) return;
    if (params.ctrlKey && ['t', 'n', 'w'].includes((params.key || '').toLowerCase())) {
      logger.debug({ ctrlKey: params.ctrlKey }, 'MC-KEY: Ctrl+W/T/N blocked from CDP forwarding (handled by browserAction or OS hook)');
      return;
    }
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
    this._debugStats.scrollEventsReceived += 1;
    // Authoritative document scroll: master — единственный источник правды.
    // Абсолютное состояние берём из события (window.scrollX/scrollY), а не
    // накапливаем дельты. clientX/clientY не обязательны для document scroll
    // и не являются условием допуска прокрутки.
    const scrollX = params.scrollX;
    const scrollY = params.scrollY;
    if (typeof scrollX !== 'number' || typeof scrollY !== 'number') {
      logger.debug('Multi-control: scroll-событие без числовых scrollX/scrollY пропущено');
      return;
    }
    this.masterScroll = { scrollX, scrollY };

    // Коалесцируем до последнего абсолютного состояния: каждая новая серия
    // инкрементирует generation, pending хранит только последнее состояние.
    // Backlog старых scroll-событий не накапливается, лишних вызовов нет.
    const runPromises = [];
    for (const [id] of this.slaves) {
      if (!this.smoothers.has(id)) continue;
      const st = this._getScrollState(id);
      st.generation += 1;
      st.pending = { scrollX, scrollY, generation: st.generation };
      runPromises.push(this._runScrollLoop(id));
    }
    await Promise.all(runPromises);
  }

  _getScrollState(slaveId) {
    let st = this._scrollRunners.get(slaveId);
    if (!st) {
      st = {
        running: false,
        promise: null,
        syncTimer: null,
        pending: null,
        generation: 0,
      };
      this._scrollRunners.set(slaveId, st);
    }
    return st;
  }

  _runScrollLoop(slaveId) {
    const st = this._getScrollState(slaveId);
    if (st.running) return st.promise;
    st.running = true;
    const runPromise = (async () => {
      try {
        while (this.active && this.slaves.has(slaveId)) {
          const pending = st.pending;
          if (!pending) break;
          st.pending = null;
          await this._applyDocumentScroll(slaveId, pending);
        }
        if (this.active && this.slaves.has(slaveId) && st.generation > 0) {
          // После стабилизации серии читаем фактический scroll slave;
          // generation защищает от записи результата устаревшей операции.
          const gen = st.generation;
          st.syncTimer = setTimeout(() => this._syncSlaveScroll(slaveId, gen), SCROLL_TICK_MS);
        }
      } finally {
        st.running = false;
        st.promise = null;
      }
    })();
    st.promise = runPromise;
    return runPromise;
  }

  // Применение абсолютного состояния document scroll slave исключительно через
  // CDP Runtime.callFunctionOn(window.scrollTo) в соответствующей сессии slave.
  // mouseWheel для document scroll не используется.
  async _applyDocumentScroll(slaveId, pending) {
    const st = this._scrollRunners.get(slaveId);
    if (!st || st.generation !== pending.generation) {
      this._debugStats.scrollSyncDiscarded += 1;
      this._logDebugStats();
      return;
    }
    const session = this._getSlaveSession(slaveId);
    if (!session) {
      this._debugStats.scrollSyncDiscarded += 1;
      this._logDebugStats();
      return;
    }
    let applied = false;
    try {
      const result = await this.cdp.scrollToSession(slaveId, session.sessionId, pending.scrollX, pending.scrollY);
      applied = Boolean(result && result.applied);
    } catch (err) {
      logger.debug({ slaveId, error: err.message }, 'Multi-control: ошибка применения document scroll');
    }
    // Неуспешное применение (нет корректной сессии/context, например) — не
    // подменяем состояние slave фиктивным значением, фиксируем discard.
    if (!applied) {
      this._debugStats.scrollSyncDiscarded += 1;
    } else if (st.generation === pending.generation) {
      // Оптимистичная запись запрошенного состояния; фактическое значение
      // (с учётом clamp) фиксирует _syncSlaveScroll после стабилизации.
      const slaveData = this.slaves.get(slaveId);
      if (slaveData) slaveData.scroll = { scrollX: pending.scrollX, scrollY: pending.scrollY };
    }
    this._logDebugStats();
  }

  async _syncSlaveScroll(slaveId, generation) {
    if (!this.cdp || !this.slaves.has(slaveId)) return;
    const st = this._scrollRunners.get(slaveId);
    if (!st || st.generation !== generation) {
      this._debugStats.scrollSyncDiscarded += 1;
      this._logDebugStats();
      return;
    }
    const session = this._getSlaveSession(slaveId);
    if (!session) {
      this._debugStats.scrollSyncDiscarded += 1;
      this._logDebugStats();
      return;
    }
    try {
      const scroll = await this.cdp.getPageScrollForSession(slaveId, session.sessionId);
      const slaveData = this.slaves.get(slaveId);
      if (slaveData && st.generation === generation) {
        slaveData.scroll = scroll;
        this._debugStats.scrollSyncApplied += 1;
      } else {
        this._debugStats.scrollSyncDiscarded += 1;
      }
    } catch (err) {
      logger.debug({ slaveId, error: err.message }, 'Multi-control: ошибка синхронизации slave scroll');
    }
    this._logDebugStats();
  }

  _cancelScrollTimers(profileId) {
    const ids = profileId ? [profileId] : Array.from(this._scrollRunners.keys());
    for (const id of ids) {
      const st = this._scrollRunners.get(id);
      if (!st) continue;
      if (st.syncTimer) {
        clearTimeout(st.syncTimer);
        st.syncTimer = null;
      }
      st.pending = null;
    }
  }

  _dispatchSlaveMove(slaveId, x, y) {
    this._debugStats.dispatchCount += 1;
    const session = this._getSlaveSession(slaveId);
    if (session) {
      this.cdp.dispatchMouseEventToSession(slaveId, session.sessionId, 'mouseMoved', { x, y });
    } else {
      this.cdp.dispatchMouseEvent(slaveId, 'mouseMoved', { x, y });
    }
    this._logDebugStats();
  }

  async _broadcastMouse(type, params) {
    if (!this.cdp) {
      logger.warn('Multi-control: _broadcastMouse called but cdp is null');
      return;
    }
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
