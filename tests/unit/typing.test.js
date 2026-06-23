import { describe, it, expect } from 'vitest';
import { randomDelay } from '../../src/typing/index.js';

describe('Typing Module', () => {
  it('генерирует задержку в пределах диапазона', () => {
    for (let i = 0; i < 100; i++) {
      const delay = randomDelay(50, 150);
      expect(delay).toBeGreaterThanOrEqual(50);
      expect(delay).toBeLessThanOrEqual(150);
    }
  });

  it('генерирует разные задержки', () => {
    const delays = new Set();
    for (let i = 0; i < 50; i++) {
      delays.add(randomDelay(50, 150));
    }
    expect(delays.size).toBeGreaterThan(1);
  });

  it('работает с кастомным диапазоном', () => {
    const delay = randomDelay(100, 100);
    expect(delay).toBe(100);
  });
});
