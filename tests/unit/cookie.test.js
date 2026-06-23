import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import { parseJsonCookies, parseNetscapeCookies, exportCookiesToJson } from '../../src/cookie/index.js';

describe('Cookie Parser', () => {
  const tmpDir = '/tmp/cookie_test';

  beforeEach(() => {
    if (!fs.existsSync(tmpDir)) {
      fs.mkdirSync(tmpDir, { recursive: true });
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('parseJsonCookies', () => {
    it('парсит JSON куки', () => {
      const cookies = [
        { name: 'session', value: 'abc123', domain: '.example.com', path: '/' },
        { name: 'token', value: 'xyz', domain: '.test.com', path: '/api', httpOnly: true, secure: true },
      ];

      const filePath = path.join(tmpDir, 'cookies.json');
      fs.writeFileSync(filePath, JSON.stringify(cookies));

      const result = parseJsonCookies(filePath);

      expect(result).toHaveLength(2);
      expect(result[0].name).toBe('session');
      expect(result[0].domain).toBe('.example.com');
      expect(result[1].httpOnly).toBe(true);
      expect(result[1].secure).toBe(true);
    });

    it('выбрасывает ошибку для неверного формата', () => {
      const filePath = path.join(tmpDir, 'invalid.json');
      fs.writeFileSync(filePath, '{ "not": "array" }');

      expect(() => parseJsonCookies(filePath)).toThrow('Неверный формат JSON куки');
    });
  });

  describe('parseNetscapeCookies', () => {
    it('парсит Netscape формат', () => {
      const content = `# Netscape HTTP Cookie File
.example.com\tTRUE\t/\tTRUE\t0\tsession\tabc123
.test.com\tFALSE\t/api\tTRUE\t1234567890\ttoken\txyz`;

      const filePath = path.join(tmpDir, 'cookies.txt');
      fs.writeFileSync(filePath, content);

      const result = parseNetscapeCookies(filePath);

      expect(result).toHaveLength(2);
      expect(result[0].domain).toBe('.example.com');
      expect(result[0].httpOnly).toBe(true);
      expect(result[0].secure).toBe(true);
      expect(result[1].path).toBe('/api');
      expect(result[1].expires).toBe(1234567890);
    });

    it('пропускает комментарии и пустые строки', () => {
      const content = `# комментарий

.example.com\tTRUE\t/\tTRUE\t0\tsession\tabc123

# ещё комментарий`;

      const filePath = path.join(tmpDir, 'cookies.txt');
      fs.writeFileSync(filePath, content);

      const result = parseNetscapeCookies(filePath);
      expect(result).toHaveLength(1);
    });
  });

  describe('exportCookiesToJson', () => {
    it('экспортирует куки в JSON', () => {
      const cookies = [
        { name: 'session', value: 'abc123', domain: '.example.com' },
      ];

      const result = JSON.parse(exportCookiesToJson(cookies));

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('session');
    });
  });
});
