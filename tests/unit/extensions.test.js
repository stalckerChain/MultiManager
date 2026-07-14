import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getExtensionsDir,
  getManifest,
  getLocale,
  resolveMSG,
  listExtensions,
  extractExtensionId,
  extractZipFromCrx,
} from '../../src/api/extensions.js';

const VALID_ID = 'abcdefghijklmnopqrstuvwxyzabcdef';

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
  it('пропускает буфер без Cr24 магии', () => {
    const buf = Buffer.from('PK\x03\x04some zip data');
    const result = extractZipFromCrx(buf);
    expect(result).toBe(buf);
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

    // Use require() — it shares the same Node.js module cache as require() in extensions.js
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
      // Retry removal in case DB file lock hasn't released
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
