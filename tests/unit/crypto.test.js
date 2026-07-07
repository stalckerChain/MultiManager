import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  encrypt, decrypt, generateMasterKey, deriveKeyFromPassword,
  generateRecoveryKey, recoverFromRecoveryKey, encryptRow, decryptRow, decryptRows,
  setMasterKey, clearMasterKey, hasMasterKey,
  SECRET_FIELDS, PREFIX,
} from '../../src/crypto/index.js';

describe('Crypto Module', () => {
  let masterKey;

  beforeEach(() => {
    masterKey = generateMasterKey();
    setMasterKey(masterKey, 'test');
  });

  afterEach(() => {
    clearMasterKey();
  });

  it('generateMasterKey returns 32-byte buffer', () => {
    const key = generateMasterKey();
    expect(key).toBeInstanceOf(Buffer);
    expect(key.length).toBe(32);
  });

  it('encrypt and decrypt roundtrip', () => {
    const plaintext = 'test-secret-value-123';
    const encrypted = encrypt(plaintext, masterKey);
    expect(encrypted).toContain(PREFIX);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe(plaintext);
  });

  it('encrypt returns null for null input', () => {
    expect(encrypt(null, masterKey)).toBeNull();
    expect(encrypt(undefined, masterKey)).toBeNull();
  });

  it('decrypt returns null for null input', () => {
    expect(decrypt(null, masterKey)).toBeNull();
    expect(decrypt(undefined, masterKey)).toBeNull();
  });

  it('decrypt returns as-is for non-prefixed string', () => {
    const result = decrypt('plain-unencrypted-text', masterKey);
    expect(result).toBe('plain-unencrypted-text');
  });

  it('encrypt produces different ciphertexts for same plaintext', () => {
    const text = 'same-value';
    const a = encrypt(text, masterKey);
    const b = encrypt(text, masterKey);
    expect(a).not.toBe(b);
    expect(decrypt(a, masterKey)).toBe(text);
    expect(decrypt(b, masterKey)).toBe(text);
  });

  it('different key cannot decrypt', () => {
    const text = 'secret-data';
    const encrypted = encrypt(text, masterKey);
    const wrongKey = generateMasterKey();
    const result = decrypt(encrypted, wrongKey);
    expect(result).toBeNull();
  });

  it('deriveKeyFromPassword produces deterministic key', () => {
    const password = 'my-strong-password';
    const salt = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const key1 = deriveKeyFromPassword(password, salt);
    const key2 = deriveKeyFromPassword(password, salt);
    expect(key1).toEqual(key2);
    expect(key1.length).toBe(32);
  });

  it('deriveKeyFromPassword produces different keys for different salts', () => {
    const password = 'same-password';
    const salt1 = Buffer.from('0123456789abcdef0123456789abcdef', 'hex');
    const salt2 = Buffer.from('fedcba9876543210fedcba9876543210', 'hex');
    const key1 = deriveKeyFromPassword(password, salt1);
    const key2 = deriveKeyFromPassword(password, salt2);
    expect(key1).not.toEqual(key2);
  });

  it('generateRecoveryKey and recoverFromRecoveryKey roundtrip', () => {
    const recovery = generateRecoveryKey(masterKey);
    expect(typeof recovery).toBe('string');
    const recovered = recoverFromRecoveryKey(recovery);
    expect(recovered).toEqual(masterKey);
  });

  it('encryptRow encrypts secret fields only', () => {
    const row = {
      id: 'abc-123',
      name: 'test',
      email_password: 'secret-pw',
      twitter_password: 'twitter-pw',
      twitter_auth_token: 'token-123',
      discord_password: 'discord-pw',
      discord_token: 'dc-token',
      wallet_password: 'wallet-pw',
      email: 'test@example.com',
      twitter_username: 'user',
    };
    const encrypted = encryptRow(row);
    expect(encrypted.id).toBe('abc-123');
    expect(encrypted.name).toBe('test');
    expect(encrypted.email).toBe('test@example.com');
    expect(encrypted.twitter_username).toBe('user');
    for (const field of SECRET_FIELDS) {
      expect(encrypted[field]).toContain(PREFIX);
    }
  });

  it('encryptRow returns null for null', () => {
    expect(encryptRow(null)).toBeNull();
  });

  it('decryptRow decrypts secret fields only', () => {
    const original = {
      id: 'abc-123',
      name: 'test',
      email_password: 'secret-pw',
      wallet_password: 'wallet-pw',
      email: 'test@example.com',
    };
    const encrypted = encryptRow(original);
    const decrypted = decryptRow(encrypted);
    expect(decrypted.id).toBe('abc-123');
    expect(decrypted.name).toBe('test');
    expect(decrypted.email).toBe('test@example.com');
    expect(decrypted.email_password).toBe('secret-pw');
    expect(decrypted.wallet_password).toBe('wallet-pw');
  });

  it('decryptRows handles array', () => {
    const rows = [
      { id: '1', email_password: 'pw1', wallet_password: 'wp1' },
      { id: '2', email_password: 'pw2', wallet_password: 'wp2' },
    ];
    const encrypted = rows.map(r => encryptRow(r));
    const decrypted = decryptRows(encrypted);
    expect(decrypted).toHaveLength(2);
    expect(decrypted[0].email_password).toBe('pw1');
    expect(decrypted[1].email_password).toBe('pw2');
  });

  it('decryptRow returns null for null', () => {
    expect(decryptRow(null)).toBeNull();
  });

  it('encrypt handles empty string', () => {
    const encrypted = encrypt('', masterKey);
    const decrypted = decrypt(encrypted, masterKey);
    expect(decrypted).toBe('');
  });

  it('hasMasterKey returns true after setMasterKey', () => {
    expect(hasMasterKey()).toBe(true);
    clearMasterKey();
    expect(hasMasterKey()).toBe(false);
    setMasterKey(masterKey, 'test');
    expect(hasMasterKey()).toBe(true);
  });

  it('SECRET_FIELDS contains all 6 fields', () => {
    expect(SECRET_FIELDS).toEqual([
      'email_password',
      'twitter_password',
      'twitter_auth_token',
      'discord_password',
      'discord_token',
      'wallet_password',
    ]);
  });

  it('encrypted format is aes-256-gcm:iv:ciphertext:tag', () => {
    const encrypted = encrypt('test', masterKey);
    const parts = encrypted.slice(PREFIX.length).split(':');
    expect(parts).toHaveLength(3);
    expect(parts[0]).toMatch(/^[0-9a-f]{32}$/);
    expect(parts[1]).toMatch(/^[0-9a-f]+$/);
    expect(parts[2]).toMatch(/^[0-9a-f]{32}$/);
  });
});
