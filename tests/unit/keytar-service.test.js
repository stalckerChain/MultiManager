import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('keytar service name in crypto', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', '..', 'src', 'crypto', 'index.js'), 'utf8');

  it('initKeytar uses keytar.getPassword with service MultiManager', () => {
    expect(src).toContain('keytar.getPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT)');
  });

  it('initKeytar uses keytar.setPassword with service MultiManager', () => {
    expect(src).toContain('keytar.setPassword(KEYTAR_SERVICE, KEYTAR_ACCOUNT,');
  });

  it('does not reference the old CloakManager service', () => {
    expect(src).not.toContain('CloakManager');
  });

  it('KEYTAR_SERVICE constant is MultiManager', () => {
    expect(src).toMatch(/const KEYTAR_SERVICE = 'MultiManager'/);
    expect(src).toMatch(/const KEYTAR_ACCOUNT = 'master-key'/);
  });
});