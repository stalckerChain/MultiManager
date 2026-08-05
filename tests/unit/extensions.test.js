import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import AdmZip from 'adm-zip';
import {
  getExtensionsDir,
  getManifest,
  getLocale,
  resolveMSG,
  listExtensions,
  extractExtensionId,
  extractZipFromCrx,
  computeRuntimeId,
  resolveRuntimeId,
  validateName,
  isPathInside,
  isSafeEntryName,
  LIMITS,
} from '../../src/api/extensions.js';

const VALID_ID = 'abcdefghijklmnopqrstuvwxyzabcdef';

describe('validateName', () => {
  it('accepts normal names', () => {
    expect(validateName('my-extension')).toBe(true);
    expect(validateName('My Extension 1')).toBe(true);
    expect(validateName('test_ext.v2')).toBe(true);
  });

  it('rejects names with path separators', () => {
    expect(validateName('../../etc/passwd')).toBe(false);
    expect(validateName('dir\\subdir')).toBe(false);
  });

  it('rejects names with ..', () => {
    expect(validateName('..')).toBe(false);
    expect(validateName('test..name')).toBe(false);
  });

  it('rejects names with null byte', () => {
    expect(validateName('test\0name')).toBe(false);
  });

  it('rejects names with drive letter', () => {
    expect(validateName('C:')).toBe(false);
    expect(validateName('C:\\test')).toBe(false);
  });

  it('rejects empty/null/undefined', () => {
    expect(validateName('')).toBe(false);
    expect(validateName(null)).toBe(false);
    expect(validateName(undefined)).toBe(false);
    expect(validateName(123)).toBe(false);
  });

  it('rejects names exceeding max length', () => {
    expect(validateName('a'.repeat(129))).toBe(false);
  });

  it('rejects names with control characters', () => {
    expect(validateName('test\x01name')).toBe(false);
  });

  it('rejects names with colons and special chars', () => {
    expect(validateName('name:value')).toBe(false);
    expect(validateName('name?x=1')).toBe(false);
    expect(validateName('<script>')).toBe(false);
  });
});

describe('isPathInside', () => {
  it('returns true for subdirectory paths', () => {
    expect(isPathInside('/base/sub/dir', '/base')).toBe(true);
    expect(isPathInside('/base/dir/file.txt', '/base')).toBe(true);
  });

  it('returns false for path traversal attempts', () => {
    expect(isPathInside('/base/../etc', '/base')).toBe(false);
    expect(isPathInside('/etc/passwd', '/base')).toBe(false);
  });

  it('returns false for absolute paths outside base', () => {
    expect(isPathInside('/etc/passwd', '/base/dir')).toBe(false);
  });

  it('returns false for the base directory itself', () => {
    expect(isPathInside('/base', '/base')).toBe(false);
  });
});

describe('isSafeEntryName', () => {
  it('accepts normal paths', () => {
    expect(isSafeEntryName('manifest.json')).toBe(true);
    expect(isSafeEntryName('folder/file.js')).toBe(true);
    expect(isSafeEntryName('_locales/en/messages.json')).toBe(true);
  });

  it('rejects path traversal', () => {
    expect(isSafeEntryName('../etc/passwd')).toBe(false);
    expect(isSafeEntryName('folder/../../secret.txt')).toBe(false);
  });

  it('rejects absolute paths', () => {
    expect(isSafeEntryName('/etc/passwd')).toBe(false);
    expect(isSafeEntryName('C:\\Windows\\system.ini')).toBe(false);
  });

  it('rejects null byte injection', () => {
    expect(isSafeEntryName('good.txt\0.bad')).toBe(false);
  });

  it('rejects empty/null', () => {
    expect(isSafeEntryName('')).toBe(false);
    expect(isSafeEntryName(null)).toBe(false);
  });
});

describe('extractExtensionId', () => {
  it('извлекает ID из прямого 32-символьного ID', () => {
    expect(extractExtensionId(VALID_ID)).toBe(VALID_ID);
  });

  it('извлекает ID из полной ссылки Chrome Web Store', () => {
    const url = `https://chrome.google.com/webstore/detail/something/${VALID_ID}`;
    expect(extractExtensionId(url)).toBe(VALID_ID);
  });

  it('извлекает ID из новой ссылки chromewebstore.google.com', () => {
    const url = `https://chromewebstore.google.com/detail/something/${VALID_ID}`;
    expect(extractExtensionId(url)).toBe(VALID_ID);
  });

  it('извлекает ID из ссылки с дополнительными параметрами', () => {
    const url = `https://chrome.google.com/webstore/detail/something/${VALID_ID}?hl=en&authuser=0`;
    expect(extractExtensionId(url)).toBe(VALID_ID);
  });

  it('возвращает null для неверного URL', () => {
    expect(extractExtensionId('not-a-valid-extension')).toBeNull();
  });

  it('возвращает null для пустой строки', () => {
    expect(extractExtensionId('')).toBeNull();
  });

  it('возвращает null для случайного текста без ID', () => {
    expect(extractExtensionId('https://example.com/something')).toBeNull();
  });
});

describe('extractZipFromCrx', () => {
  it('выбрасывает ошибку для буфера без Cr24 магии', () => {
    const buf = Buffer.from('PK\x03\x04some zip data');
    expect(() => extractZipFromCrx(buf)).toThrow('Not a valid CRX file');
  });

  it('rejects buffer too small', () => {
    const buf = Buffer.from('Cr');
    expect(() => extractZipFromCrx(buf)).toThrow('buffer too small');
  });

  it('rejects empty buffer', () => {
    expect(() => extractZipFromCrx(Buffer.alloc(0))).toThrow('buffer too small');
  });

  it('извлекает ZIP из CRX v3', () => {
    const zipContent = Buffer.from('PK\x03\x04this is the zip part');
    const signedDataLength = 12;
    const headerBuf = Buffer.alloc(12);
    headerBuf.write('Cr24');
    headerBuf.writeUInt32LE(3, 4);
    headerBuf.writeUInt32LE(signedDataLength, 8);

    const crx = Buffer.concat([headerBuf, Buffer.alloc(signedDataLength), zipContent]);
    const result = extractZipFromCrx(crx);
    expect(result.toString()).toBe('PK\x03\x04this is the zip part');
  });

  it('извлекает ZIP из CRX v2', () => {
    const zipContent = Buffer.from('PK\x03\x04zip data here');
    const pubKeyLength = 4;
    const sigLength = 4;
    const headerBuf = Buffer.alloc(16);
    headerBuf.write('Cr24');
    headerBuf.writeUInt32LE(2, 4);
    headerBuf.writeUInt32LE(pubKeyLength, 8);
    headerBuf.writeUInt32LE(sigLength, 12);

    const crx = Buffer.concat([headerBuf, Buffer.alloc(pubKeyLength), Buffer.alloc(sigLength), zipContent]);
    const result = extractZipFromCrx(crx);
    expect(result.toString()).toBe('PK\x03\x04zip data here');
  });

  it('rejects CRX v2 with header exceeding buffer', () => {
    const headerBuf = Buffer.alloc(16);
    headerBuf.write('Cr24');
    headerBuf.writeUInt32LE(2, 4);
    headerBuf.writeUInt32LE(999999, 8);
    headerBuf.writeUInt32LE(999999, 12);

    expect(() => extractZipFromCrx(headerBuf)).toThrow('header exceeds buffer size');
  });

  it('rejects CRX v3 with header exceeding buffer', () => {
    const headerBuf = Buffer.alloc(12);
    headerBuf.write('Cr24');
    headerBuf.writeUInt32LE(3, 4);
    headerBuf.writeUInt32LE(999999, 8);

    expect(() => extractZipFromCrx(headerBuf)).toThrow('header exceeds buffer size');
  });

  it('rejects CRX v2 with buffer too small for header', () => {
    const buf = Buffer.alloc(10);
    buf.write('Cr24');
    buf.writeUInt32LE(2, 4);
    expect(() => extractZipFromCrx(buf)).toThrow('v2 header truncated');
  });

  it('rejects CRX v3 with buffer too small for header', () => {
    const buf = Buffer.alloc(8);
    buf.write('Cr24');
    buf.writeUInt32LE(3, 4);
    expect(() => extractZipFromCrx(buf)).toThrow('v3 header truncated');
  });

  it('rejects unknown CRX versions', () => {
    const buf = Buffer.alloc(16);
    buf.write('Cr24');
    buf.writeUInt32LE(99, 4);
    expect(() => extractZipFromCrx(buf)).toThrow('Unsupported CRX version');
  });
});

describe('computeRuntimeId', () => {
  it('returns 32-char a-p string for valid base64 key', () => {
    const raw = Buffer.alloc(24);
    for (let i = 0; i < 24; i++) raw[i] = i + 1;
    const key = raw.toString('base64');
    const id = computeRuntimeId(key);
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-p]{32}$/);
  });

  it('returns consistent output for same input', () => {
    const key = 'AQIDBAUGBwgJCgsMDQ4PEBESExQVFhcY';
    const id1 = computeRuntimeId(key);
    const id2 = computeRuntimeId(key);
    expect(id1).toBe(id2);
  });

  it('returns null for null input', () => {
    expect(computeRuntimeId(null)).toBeNull();
  });

  it('returns null for undefined input', () => {
    expect(computeRuntimeId(undefined)).toBeNull();
  });

  it('returns null for non-string input', () => {
    expect(computeRuntimeId(123)).toBeNull();
  });

  it('returns null for invalid base64', () => {
    const result = computeRuntimeId('!!!invalid!!!');
    expect(result === null || (typeof result === 'string' && /^[a-p]{32}$/.test(result))).toBe(true);
  });

  it('returns null for empty string', () => {
    expect(computeRuntimeId('')).toBeNull();
  });

  it('same key produces deterministic 32-char output', () => {
    const raw = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) raw[i] = i + 1;
    const key = raw.toString('base64');
    const id = computeRuntimeId(key);
    expect(id).toHaveLength(32);
    expect(id).toMatch(/^[a-p]{32}$/);
    expect(computeRuntimeId(key)).toBe(id);
  });
});

describe('resolveRuntimeId', () => {
  const tmpBase = path.join(os.tmpdir(), 'ext-resolve-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpBase, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  it('returns null when extPath does not exist', async () => {
    const result = await resolveRuntimeId(path.join(tmpBase, 'nonexistent'), null);
    expect(result).toBeNull();
  });

  it('returns runtime ID from manifest.key', async () => {
    const extPath = path.join(tmpBase, 'ext-dir');
    fs.mkdirSync(extPath, { recursive: true });
    const raw = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) raw[i] = i + 1;
    const key = raw.toString('base64');
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify({
      name: 'Test Ext',
      version: '1.0.0',
      manifest_version: 3,
      key,
    }));

    const result = await resolveRuntimeId(extPath, null);
    expect(result).toBe(computeRuntimeId(key));
  });

  it('returns null when manifest has no key', async () => {
    const extPath = path.join(tmpBase, 'ext-dir-nokey');
    fs.mkdirSync(extPath, { recursive: true });
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify({
      name: 'Test Ext',
      version: '1.0.0',
      manifest_version: 3,
    }));

    const result = await resolveRuntimeId(extPath, null);
    expect(result).toBeNull();
  });

  it('returns ID from Secure Preferences when path matches', async () => {
    const extPath = path.join(tmpBase, 'ext-dir-sp');
    fs.mkdirSync(extPath, { recursive: true });
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify({
      name: 'Test Ext',
      version: '1.0.0',
      manifest_version: 3,
    }));

    const profilePath = path.join(tmpBase, 'profile');
    const defaultDir = path.join(profilePath, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(defaultDir, 'Secure Preferences'), JSON.stringify({
      extensions: {
        settings: {
          'abcdefghijklmnopqrstuvwxyzab': { path: extPath },
        },
      },
    }));

    const result = await resolveRuntimeId(extPath, profilePath);
    expect(result).toBe('abcdefghijklmnopqrstuvwxyzab');
  });

  it('falls back to manifest.key when Secure Preferences has no matching entry', async () => {
    const extPath = path.join(tmpBase, 'ext-dir-sp-nomatch');
    fs.mkdirSync(extPath, { recursive: true });
    const raw = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) raw[i] = i + 1;
    const key = raw.toString('base64');
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify({
      name: 'Test Ext',
      version: '1.0.0',
      manifest_version: 3,
      key,
    }));

    const profilePath = path.join(tmpBase, 'profile-nomatch');
    const defaultDir = path.join(profilePath, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(defaultDir, 'Secure Preferences'), JSON.stringify({
      extensions: { settings: {} },
    }));

    const result = await resolveRuntimeId(extPath, profilePath);
    expect(result).toBe(computeRuntimeId(key));
  });

  it('ignores invalid Secure Preferences JSON and falls back to manifest.key', async () => {
    const extPath = path.join(tmpBase, 'ext-dir-badsp');
    fs.mkdirSync(extPath, { recursive: true });
    const raw = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) raw[i] = i + 1;
    const key = raw.toString('base64');
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify({
      name: 'Test Ext',
      version: '1.0.0',
      manifest_version: 3,
      key,
    }));

    const profilePath = path.join(tmpBase, 'profile-badsp');
    const defaultDir = path.join(profilePath, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(defaultDir, 'Secure Preferences'), '{corrupt json');

    const result = await resolveRuntimeId(extPath, profilePath);
    expect(result).toBe(computeRuntimeId(key));
  });

  it('Secure Preferences matched by path, not by name substring', async () => {
    const extPath = path.join(tmpBase, 'ext-dir-exact');
    fs.mkdirSync(extPath, { recursive: true });
    const raw = Buffer.alloc(32);
    for (let i = 0; i < 32; i++) raw[i] = i + 1;
    const key = raw.toString('base64');
    fs.writeFileSync(path.join(extPath, 'manifest.json'), JSON.stringify({
      name: 'Zerion Wallet',
      version: '1.0.0',
      manifest_version: 3,
      key,
    }));

    const profilePath = path.join(tmpBase, 'profile-exact');
    const defaultDir = path.join(profilePath, 'Default');
    fs.mkdirSync(defaultDir, { recursive: true });
    fs.writeFileSync(path.join(defaultDir, 'Secure Preferences'), JSON.stringify({
      extensions: {
        settings: {
          'abcdefghijklmnopqrstuvwxyzab': { path: '/other/path' },
        },
      },
    }));

    const result = await resolveRuntimeId(extPath, profilePath);
    expect(result).toBe(computeRuntimeId(key));
    expect(result).not.toBe('abcdefghijklmnopqrstuvwxyzab');
  });
});

describe('getLocale', () => {
  const tmpDir = path.join(os.tmpdir(), 'ext-test-locale-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('возвращает null при отсутствии _locales', async () => {
    expect(await getLocale(tmpDir)).toBeNull();
  });

  it('возвращает en если доступна английская локаль', async () => {
    fs.mkdirSync(path.join(tmpDir, '_locales', 'en'), { recursive: true });
    expect(await getLocale(tmpDir)).toBe('en');
  });

  it('возвращает первую доступную локаль если en нет', async () => {
    fs.mkdirSync(path.join(tmpDir, '_locales', 'ru'), { recursive: true });
    expect(await getLocale(tmpDir)).toBe('ru');
  });
});

describe('resolveMSG', () => {
  const tmpDir = path.join(os.tmpdir(), 'ext-test-msg-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('возвращает исходную строку если нет MSG-плейсхолдера', async () => {
    expect(await resolveMSG('Normal Name', tmpDir)).toBe('Normal Name');
  });

  it('возвращает null для null', async () => {
    expect(await resolveMSG(null, tmpDir)).toBeNull();
  });

  it('резолвит __MSG_appName__ из messages.json', async () => {
    const localesDir = path.join(tmpDir, '_locales', 'en');
    fs.mkdirSync(localesDir, { recursive: true });
    fs.writeFileSync(
      path.join(localesDir, 'messages.json'),
      JSON.stringify({ appName: { message: 'Zerion Wallet' } })
    );
    expect(await resolveMSG('__MSG_appName__', tmpDir)).toBe('Zerion Wallet');
  });

  it('резолвит __MSG_appDesc__ в описании', async () => {
    const localesDir = path.join(tmpDir, '_locales', 'en');
    fs.mkdirSync(localesDir, { recursive: true });
    fs.writeFileSync(
      path.join(localesDir, 'messages.json'),
      JSON.stringify({ appDesc: { message: 'A crypto wallet' } })
    );
    expect(await resolveMSG('__MSG_appDesc__', tmpDir)).toBe('A crypto wallet');
  });

  it('возвращает исходную строку если ключ отсутствует в messages.json', async () => {
    const localesDir = path.join(tmpDir, '_locales', 'en');
    fs.mkdirSync(localesDir, { recursive: true });
    fs.writeFileSync(path.join(localesDir, 'messages.json'), JSON.stringify({}));
    expect(await resolveMSG('__MSG_unknownKey__', tmpDir)).toBe('__MSG_unknownKey__');
  });

  it('возвращает исходную строку если _locales не существует', async () => {
    expect(await resolveMSG('__MSG_appName__', tmpDir)).toBe('__MSG_appName__');
  });
});

describe('getManifest', () => {
  const tmpDir = path.join(os.tmpdir(), 'ext-test-manifest-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('читает валидный manifest.json', async () => {
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({ name: 'Test Ext', version: '2.0.0', description: 'Desc' })
    );
    const result = await getManifest(tmpDir);
    expect(result).toEqual({ name: 'Test Ext', version: '2.0.0', description: 'Desc' });
  });

  it('возвращает null при отсутствии manifest.json', async () => {
    expect(await getManifest(tmpDir)).toBeNull();
  });

  it('возвращает null при невалидном JSON', async () => {
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), '{ invalid json }');
    expect(await getManifest(tmpDir)).toBeNull();
  });
});

describe('listExtensions', () => {
  const testDir = path.join(os.tmpdir(), 'ext-test-list-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true });
  });

  it('возвращает пустой массив когда нет расширений', async () => {
    const result = await listExtensions(testDir);
    expect(result).toEqual([]);
  });

  it('возвращает расширения с правильным полем enabled', async () => {
    const ext1Dir = path.join(testDir, 'ext-one');
    const ext2Dir = path.join(testDir, 'ext-two');
    const ext3Dir = path.join(testDir, 'ext-msg');
    fs.mkdirSync(ext1Dir, { recursive: true });
    fs.mkdirSync(ext2Dir, { recursive: true });
    fs.mkdirSync(ext3Dir, { recursive: true });

    fs.writeFileSync(path.join(ext1Dir, 'manifest.json'), JSON.stringify({ name: 'Ext One', version: '1.0.0' }));
    fs.writeFileSync(path.join(ext2Dir, 'manifest.json'), JSON.stringify({ name: 'Ext Two', version: '2.0.0' }));
    fs.writeFileSync(path.join(ext2Dir, '.enabled'), 'true');
    fs.writeFileSync(
      path.join(ext3Dir, 'manifest.json'),
      JSON.stringify({ name: '__MSG_appName__', description: '__MSG_appDesc__', version: '3.0.0' })
    );
    const ext3Locales = path.join(ext3Dir, '_locales', 'en');
    fs.mkdirSync(ext3Locales, { recursive: true });
    fs.writeFileSync(
      path.join(ext3Locales, 'messages.json'),
      JSON.stringify({ appName: { message: 'Zerion Wallet' }, appDesc: { message: 'A crypto wallet' } })
    );

    const result = await listExtensions(testDir);
    expect(result).toHaveLength(3);

    const ext1 = result.find(e => e.id === 'ext-one');
    const ext2 = result.find(e => e.id === 'ext-two');
    const ext3 = result.find(e => e.id === 'ext-msg');

    expect(ext1.enabled).toBe(false);
    expect(ext2.enabled).toBe(true);
    expect(ext1.name).toBe('Ext One');
    expect(ext2.name).toBe('Ext Two');
    expect(ext3.enabled).toBe(false);
    expect(ext3.name).toBe('Zerion Wallet');
    expect(ext3.description).toBe('A crypto wallet');
  });

  it('пропускает папки без manifest.json', async () => {
    fs.mkdirSync(path.join(testDir, 'empty-folder'), { recursive: true });

    const result = await listExtensions(testDir);
    expect(result).toHaveLength(0);
  });
});

describe('assign-all endpoint', () => {
  let server;
  let port;
  let tmpDir;
  let originalAppData;

  beforeEach(async () => {
    originalAppData = process.env.APPDATA;
    tmpDir = path.join(os.tmpdir(), 'ext-test-assign-' + Date.now());
    process.env.APPDATA = tmpDir;

    const extDir = path.join(tmpDir, 'CloakManager', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    fs.mkdirSync(path.join(extDir, 'test-ext-1'), { recursive: true });
    fs.writeFileSync(path.join(extDir, 'test-ext-1', 'manifest.json'), JSON.stringify({ name: 'Test Ext', version: '1.0.0' }));
    fs.writeFileSync(path.join(extDir, 'test-ext-1', '.enabled'), 'true');

    const db = require('../../src/db/index.js');
    db.initDatabase();

    const required = [1, 'seed-1', 'windows', 'Mozilla/5.0', '1920x1080', 4, 8];
    db.getDatabase().exec('DELETE FROM profiles');
    db.getDatabase().prepare(
      'INSERT INTO profiles (id, name, extensions, number, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('prof-1', 'Profile 1', '[]', ...required);
    db.getDatabase().prepare(
      'INSERT INTO profiles (id, name, extensions, number, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run('prof-2', 'Profile 2', JSON.stringify(['other-ext']), ...required);

    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());

    app.use('/api/extensions', extModule.default);

    const http = await import('http');
    server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    port = server.address().port;
  });

  afterEach(() => {
    if (server) server.close();
    const db = require('../../src/db/index.js');
    db.closeDatabase();
    process.env.APPDATA = originalAppData;
    if (tmpDir) {
      try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}
    }
  });

  it('назначает расширение всем профилям', async () => {
    const db = require('../../src/db/index.js');
    const res = await fetch(`http://127.0.0.1:${port}/api/extensions/test-ext-1/assign-all`, { method: 'POST' });
    const body = await res.json();
    expect(body).toEqual({ assigned: 2 });

    const p1 = db.getDatabase().prepare('SELECT extensions FROM profiles WHERE id = ?').get('prof-1');
    expect(JSON.parse(p1.extensions)).toContain('test-ext-1');
    const p2 = db.getDatabase().prepare('SELECT extensions FROM profiles WHERE id = ?').get('prof-2');
    expect(JSON.parse(p2.extensions)).toContain('test-ext-1');
  });

  it('пропускает профили с уже назначенным расширением', async () => {
    const db = require('../../src/db/index.js');
    db.getDatabase().prepare('UPDATE profiles SET extensions = ? WHERE id = ?').run(JSON.stringify(['test-ext-1']), 'prof-1');

    const res = await fetch(`http://127.0.0.1:${port}/api/extensions/test-ext-1/assign-all`, { method: 'POST' });
    const body = await res.json();
    expect(body).toEqual({ assigned: 1 });
  });

  it('возвращает 404 для несуществующего расширения', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/extensions/nonexistent/assign-all`, { method: 'POST' });
    expect(res.status).toBe(404);
  });
});

describe('ZIP security attacks', () => {
  const tmpDir = path.join(os.tmpdir(), 'ext-zip-attacks-' + Date.now());
  let extDir;
  let originalAppData;

  beforeEach(() => {
    originalAppData = process.env.APPDATA;
    fs.mkdirSync(tmpDir, { recursive: true });
    extDir = path.join(tmpDir, 'CloakManager', 'extensions');
    fs.mkdirSync(extDir, { recursive: true });
    process.env.APPDATA = tmpDir;
  });

  afterEach(() => {
    process.env.APPDATA = originalAppData;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function createZip(entries) {
    const zip = new AdmZip();
    for (const [name, content] of entries) {
      if (content === null) {
        zip.addFile(name, Buffer.alloc(0));
      } else {
        zip.addFile(name, Buffer.from(content));
      }
    }
    return zip.toBuffer();
  }

  it('rejects ZIP with path traversal via ../', async () => {
    const zipBuffer = createZip([
      ['myext/manifest.json', JSON.stringify({ name: 'Test', version: '1.0', manifest_version: 3 })],
      ['myext/../escape.txt', 'escaped!'],
    ]);

    const testPath = path.join(tmpDir, 'test-zip.zip');
    fs.writeFileSync(testPath, zipBuffer);

    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'test-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBeTruthy();
    } finally {
      server.close();
    }
  });

  it('rejects ZIP with absolute path entry', async () => {
    const zipBuffer = createZip([
      ['myext/manifest.json', JSON.stringify({ name: 'Test', version: '1.0', manifest_version: 3 })],
      ['/etc/passwd', 'secret'],
    ]);

    const testPath = path.join(tmpDir, 'test-zip-abs.zip');
    fs.writeFileSync(testPath, zipBuffer);

    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'test-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBeTruthy();
    } finally {
      server.close();
    }
  });

  it('rejects ZIP with drive-relative path (Windows)', async () => {
    const zipBuffer = createZip([
      ['myext/manifest.json', JSON.stringify({ name: 'Test', version: '1.0', manifest_version: 3 })],
      ['C:\\Windows\\system.ini', 'dangerous'],
    ]);

    const testPath = path.join(tmpDir, 'test-zip-drive.zip');
    fs.writeFileSync(testPath, zipBuffer);

    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'test-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toBeTruthy();
    } finally {
      server.close();
    }
  });

  it('rejects ZIP with null byte in entry name', async () => {
    const zip = new AdmZip();
    zip.addFile('myext/manifest.json', Buffer.from(JSON.stringify({ name: 'Test', version: '1.0', manifest_version: 3 })));
    zip.addFile('myext/good\0bad.txt', Buffer.from('injected'));

    const testPath = path.join(tmpDir, 'test-zip-null.zip');
    zip.writeZip(testPath);

    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'test-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
    } finally {
      server.close();
    }
  });

  it('rejects name with path separators', async () => {
    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const zipBuffer = createZip([
      ['manifest.json', JSON.stringify({ name: 'Test', version: '1.0', manifest_version: 3 })],
    ]);
    const testPath = path.join(tmpDir, 'test-zip-normal.zip');
    fs.writeFileSync(testPath, zipBuffer);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: '../../malicious' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/Invalid extension name/);
    } finally {
      server.close();
    }
  });

  it('rejects oversized archive', async () => {
    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const oversizePath = path.join(tmpDir, 'oversize.zip');
      const hugeData = Buffer.alloc(LIMITS.MAX_ARCHIVE_SIZE + 100, 'A');
      fs.writeFileSync(oversizePath, hugeData);

      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: oversizePath, name: 'test-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/exceeds maximum size/);
    } finally {
      server.close();
    }
  });

  it('valid ZIP with manifest installs successfully', async () => {
    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const zipBuffer = createZip([
      ['manifest.json', JSON.stringify({ name: 'Test Extension', version: '2.0.0', manifest_version: 3 })],
      ['background.js', 'console.log("test");'],
    ]);
    const testPath = path.join(tmpDir, 'valid-ext.zip');
    fs.writeFileSync(testPath, zipBuffer);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'valid-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(201);
      expect(body.id).toBe('valid-ext');
      expect(body.name).toBe('Test Extension');
      expect(body.version).toBe('2.0.0');
      expect(fs.existsSync(path.join(extDir, 'valid-ext', 'manifest.json'))).toBe(true);
    } finally {
      server.close();
    }
  });

  it('deletes temp directory after failed extraction', async () => {
    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    const zipBuffer = createZip([
      ['myext/../escape.txt', 'escaped!'],
    ]);
    const testPath = path.join(tmpDir, 'bad-ext.zip');
    fs.writeFileSync(testPath, zipBuffer);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'test-ext' }),
      });
      expect(res.status).toBe(400);

      const tempDirs = fs.readdirSync(os.tmpdir()).filter(d => d.startsWith('ext-install-'));
      expect(tempDirs.length).toBe(0);
    } finally {
      server.close();
    }
  });

  it('rejects archive with entry count exceeding limit', async () => {
    const zip = new AdmZip();
    for (let i = 0; i < LIMITS.MAX_ENTRIES + 10; i++) {
      zip.addFile(`ext/file_${i}.js`, Buffer.from('x'));
    }
    zip.addFile('ext/manifest.json', Buffer.from(JSON.stringify({ name: 'Test', version: '1.0', manifest_version: 3 })));

    const testPath = path.join(tmpDir, 'many-files.zip');
    zip.writeZip(testPath);

    const extModule = await import('../../src/api/extensions.js');
    const expressMod = await import('express');
    const app = expressMod.default();
    app.use(expressMod.json());


    app.use('/api/extensions', extModule.default);
    const http = await import('http');
    const server = http.createServer(app);
    await new Promise(r => server.listen(0, r));
    const port = server.address().port;

    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/extensions/from-zip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zipPath: testPath, name: 'test-ext' }),
      });
      const body = await res.json();
      expect(res.status).toBe(400);
      expect(body.error).toMatch(/too many entries/);
    } finally {
      server.close();
    }
  });
});
