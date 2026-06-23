import { describe, it, expect } from 'vitest';
import { generateFingerprint, FINGERPRINT_DB, RESOLUTION_HARDWARE_MAP, MIN_HARDWARE } from '../../src/fingerprint/index.js';

describe('Fingerprint Edge Cases', () => {

  // ── 1. Ultra-Wide / 4K: тяжёлые разрешения требуют мощного железа ──

  describe('Heavy resolution → minimum hardware', () => {
    const HEAVY_RESOLUTIONS = ['3840x2160', '3440x1440'];

    for (const res of HEAVY_RESOLUTIONS) {
      it(`${res}: ядра ≥ ${RESOLUTION_HARDWARE_MAP[res].minCores}, ОЗУ ≥ ${RESOLUTION_HARDWARE_MAP[res].minMemory}`, () => {
        const req = RESOLUTION_HARDWARE_MAP[res];

        for (let i = 0; i < 200; i++) {
          const fp = generateFingerprint('windows');
          if (fp.screen_resolution === res) {
            expect(fp.hardware_cores).toBeGreaterThanOrEqual(req.minCores);
            expect(fp.hardware_memory).toBeGreaterThanOrEqual(req.minMemory);
          }
        }
      });
    }

    it('никогда не генерирует 4K с 4 ядрами', () => {
      for (let i = 0; i < 500; i++) {
        const fp = generateFingerprint('windows');
        if (fp.screen_resolution === '3840x2160') {
          expect(fp.hardware_cores).toBeGreaterThanOrEqual(8);
        }
      }
    });

    it('никогда не генерирует 4K с 8 ГБ ОЗУ', () => {
      for (let i = 0; i < 500; i++) {
        const fp = generateFingerprint('windows');
        if (fp.screen_resolution === '3840x2160') {
          expect(fp.hardware_memory).toBeGreaterThanOrEqual(16);
        }
      }
    });

    it('Ultra-Wide 3440x1440 требует ≥6 ядер', () => {
      for (let i = 0; i < 500; i++) {
        const fp = generateFingerprint('windows');
        if (fp.screen_resolution === '3440x1440') {
          expect(fp.hardware_cores).toBeGreaterThanOrEqual(6);
        }
      }
    });
  });

  // ── 2. macOS Apple Silicon M-series: WebGL + UA синхронизация ──

  describe('macOS Apple Silicon consistency', () => {
    it('webgl_renderer содержит "Apple GPU" для macOS', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.webgl_renderer).toBe('Apple GPU');
      }
    });

    it('macOS UA всегда содержит "Macintosh; Intel Mac OS X"', () => {
      for (let i = 0; i < 100; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.user_agent).toMatch(/Macintosh; Intel Mac OS X/);
      }
    });

    it('navigator_platform всегда "MacIntel" (совместимость Chromium)', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.navigator_platform).toBe('MacIntel');
      }
    });

    it('macOS webgl_renderer не содержит "Intel" (M-series)', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.webgl_renderer).not.toMatch(/Intel|NVIDIA|AMD/i);
      }
    });

    it('macOS не генерирует разрешение 3840x2160 (нет в whitelist)', () => {
      for (let i = 0; i < 100; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.screen_resolution).not.toBe('3840x2160');
      }
    });

    it('macOS webgl_renderer совместим с паттерном ОС', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('macos');
        const hasAppleRenderer = fp.webgl_renderer.includes('Apple');
        const hasMacUA = /Macintosh/.test(fp.user_agent);
        expect(hasAppleRenderer && hasMacUA).toBe(true);
      }
    });
  });

  // ── 3. Low-end: никогда не опускается ниже безопасного минимума ──

  describe('Low-end minimums (never below safe floor)', () => {
    it('ядра всегда ≥ 2', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 200; i++) {
          const fp = generateFingerprint(platform);
          expect(fp.hardware_cores).toBeGreaterThanOrEqual(MIN_HARDWARE.cores);
        }
      }
    });

    it('ОЗУ всегда ≥ 4 ГБ', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 200; i++) {
          const fp = generateFingerprint(platform);
          expect(fp.hardware_memory).toBeGreaterThanOrEqual(MIN_HARDWARE.memory);
        }
      }
    });

    it('никогда не генерирует 1 core / 1 GB RAM', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 500; i++) {
          const fp = generateFingerprint(platform);
          expect(fp.hardware_cores).not.toBe(1);
          expect(fp.hardware_memory).not.toBe(1);
        }
      }
    });

    it('никогда не генерирует 0 core / 0 GB RAM', () => {
      for (const platform of ['windows', 'macos', 'linux']) {
        for (let i = 0; i < 500; i++) {
          const fp = generateFingerprint(platform);
          expect(fp.hardware_cores).toBeGreaterThan(0);
          expect(fp.hardware_memory).toBeGreaterThan(0);
        }
      }
    });

    it('минимум macOS: 8 ядер, 16 ГБ ОЗУ', () => {
      for (let i = 0; i < 200; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.hardware_cores).toBeGreaterThanOrEqual(8);
        expect(fp.hardware_memory).toBeGreaterThanOrEqual(16);
      }
    });
  });

  // ── 4. Seed уникальность: 1000 сидов без коллизий ──

  describe('Seed uniqueness (1000 fingerprints)', () => {
    it('все 1000 fingerprint_seed уникальны', () => {
      const seeds = new Set();
      const count = 1000;

      for (let i = 0; i < count; i++) {
        const fp = generateFingerprint(
          ['windows', 'macos', 'linux'][i % 3]
        );
        seeds.add(fp.fingerprint_seed);
      }

      expect(seeds.size).toBe(count);
    });

    it('种子 распределены равномерно по платформам', () => {
      const seedsByPlatform = { windows: new Set(), macos: new Set(), linux: new Set() };

      for (let i = 0; i < 3000; i++) {
        const platform = ['windows', 'macos', 'linux'][i % 3];
        const fp = generateFingerprint(platform);
        seedsByPlatform[platform].add(fp.fingerprint_seed);
      }

      expect(seedsByPlatform.windows.size).toBe(1000);
      expect(seedsByPlatform.macos.size).toBe(1000);
      expect(seedsByPlatform.linux.size).toBe(1000);
    });

    it('UUIDv4 формат всех сидов', () => {
      const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
      for (let i = 0; i < 500; i++) {
        const fp = generateFingerprint('windows');
        expect(fp.fingerprint_seed).toMatch(uuidRegex);
      }
    });
  });

  // ── 5. Разрешение и железо: пропорциональность ──

  describe('Resolution ↔ Hardware proportionality', () => {
    it('4K (3840x2160) всегда с ядрами ≥ 8', () => {
      for (let i = 0; i < 1000; i++) {
        const fp = generateFingerprint('windows');
        if (fp.screen_resolution === '3840x2160') {
          expect(fp.hardware_cores).toBeGreaterThanOrEqual(8);
        }
      }
    });

    it('4K всегда с ОЗУ ≥ 16 ГБ', () => {
      for (let i = 0; i < 1000; i++) {
        const fp = generateFingerprint('windows');
        if (fp.screen_resolution === '3840x2160') {
          expect(fp.hardware_memory).toBeGreaterThanOrEqual(16);
        }
      }
    });

    it('1366x768 (low-res) может быть с 4 ядрами', () => {
      let found = false;
      for (let i = 0; i < 200; i++) {
        const fp = generateFingerprint('windows');
        if (fp.screen_resolution === '1366x768' && fp.hardware_cores === 4) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });

    it('суммарное количество комбинаций resolution × cores разумное', () => {
      const combos = new Set();
      for (let i = 0; i < 2000; i++) {
        const fp = generateFingerprint('windows');
        combos.add(`${fp.screen_resolution}x${fp.hardware_cores}C`);
      }
      expect(combos.size).toBeGreaterThan(10);
    });
  });

  // ── 6. Cross-platform WebGL изоляция ──

  describe('WebGL renderer cross-platform isolation', () => {
    it('Windows → NVIDIA/AMD/Intel ANGLE', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('windows');
        expect(fp.webgl_renderer).toMatch(/ANGLE/);
      }
    });

    it('Linux → Mesa DRI Intel', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('linux');
        expect(fp.webgl_renderer).toMatch(/Mesa DRI/);
      }
    });

    it('macOS → Apple GPU', () => {
      for (let i = 0; i < 50; i++) {
        const fp = generateFingerprint('macos');
        expect(fp.webgl_renderer).toBe('Apple GPU');
      }
    });

    it('разные платформы → разные renderer строки', () => {
      const renderers = new Set();
      for (let i = 0; i < 30; i++) {
        renderers.add(generateFingerprint('windows').webgl_renderer);
        renderers.add(generateFingerprint('macos').webgl_renderer);
        renderers.add(generateFingerprint('linux').webgl_renderer);
      }
      expect(renderers.size).toBeGreaterThanOrEqual(3);
    });
  });
});
