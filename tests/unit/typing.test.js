import { describe, it, expect, vi } from 'vitest';

describe('Typing Module', () => {
  describe('randomDelay', () => {
    it('генерирует задержку в пределах диапазона', async () => {
      const { randomDelay } = await import('../../src/typing/index.js');
      for (let i = 0; i < 100; i++) {
        const delay = randomDelay(50, 150);
        expect(delay).toBeGreaterThanOrEqual(50);
        expect(delay).toBeLessThanOrEqual(150);
      }
    });

    it('генерирует разные задержки', async () => {
      const { randomDelay } = await import('../../src/typing/index.js');
      const delays = new Set();
      for (let i = 0; i < 50; i++) {
        delays.add(randomDelay(50, 150));
      }
      expect(delays.size).toBeGreaterThan(1);
    });

    it('работает с кастомным диапазоном', async () => {
      const { randomDelay } = await import('../../src/typing/index.js');
      const delay = randomDelay(100, 100);
      expect(delay).toBe(100);
    });

    it('средняя задержка близка к центру диапазона', async () => {
      const { randomDelay } = await import('../../src/typing/index.js');
      const delays = [];
      for (let i = 0; i < 1000; i++) {
        delays.push(randomDelay(50, 150));
      }
      const avg = delays.reduce((a, b) => a + b, 0) / delays.length;
      expect(avg).toBeGreaterThan(80);
      expect(avg).toBeLessThan(120);
    });
  });

  describe('humanType (async delays)', () => {
    it('вводит текст с задержками 50-150мс между символами', async () => {
      const timestamps = [];
      const mockSession = {
        send: vi.fn(async () => {
          timestamps.push(Date.now());
        }),
      };

      vi.spyOn(Math, 'random').mockReturnValue(0.5);

      vi.doMock('../../src/logger/index.js', () => ({
        logger: { debug: vi.fn() },
      }));

      const { humanType } = await import('../../src/typing/index.js');

      await humanType(mockSession, 'ab');

      Math.random.mockRestore();

      expect(timestamps.length).toBe(2);

      const interval = timestamps[1] - timestamps[0];
      expect(interval).toBeGreaterThanOrEqual(40);
      expect(interval).toBeLessThanOrEqual(200);
    });

    it('вызывает send для каждого символа', async () => {
      const mockSession = {
        send: vi.fn(async () => {}),
      };

      vi.doMock('../../src/logger/index.js', () => ({
        logger: { debug: vi.fn() },
      }));

      const { humanType } = await import('../../src/typing/index.js');

      await humanType(mockSession, 'test');

      const keyEvents = mockSession.send.mock.calls.filter(
        c => c[1]?.type === 'keyDown'
      );
      expect(keyEvents.length).toBeGreaterThanOrEqual(4);
    });

    it('вызывает Input.dispatchKeyEvent как CDP метод', async () => {
      const mockSession = {
        send: vi.fn(async () => {}),
      };

      vi.doMock('../../src/logger/index.js', () => ({
        logger: { debug: vi.fn() },
      }));

      const { humanType } = await import('../../src/typing/index.js');

      await humanType(mockSession, 'x');

      expect(mockSession.send).toHaveBeenCalledWith(
        'Input.dispatchKeyEvent',
        expect.objectContaining({ type: 'keyDown', text: 'x' })
      );
    });
  });
});
