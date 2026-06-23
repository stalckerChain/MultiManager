import { describe, it, expect } from 'vitest';
import { generateFingerprint, FINGERPRINT_DB } from '../../src/fingerprint/index.js';

const ASPECT_RATIOS = {
  '16:9': 16 / 9,
  '16:10': 16 / 10,
  '4:3': 4 / 3,
  '21:9': 21 / 9,
};

function parseResolution(res) {
  const [w, h] = res.split('x').map(Number);
  return { w, h };
}

function closestRatio(w, h) {
  const ratio = w / h;
  let best = null;
  let bestDiff = Infinity;
  for (const [name, target] of Object.entries(ASPECT_RATIOS)) {
    const diff = Math.abs(ratio - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = name;
    }
  }
  return { name: best, diff: bestDiff };
}

describe('Fingerprint Generator', () => {

  // ── Структура БД ──────────────────────────────────────

  describe('FINGERPRINT_DB structure', () => {
    it('содержит все 3 платформы', () => {
      expect(FINGERPRINT_DB).toHaveProperty('windows');
      expect(FINGERPRINT_DB).toHaveProperty('macos');
      expect(FINGERPRINT_DB).toHaveProperty('linux');
    });

    it('каждая платформа имеет обязательные поля', () => {
      for (const [name, cfg] of Object.entries(FINGERPRINT_DB)) {
        expect(cfg.userAgents?.length).toBeGreaterThanOrEqual(1);
        expect(cfg.resolutions?.length).toBeGreaterThanOrEqual(1);
        expect(cfg.cores?.length).toBeGreaterThanOrEqual(1);
        expect(cfg.memory?.length).toBeGreaterThanOrEqual(1);
        expect(cfg.colorDepth).toEqual([24, 32]);
        expect(cfg.platform).toBeTruthy();
        expect(cfg.userAgentPattern).toBeInstanceOf(RegExp);
      }
    });
  });

  // ── User-Agent ↔ Платформа ────────────────────────────

  describe('User-Agent ↔ Platform match', () => {
    it('macOS UA содержит "Macintosh; Intel Mac OS X"', () => {
      const fp = generateFingerprint('macos');
      expect(fp.user_agent).toMatch(/Macintosh; Intel Mac OS X/);
    });

    it('Windows UA содержит "Windows NT 10.0"', () => {
      const fp = generateFingerprint('windows');
      expect(fp.user_agent).toMatch(/Windows NT 10\.0/);
    });

    it('Linux UA содержит "X11; Linux x86_64"', () => {
      const fp = generateFingerprint('linux');
      expect(fp.user_agent).toMatch(/X11; Linux x86_64/);
    });

    it('macOS UA не содержит Windows/Linux маркеры', () => {
      for (let i = 0; i < 20; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.user_agent).not.toMatch(/Windows NT|X11; Linux/);
      }
    });

    it('Windows UA не содержит macOS/Linux маркеры', () => {
      for (let i = 0; i < 20; i++) {
        const fp = generateFingerprint('windows');
        expect(fp.user_agent).not.toMatch(/Macintosh|X11; Linux/);
      }
    });

    it('Linux UA не содержит Windows/macOS маркеры', () => {
      for (let i = 0; i < 20; i++) {
        const fp = generateFingerprint('linux');
        expect(fp.user_agent).not.toMatch(/Windows NT|Macintosh/);
      }
    });
  });

  // ── Разрешение экрана ─────────────────────────────────

  describe('Screen resolution', () => {
    it('формат WxH', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 10; i++) {
          const fp = generateFingerprint(platform);
          expect(fp.screen_resolution).toMatch(/^\d{3,4}x\d{3,4}$/);
        }
      }
    });

    it('разрешение из白листа платформы', () => {
      for (const [platform, cfg] of Object.entries(FINGERPRINT_DB)) {
        for (let i = 0; i < 20; i++) {
          const fp = generateFingerprint(platform);
          expect(cfg.resolutions).toContain(fp.screen_resolution);
        }
      }
    });

    it('соответствует стандартным пропорциям (±0.06)', () => {
      const MAX_DEVIATION = 0.06;
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 20; i++) {
          const fp = generateFingerprint(platform);
          const { w, h } = parseResolution(fp.screen_resolution);
          const { diff } = closestRatio(w, h);
          expect(diff).toBeLessThan(MAX_DEVIATION);
        }
      }
    });

    it('ширина > высоты (landscape)', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 20; i++) {
          const { w, h } = parseResolution(generateFingerprint(platform).screen_resolution);
          expect(w).toBeGreaterThan(h);
        }
      }
    });
  });

  // ── Железо: ядра ──────────────────────────────────────

  describe('Hardware cores', () => {
    it('ядра из白листа платформы', () => {
      for (const [platform, cfg] of Object.entries(FINGERPRINT_DB)) {
        for (let i = 0; i < 20; i++) {
          const fp = generateFingerprint(platform);
          expect(cfg.cores).toContain(fp.hardware_cores);
        }
      }
    });

    it('яdra ≥ 4 (реалистичный минимум)', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        const fp = generateFingerprint(platform);
        expect(fp.hardware_cores).toBeGreaterThanOrEqual(4);
      }
    });

    it('ядра ≤ 16 (не аномальные значения)', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 20; i++) {
          const fp = generateFingerprint(platform);
          expect(fp.hardware_cores).toBeLessThanOrEqual(16);
        }
      }
    });

    it('нет аномалий типа 7, 11, 13 ядер', () => {
      const anomalies = [3, 5, 7, 9, 11, 13, 15];
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 30; i++) {
          const fp = generateFingerprint(platform);
          expect(anomalies).not.toContain(fp.hardware_cores);
        }
      }
    });
  });

  // ── Железо: ОЗУ ───────────────────────────────────────

  describe('Hardware memory', () => {
    it('ОЗУ из白листа платформы', () => {
      for (const [platform, cfg] of Object.entries(FINGERPRINT_DB)) {
        for (let i = 0; i < 20; i++) {
          const fp = generateFingerprint(platform);
          expect(cfg.memory).toContain(fp.hardware_memory);
        }
      }
    });

    it('ОЗУ ≥ 8 ГБ (реалистичный минимум)', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        const fp = generateFingerprint(platform);
        expect(fp.hardware_memory).toBeGreaterThanOrEqual(8);
      }
    });

    it('нет аномалий типа 7, 11, 13, 15 ГБ', () => {
      const anomalies = [4, 6, 7, 9, 11, 13, 15];
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 30; i++) {
          const fp = generateFingerprint(platform);
          expect(anomalies).not.toContain(fp.hardware_memory);
        }
      }
    });
  });

  // ── Глубина цвета ─────────────────────────────────────

  describe('Color depth', () => {
    it('всегда 24 или 32 бита', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 30; i++) {
          const fp = generateFingerprint(platform);
          expect([24, 32]).toContain(fp.color_depth);
        }
      }
    });
  });

  // ── Fingerprint Seed (UUIDv4) ─────────────────────────

  describe('Fingerprint seed', () => {
    it('формат UUIDv4', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        const fp = generateFingerprint(platform);
        expect(fp.fingerprint_seed).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
        );
      }
    });

    it('уникальность (100 прогонов)', () => {
      const seeds = new Set();
      for (let i = 0; i < 100; i++) {
        seeds.add(generateFingerprint('windows').fingerprint_seed);
      }
      expect(seeds.size).toBe(100);
    });
  });

  // ── Структура ответа ──────────────────────────────────

  describe('Response structure', () => {
    it('содержит все обязательные поля', () => {
      const fp = generateFingerprint('windows');
      expect(fp).toHaveProperty('platform');
      expect(fp).toHaveProperty('user_agent');
      expect(fp).toHaveProperty('screen_resolution');
      expect(fp).toHaveProperty('hardware_cores');
      expect(fp).toHaveProperty('hardware_memory');
      expect(fp).toHaveProperty('color_depth');
      expect(fp).toHaveProperty('fingerprint_seed');
    });

    it('platform совпадает с запрошенной', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        const fp = generateFingerprint(platform);
        expect(fp.platform).toBe(platform);
      }
    });
  });

  // ── Ошибки ────────────────────────────────────────────

  describe('Errors', () => {
    it('неподдерживаемая платформа → Error', () => {
      expect(() => generateFingerprint('android')).toThrow('Неподдерживаемая платформа');
      expect(() => generateFingerprint('ios')).toThrow('Неподдерживаемая платформа');
      expect(() => generateFingerprint('')).toThrow('Неподдерживаемая платформа');
    });
  });

  // ── Cross-platform изоляция ───────────────────────────

  describe('Cross-platform isolation', () => {
    it('macOS ≠ Windows ≠ Linux (100 прогонов)', () => {
      for (let i = 0; i < 100; i++) {
        const mac = generateFingerprint('macos');
        const win = generateFingerprint('windows');
        const lin = generateFingerprint('linux');

        expect(mac.user_agent).not.toBe(win.user_agent);
        expect(mac.user_agent).not.toBe(lin.user_agent);
        expect(win.user_agent).not.toBe(lin.user_agent);
      }
    });

    it('macOS ядра всегда ≥ 8', () => {
      for (let i = 0; i < 30; i++) {
        expect(generateFingerprint('macos').hardware_cores).toBeGreaterThanOrEqual(8);
      }
    });

    it('macOS ОЗУ всегда ≥ 16', () => {
      for (let i = 0; i < 30; i++) {
        expect(generateFingerprint('macos').hardware_memory).toBeGreaterThanOrEqual(16);
      }
    });
  });
});
