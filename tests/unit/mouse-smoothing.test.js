import { describe, it, expect, beforeEach, vi } from 'vitest';
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
});
