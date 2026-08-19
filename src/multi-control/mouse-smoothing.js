/**
 * Модуль сглаживания движения мыши для слейвов.
 *
 * Гибрид: наш loop (setTimeout-цепочка, flush перед кликом, пересчёт пути)
 + математика из `ghost-cursor` (кубическая Безье + Fitts's Law + overshoot).
 *
 * Класс `MouseSmoother` на каждое `setTarget(x,y)` вызывает `path()` из ghost-cursor,
 * получая массив точек, и диспатчит их в CDP слейва с контролируемым интервалом.
 */

const { path } = require('ghost-cursor');

/**
 * Аниматор траектории курсора для одного слейва.
 *
 * Каждый вызов setTarget(x, y) запускает плавное движение из текущей позиции к новой
 * цели по траектории, сгенерированной `path()` из ghost-cursor (кубическая Безье,
 * Fitts's Law, overshoot). Во время анимации новый setTarget пересчитывает путь из
 * текущей промежуточной позиции (не рвёт движение).
 *
 * flush() немедленно досылает финальную точку текущей анимации и останавливает её —
 * используется перед mousePressed, чтобы курсор оказался точно в целевой точке.
 */
class MouseSmoother {
  /**
   * @param {Object} opts
   * @param {(x:number, y:number)=>void} opts.dispatch - отправка точки в CDP слейва
   * @param {number} [opts.stepInterval=8]   - мс между dispatch'ами (≈125 Гц)
   * @param {number} [opts.moveSpeed=5]      - ghost-cursor moveSpeed (больше = быстрее, меньше точек)
   * @param {number} [opts.maxPoints=60]     - макс. точек из path() (clamp для избежания перегрузки)
   * @param {number} [opts.maxLagMs=75]      - допустимое отставание dispatch (backpressure)
   * @param {(stats:{stalePointsSkipped:number, currentLagMs:number})=>void} [opts.onStats]
   *                                        - отчёт о backpressure-статистике каждого dispatch
   */
  constructor(opts = {}) {
    this.dispatch = opts.dispatch || (() => {});
    this.stepInterval = opts.stepInterval ?? 8;
    this.moveSpeed = opts.moveSpeed ?? 5;
    this._maxPoints = opts.maxPoints ?? 60;
    this.useTimestamps = opts.useTimestamps !== false;
    this._pathFn = opts.pathFn || path;
    this.maxLagMs = opts.maxLagMs ?? 75;
    this._onStats = opts.onStats || null;

    this.current = { x: 0, y: 0 };
    this._points = null;
    this._target = null;
    this._pointIndex = 0;
    this._timer = null;
    this._generation = 0;
    this._animationStart = 0;
    this._firstTimestamp = null;
  }

  /**
   * Установить текущую позицию курсора (например, при инициализации слейва).
   */
  setCurrent(x, y) {
    this.current = { x, y };
  }

  /**
   * Запустить плавное движение к новой цели.
   * Если анимация уже идёт — путь пересчитывается из текущей промежуточной позиции.
   */
  setTarget(x, y) {
    const target = { x, y };

    // Стартовая точка — текущая промежуточная (если анимируется) или последняя известная
    const from = { ...this.current };

    this._cancelTimer();
    this._generation += 1;

    this._target = target;
    this._points = this._pathFn(from, target, { moveSpeed: this.moveSpeed, useTimestamps: this.useTimestamps });

    // Clamp количество точек — path() может генерировать тысячи при низком moveSpeed.
    // Оставляем начало и конец, прореживаем середину (timestamp сохраняются/интерполируются).
    if (this._points.length > this._maxPoints) {
      this._points = _resamplePoints(this._points, this._maxPoints);
    }

    // Гарантировать финальную точку — path() обычно заканчивается точно в target,
    // но на всякий случай принудительно пушим (с сохранением timestamp).
    const last = this._points[this._points.length - 1];
    if (last.x !== target.x || last.y !== target.y) {
      const finalPoint = { x: target.x, y: target.y };
      if (this.useTimestamps && typeof last.timestamp === 'number') {
        finalPoint.timestamp = last.timestamp;
      }
      this._points.push(finalPoint);
    }

    this._pointIndex = 0;
    this._animationStart = Date.now();
    const first = this._points[0];
    this._firstTimestamp = first && typeof first.timestamp === 'number' ? first.timestamp : null;
    this._scheduleTick();
  }

  /**
   * Немедленно дослать финальную точку текущей анимации и остановить loop.
   * Гарантирует, что курсор окажется в целевой точке перед mousePressed.
   */
  flush() {
    if (!this._target) return;
    this._cancelTimer();
    this._generation += 1;

    // Досылаем финальную точку без jitter — точно в цель
    this.dispatch(this._target.x, this._target.y);
    this.current = { ...this._target };

    this._resetAnimation();
  }

  /**
   * Обновить параметры на живом экземпляре без пересоздания.
   * Применяется к следующей траектории и не ломает текущую анимацию.
   */
  updateOptions(opts = {}) {
    if (opts.stepInterval !== undefined) this.stepInterval = opts.stepInterval;
    if (opts.maxPoints !== undefined) this._maxPoints = opts.maxPoints;
  }

  /**
   * Полная остановка и очистка состояния.
   */
  stop() {
    this._cancelTimer();
    this._generation += 1;
    this._resetAnimation();
  }

  _cancelTimer() {
    if (this._timer) {
      clearTimeout(this._timer);
      this._timer = null;
    }
  }

  _resetAnimation() {
    this._points = null;
    this._target = null;
    this._pointIndex = 0;
    this._animationStart = 0;
    this._firstTimestamp = null;
  }

  _scheduleTick() {
    if (this._timer) return;
    const gen = this._generation;
    const cur = this._points && this._points[this._pointIndex];
    const next = this._points && this._points[this._pointIndex + 1];
    const canUseTimestamps = this.useTimestamps &&
      cur && typeof cur.timestamp === 'number' &&
      next && typeof next.timestamp === 'number' &&
      this._pointIndex < this._points.length - 1;

    const delay = canUseTimestamps
      ? Math.min(50, Math.max(4, next.timestamp - cur.timestamp))
      : this.stepInterval;

    this._timer = setTimeout(() => {
      this._timer = null;
      if (gen !== this._generation) return;
      this._tick();
    }, delay);
  }

  _lagFor(now, idx) {
    const point = this._points && this._points[idx];
    if (!point) return 0;
    let dueAt;
    if (this.useTimestamps && this._firstTimestamp !== null && typeof point.timestamp === 'number') {
      dueAt = this._animationStart + (point.timestamp - this._firstTimestamp);
    } else {
      dueAt = this._animationStart + idx * this.stepInterval;
    }
    return now - dueAt;
  }

  _tick() {
    if (!this._points || !this._target) return;

    if (this._pointIndex >= this._points.length) {
      this._resetAnimation();
      return;
    }

    const lastIdx = this._points.length - 1;
    const now = Date.now();

    // Backpressure: при отставании выше maxLagMs пропускаем устаревшие
    // промежуточные точки, выбирая ближайшую актуальную. Финальная точка
    // всегда сохраняется — если устарели все промежуточные, сразу dispatch
    // финальной и завершаем анимацию.
    let idx = this._pointIndex;
    let skipped = 0;
    while (idx < lastIdx && this._lagFor(now, idx) > this.maxLagMs) {
      idx += 1;
      skipped += 1;
    }
    this._pointIndex = idx + 1;

    const point = this._points[idx];
    const isLast = idx >= lastIdx;

    this.dispatch(point.x, point.y);
    this.current = point;

    if (this._onStats) {
      const lag = this._lagFor(now, idx);
      this._onStats({
        stalePointsSkipped: skipped,
        currentLagMs: lag > 0 ? lag : 0,
      });
    }

    if (!isLast) {
      this._scheduleTick();
    } else {
      // Финальная точка уже dispatch'ита, но гарантируем current = target
      this.current = { ...this._target };
      this._resetAnimation();
    }
  }
}

/**
 * Ресемплирование массива точек до заданного числа.
 * Оставляет первую и последнюю точку, равномерно распределяет остальные.
 * Timestamp сохраняются и интерполируются линейно, чтобы не терять
 * расписание и не давать _scheduleTick()/backpressure значение NaN.
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {number} targetCount
 * @returns {Array<{x:number,y:number}>}
 */
function _resamplePoints(points, targetCount) {
  if (points.length <= targetCount) return points;

  const hasTs = points[0] && typeof points[0].timestamp === 'number';
  const result = [];
  for (let i = 0; i < targetCount; i++) {
    const t = i / (targetCount - 1);
    const idx = t * (points.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, points.length - 1);
    const frac = idx - lo;

    const p = {
      x: points[lo].x + (points[hi].x - points[lo].x) * frac,
      y: points[lo].y + (points[hi].y - points[lo].y) * frac,
    };
    if (hasTs) {
      p.timestamp = points[lo].timestamp + (points[hi].timestamp - points[lo].timestamp) * frac;
    }
    result.push(p);
  }
  return result;
}

module.exports = { MouseSmoother };
