import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import os from 'os';
import {
  getExtensionsDir,
  getManifest,
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

describe('getManifest', () => {
  const tmpDir = path.join(os.tmpdir(), 'ext-test-manifest-' + Date.now());

  beforeEach(() => {
    fs.mkdirSync(tmpDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('читает валидный manifest.json', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'manifest.json'),
      JSON.stringify({ name: 'Test Ext', version: '2.0.0', description: 'Desc' })
    );
    const result = getManifest(tmpDir);
    expect(result).toEqual({ name: 'Test Ext', version: '2.0.0', description: 'Desc' });
  });

  it('возвращает null при отсутствии manifest.json', () => {
    expect(getManifest(tmpDir)).toBeNull();
  });

  it('возвращает null при невалидном JSON', () => {
    fs.writeFileSync(path.join(tmpDir, 'manifest.json'), '{ invalid json }');
    expect(getManifest(tmpDir)).toBeNull();
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

  it('возвращает пустой массив когда нет расширений', () => {
    const result = listExtensions(testDir);
    expect(result).toEqual([]);
  });

  it('возвращает расширения с правильным полем enabled', () => {
    const ext1Dir = path.join(testDir, 'ext-one');
    const ext2Dir = path.join(testDir, 'ext-two');
    fs.mkdirSync(ext1Dir, { recursive: true });
    fs.mkdirSync(ext2Dir, { recursive: true });

    fs.writeFileSync(path.join(ext1Dir, 'manifest.json'), JSON.stringify({ name: 'Ext One', version: '1.0.0' }));
    fs.writeFileSync(path.join(ext2Dir, 'manifest.json'), JSON.stringify({ name: 'Ext Two', version: '2.0.0' }));
    fs.writeFileSync(path.join(ext2Dir, '.enabled'), 'true');

    const result = listExtensions(testDir);
    expect(result).toHaveLength(2);

    const ext1 = result.find(e => e.id === 'ext-one');
    const ext2 = result.find(e => e.id === 'ext-two');

    expect(ext1.enabled).toBe(false);
    expect(ext2.enabled).toBe(true);
    expect(ext1.name).toBe('Ext One');
    expect(ext2.name).toBe('Ext Two');
  });

  it('пропускает папки без manifest.json', () => {
    fs.mkdirSync(path.join(testDir, 'empty-folder'), { recursive: true });

    const result = listExtensions(testDir);
    expect(result).toHaveLength(0);
  });
});
