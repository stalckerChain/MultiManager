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
   * @param {number} [opts.moveSpeed=5]      - ghost-cursor moveSpeed (больше = медленнее, больше точек)
   * @param {number} [opts.maxPoints=60]     - макс. точек из path() (clamp для избежания перегрузки)
   */
  constructor(opts = {}) {
    this.dispatch = opts.dispatch || (() => {});
    this.stepInterval = opts.stepInterval ?? 8;
    this.moveSpeed = opts.moveSpeed ?? 5;
    this._maxPoints = opts.maxPoints ?? 60;
    this.useTimestamps = opts.useTimestamps !== false;
    this._pathFn = opts.pathFn || path;

    this.current = { x: 0, y: 0 };
    this._points = null;
    this._target = null;
    this._pointIndex = 0;
    this._timer = null;
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

    this._target = target;
    this._points = this._pathFn(from, target, { moveSpeed: this.moveSpeed, useTimestamps: this.useTimestamps });

    // Clamp количество точек — path() может генерировать тысячи при низком moveSpeed.
    // Оставляем начало и конец, прореживаем середину.
    if (this._points.length > this._maxPoints) {
      this._points = _resamplePoints(this._points, this._maxPoints);
    }

    // Гарантировать финальную точку — path() обычно заканчивается точно в target,
    // но на всякий случай принудительно пушим.
    const last = this._points[this._points.length - 1];
    if (last.x !== target.x || last.y !== target.y) {
      this._points.push({ x: target.x, y: target.y });
    }

    this._pointIndex = 0;
    this._scheduleTick();
  }

  /**
   * Немедленно дослать финальную точку текущей анимации и остановить loop.
   * Гарантирует, что курсор окажется в целевой точке перед mousePressed.
   */
  flush() {
    if (!this._target) return;
    this._cancelTimer();

    // Досылаем финальную точку без jitter — точно в цель
    this.dispatch(this._target.x, this._target.y);
    this.current = { ...this._target };

    this._resetAnimation();
  }

  /**
   * Полная остановка и очистка состояния.
   */
  stop() {
    this._cancelTimer();
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
  }

  _scheduleTick() {
    if (this.useTimestamps && this._points && this._pointIndex < this._points.length - 1) {
      const cur = this._points[this._pointIndex];
      const next = this._points[this._pointIndex + 1];
      const delta = next.timestamp - cur.timestamp;
      const delay = Math.min(50, Math.max(4, delta));
      this._timer = setTimeout(() => {
        this._timer = null;
        this._tick();
      }, delay);
    } else {
      this._timer = setTimeout(() => {
        this._timer = null;
        this._tick();
      }, this.stepInterval);
    }
  }

  _tick() {
    if (!this._points || !this._target) return;

    if (this._pointIndex >= this._points.length) {
      this._resetAnimation();
      return;
    }

    const point = this._points[this._pointIndex];
    this._pointIndex += 1;

    // Последняя точка — без jitter, точно в цель
    const isLast = this._pointIndex >= this._points.length;

    this.dispatch(point.x, point.y);
    this.current = point;

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
 *
 * @param {Array<{x:number,y:number}>} points
 * @param {number} targetCount
 * @returns {Array<{x:number,y:number}>}
 */
function _resamplePoints(points, targetCount) {
  if (points.length <= targetCount) return points;

  const result = [];
  for (let i = 0; i < targetCount; i++) {
    const t = i / (targetCount - 1);
    const idx = t * (points.length - 1);
    const lo = Math.floor(idx);
    const hi = Math.min(lo + 1, points.length - 1);
    const frac = idx - lo;

    result.push({
      x: points[lo].x + (points[hi].x - points[lo].x) * frac,
      y: points[lo].y + (points[hi].y - points[lo].y) * frac,
    });
  }
  return result;
}

module.exports = { MouseSmoother };
