import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { MouseSmoother } from '../../src/multi-control/mouse-smoothing.js';

function mockPath(from, to) {
  const pts = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    pts.push({
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
      timestamp: i * 8,
    });
  }
  return pts;
}

describe('MouseSmoother', () => {
  let dispatched;
  let smoother;
  let pathSpy;

  beforeEach(() => {
    dispatched = [];
    pathSpy = vi.fn(mockPath);
    smoother = new MouseSmoother({
      dispatch: (x, y) => dispatched.push({ x, y }),
      stepInterval: 1,
      moveSpeed: 5,
      pathFn: pathSpy,
    });
    smoother.setCurrent(0, 0);
  });

  it('dispatches all points from path(), final point = target', async () => {
    dispatched = [];
    smoother = new MouseSmoother({
      dispatch: (x, y) => dispatched.push({ x, y }),
      stepInterval: 1,
      moveSpeed: 5,
      maxLagMs: 1e9,
      pathFn: pathSpy,
    });
    smoother.setCurrent(0, 0);
    smoother.setTarget(100, 50);
    await new Promise(r => setTimeout(r, 200));

    expect(dispatched.length).toBe(11);
    const last = dispatched[dispatched.length - 1];
    expect(last.x).toBe(100);
    expect(last.y).toBe(50);
  });

  it('setTarget during active animation recalculates from current position', async () => {
    smoother.setTarget(200, 0);
    await new Promise(r => setTimeout(r, 5));

    const midX = smoother.current.x;
    pathSpy.mockClear();
    smoother.setTarget(200, 100);
    await new Promise(r => setTimeout(r, 50));

    expect(pathSpy).toHaveBeenCalledWith(
      expect.objectContaining({ x: midX }),
      { x: 200, y: 100 },
      { moveSpeed: 5, useTimestamps: true }
    );
  });

  it('flush() dispatches target immediately and stops animation', async () => {
    smoother.setTarget(100, 100);
    await new Promise(r => setTimeout(r, 2));

    dispatched.length = 0;
    smoother.flush();

    expect(dispatched).toHaveLength(1);
    expect(dispatched[0]).toEqual({ x: 100, y: 100 });
    expect(smoother.current).toEqual({ x: 100, y: 100 });
    expect(smoother._target).toBeNull();
  });

  it('flush() is no-op when no animation active', () => {
    smoother.flush();
    expect(dispatched).toHaveLength(0);
  });

  it('stop() clears timer and prevents further dispatches', async () => {
    smoother.setTarget(100, 100);
    await new Promise(r => setTimeout(r, 200));

    const countBefore = dispatched.length;
    smoother.stop();
    await new Promise(r => setTimeout(r, 50));

    expect(dispatched.length).toBe(countBefore);
    expect(smoother._target).toBeNull();
    expect(smoother._points).toBeNull();
  });

  it('calls pathFn with correct options', () => {
    smoother.setTarget(50, 50);

    expect(pathSpy).toHaveBeenCalledWith(
      { x: 0, y: 0 },
      { x: 50, y: 50 },
      { moveSpeed: 5, useTimestamps: true }
    );
  });

  it('stepInterval controls dispatch timing', async () => {
    const timestamps = [];
    const tsSmoother = new MouseSmoother({
      dispatch: (x, y) => timestamps.push(Date.now()),
      stepInterval: 16,
      useTimestamps: false,
      pathFn: pathSpy,
    });
    tsSmoother.setCurrent(0, 0);
    tsSmoother.setTarget(500, 0);
    await new Promise(r => setTimeout(r, 500));

    if (timestamps.length >= 2) {
      const gap = timestamps[1] - timestamps[0];
      expect(gap).toBeGreaterThanOrEqual(14);
    }
  });

  describe('backpressure устаревших точек', () => {
    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('при сильной задержке Event Loop сразу dispatch финальной точки', () => {
      const points = [];
      const s = new MouseSmoother({ dispatch: (x, y) => points.push({ x, y }), pathFn: pathSpy });
      s._points = mockPath({ x: 0, y: 0 }, { x: 100, y: 0 });
      s._target = { x: 100, y: 0 };
      s._pointIndex = 0;
      s._animationStart = 0;
      s._firstTimestamp = 0;

      // now = 300 мс → lag 300 мс >> maxLagMs (75): все промежуточные устарели
      vi.setSystemTime(new Date(300));
      s._tick();

      expect(points).toEqual([{ x: 100, y: 0 }]);
      expect(s._target).toBeNull();
    });

    it('при умеренном отставании выбирает ближайшую актуальную точку', () => {
      const points = [];
      const s = new MouseSmoother({ dispatch: (x, y) => points.push({ x, y }), pathFn: pathSpy });
      s._points = mockPath({ x: 0, y: 0 }, { x: 100, y: 0 }); // ts 0..80, шаг 8
      s._target = { x: 100, y: 0 };
      s._pointIndex = 0;
      s._animationStart = 0;
      s._firstTimestamp = 0;

      // lag(idx) = 100 - 8*idx; ближайшая с lag <= 75 — idx 4 (ts=32, lag=68)
      vi.setSystemTime(new Date(100));
      s._tick();

      expect(points).toEqual([{ x: 40, y: 0 }]);
      expect(s._pointIndex).toBe(5);
    });

    it('работает в non-timestamp режиме через расписание stepInterval', () => {
      const points = [];
      const s = new MouseSmoother({
        dispatch: (x, y) => points.push({ x, y }),
        useTimestamps: false,
        stepInterval: 10,
        pathFn: pathSpy,
      });
      s._points = [];
      for (let i = 0; i <= 10; i++) s._points.push({ x: i * 10, y: 0 });
      s._target = { x: 100, y: 0 };
      s._pointIndex = 0;
      s._animationStart = 0;
      s._firstTimestamp = null;

      // dueAt = 0 + idx*10; lag(idx) = 100 - 10*idx; ближайшая актуальная — idx 3
      vi.setSystemTime(new Date(100));
      s._tick();

      expect(points).toEqual([{ x: 30, y: 0 }]);
    });

    it('не dispatch-ит после flush() и stop()', () => {
      const points = [];
      const s = new MouseSmoother({
        dispatch: (x, y) => points.push({ x, y }),
        stepInterval: 1,
        pathFn: pathSpy,
      });
      s.setCurrent(0, 0);

      s.setTarget(100, 0);
      s.flush();
      const afterFlush = points.length;
      expect(afterFlush).toBe(1);
      vi.advanceTimersByTime(200);
      expect(points.length).toBe(afterFlush);

      s.setTarget(50, 50);
      s.stop();
      const afterStop = points.length;
      vi.advanceTimersByTime(200);
      expect(points.length).toBe(afterStop);
      expect(s._target).toBeNull();
    });
  });

  describe('timestamp и ресемплирование', () => {
    it('сохраняет и интерполирует timestamp при ресемплировании', () => {
      const s = new MouseSmoother({ dispatch: () => {}, maxPoints: 4, pathFn: pathSpy });
      s.setCurrent(0, 0);
      s.setTarget(100, 50);

      expect(s._points.length).toBeLessThanOrEqual(4);
      for (const p of s._points) {
        expect(typeof p.timestamp).toBe('number');
      }
      for (let i = 1; i < s._points.length; i++) {
        expect(s._points[i].timestamp).toBeGreaterThanOrEqual(s._points[i - 1].timestamp);
      }
    });

    it('финальная точка списка равна target после ресемплирования', () => {
      const s = new MouseSmoother({ dispatch: () => {}, maxPoints: 4, pathFn: pathSpy });
      s.setCurrent(0, 0);
      s.setTarget(250, 150);

      expect(s._points[s._points.length - 1]).toEqual(expect.objectContaining({ x: 250, y: 150 }));
      expect(s._target).toEqual({ x: 250, y: 150 });
    });
  });

  describe('setTarget во время анимации и flush', () => {
    it('setTarget во время активной анимации с последующим flush корректно', async () => {
      const points = [];
      const s = new MouseSmoother({
        dispatch: (x, y) => points.push({ x, y }),
        stepInterval: 1,
        pathFn: pathSpy,
      });
      s.setCurrent(0, 0);
      s.setTarget(100, 0);
      await new Promise(r => setTimeout(r, 2));

      s.setTarget(100, 100);
      s.flush();

      expect(points[points.length - 1]).toEqual({ x: 100, y: 100 });
      expect(s.current).toEqual({ x: 100, y: 100 });
      expect(s._target).toBeNull();
    });
  });
});
