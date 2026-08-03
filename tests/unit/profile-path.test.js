import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { getDefaultProfileDir, getBrowserDataDir, validateProfilePath, getDefaultCookiesFile, getExtensionsFromProfileDir } from '../../src/core/profile-path';

describe('profile-path', () => {
  describe('getDefaultProfileDir', () => {
    it('returns a path under CloakManager/profiles', () => {
      const dir = getDefaultProfileDir('test-id');
      expect(dir).toContain('CloakManager');
      expect(dir).toContain('profiles');
      expect(dir).toContain('test-id');
    });

    it('returns absolute path (after join with env var)', () => {
      const dir = getDefaultProfileDir('abc');
      expect(dir.length).toBeGreaterThan(0);
    });
  });

  describe('getBrowserDataDir', () => {
    it('returns default dir when profile_path is null', () => {
      const profile = { id: 'p1', profile_path: null };
      const dir = getBrowserDataDir(profile);
      expect(dir).toContain('BrowserData');
      expect(dir).toContain('p1');
    });

    it('returns default dir when profile_path is undefined', () => {
      const profile = { id: 'p2' };
      const dir = getBrowserDataDir(profile);
      expect(dir).toContain('BrowserData');
      expect(dir).toContain('p2');
    });

    it('returns default dir when profile is empty', () => {
      const dir = getBrowserDataDir({});
      expect(dir).toContain('BrowserData');
    });

    it('returns external path when profile_path is set', () => {
      const profile = { id: 'p3', profile_path: 'C:\\Users\\test\\stAuto0\\config\\chrome_accounts\\auto_001' };
      const dir = getBrowserDataDir(profile);
      expect(dir).toBe('C:\\Users\\test\\stAuto0\\config\\chrome_accounts\\auto_001');
    });

    it('rejects relative external path', () => {
      const profile = { id: 'p4', profile_path: 'some/relative/path' };
      expect(() => getBrowserDataDir(profile)).toThrow(/absolute/);
    });
  });

  describe('validateProfilePath', () => {
    it('accepts null', () => {
      expect(() => validateProfilePath(null)).not.toThrow();
    });

    it('accepts undefined', () => {
      expect(() => validateProfilePath(undefined)).not.toThrow();
    });

    it('accepts empty string', () => {
      expect(() => validateProfilePath('')).not.toThrow();
    });

    it('rejects relative path', () => {
      expect(() => validateProfilePath('relative/path')).toThrow(/absolute/);
    });

    it('rejects path with traversal', () => {
      expect(() => validateProfilePath('C:\\Users\\..\\..\\windows')).toThrow(/traversal/);
    });

    it('rejects path exceeding max length', () => {
      const longPath = 'C:\\' + 'a'.repeat(1025);
      expect(() => validateProfilePath(longPath)).toThrow(/exceeds maximum length/);
    });

    it('accepts valid absolute path', () => {
      expect(() => validateProfilePath('C:\\Users\\test\\profiles\\p1')).not.toThrow();
    });
  });

  describe('getDefaultCookiesFile', () => {
    it('returns path under Default/Cookies for default profile', () => {
      const profile = { id: 'p1', profile_path: null };
      const file = getDefaultCookiesFile(profile);
      expect(file).toContain('Default');
      expect(file.endsWith('Cookies')).toBe(true);
    });

    it('returns path under Default/Cookies for external profile', () => {
      const profile = { id: 'p2', profile_path: 'C:\\Users\\test\\stAuto0\\config\\chrome_accounts\\auto_001' };
      const file = getDefaultCookiesFile(profile);
      expect(file).toBe('C:\\Users\\test\\stAuto0\\config\\chrome_accounts\\auto_001\\Default\\Cookies');
    });
  });

  describe('getExtensionsFromProfileDir', () => {
    let tmpDir;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mm-test-ext-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('returns empty array when Extensions dir does not exist', () => {
      const result = getExtensionsFromProfileDir(tmpDir);
      expect(result).toEqual([]);
    });

    it('returns empty array when no manifest.json found', () => {
      const extDir = path.join(tmpDir, 'Default', 'Extensions', 'some-id');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, 'random.txt'), 'data');
      const result = getExtensionsFromProfileDir(tmpDir);
      expect(result).toEqual([]);
    });

    it('finds extension with manifest.json', () => {
      const extDir = path.join(tmpDir, 'Default', 'Extensions', 'klghhnkeealcohjjanjjdaeeggmfmlpl', '1.0.0');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, 'manifest.json'), '{}');
      const result = getExtensionsFromProfileDir(tmpDir);
      expect(result.length).toBe(1);
      expect(result[0]).toBe(extDir);
    });

    it('finds multiple extensions', () => {
      const ext1 = path.join(tmpDir, 'Default', 'Extensions', 'ext-id-1', '1.0.0');
      fs.mkdirSync(ext1, { recursive: true });
      fs.writeFileSync(path.join(ext1, 'manifest.json'), '{}');

      const ext2 = path.join(tmpDir, 'Default', 'Extensions', 'ext-id-2', '2.0.0');
      fs.mkdirSync(ext2, { recursive: true });
      fs.writeFileSync(path.join(ext2, 'manifest.json'), '{}');

      const result = getExtensionsFromProfileDir(tmpDir);
      expect(result.length).toBe(2);
    });

    it('skips version folders without manifest.json', () => {
      const extDir = path.join(tmpDir, 'Default', 'Extensions', 'ext-id', '1.0.0');
      fs.mkdirSync(extDir, { recursive: true });
      fs.writeFileSync(path.join(extDir, 'background.js'), '// no manifest');
      const result = getExtensionsFromProfileDir(tmpDir);
      expect(result).toEqual([]);
    });
  });
});
