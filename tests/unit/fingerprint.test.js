import { describe, it, expect } from 'vitest';
import { generateFingerprint, FINGERPRINT_DB } from '../../src/fingerprint/index.js';

describe('Fingerprint Generator', () => {
  it('генерирует корректный отпечаток для Windows', () => {
    const fp = generateFingerprint('windows');
    
    expect(fp.platform).toBe('windows');
    expect(fp.user_agent).toContain('Windows');
    expect(fp.screen_resolution).toMatch(/^\d+x\d+$/);
    expect(fp.hardware_cores).toBeGreaterThan(0);
    expect(fp.hardware_memory).toBeGreaterThan(0);
    expect(fp.fingerprint_seed).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('генерирует корректный отпечаток для macOS', () => {
    const fp = generateFingerprint('macos');
    
    expect(fp.platform).toBe('macos');
    expect(fp.user_agent).toMatch(/Macintosh|Safari/);
    expect(FINGERPRINT_DB.macos.resolutions).toContain(fp.screen_resolution);
    expect(FINGERPRINT_DB.macos.cores).toContain(fp.hardware_cores);
    expect(FINGERPRINT_DB.macos.memory).toContain(fp.hardware_memory);
  });

  it('генерирует корректный отпечаток для Linux', () => {
    const fp = generateFingerprint('linux');
    
    expect(fp.platform).toBe('linux');
    expect(fp.user_agent).toContain('Linux');
  });

  it('выбрасывает ошибку для неподдерживаемой платформы', () => {
    expect(() => generateFingerprint('android')).toThrow('Неподдерживаемая платформа');
  });

  it('генерирует уникальные fingerprint_seed', () => {
    const fp1 = generateFingerprint('windows');
    const fp2 = generateFingerprint('windows');
    
    expect(fp1.fingerprint_seed).not.toBe(fp2.fingerprint_seed);
  });

  it('User-Agent соответствует платформе', () => {
    const macFp = generateFingerprint('macos');
    const winFp = generateFingerprint('windows');
    
    expect(macFp.user_agent).not.toContain('Windows');
    expect(winFp.user_agent).not.toContain('Macintosh');
  });
});
