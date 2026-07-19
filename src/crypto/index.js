const crypto = require('crypto');

const ALGORITHM = 'aes-256-gcm';
const KEY_LENGTH = 32;
const IV_LENGTH = 16;
const TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 210000;
const PBKDF2_DIGEST = 'sha256';
const PREFIX = 'aes-256-gcm:';

const SECRET_FIELDS = [
  'email_password',
  'twitter_password',
  'twitter_auth_token',
  'discord_password',
  'discord_token',
  'wallet_password',
];

let masterKey = null;
let masterKeySource = null;

function encrypt(plaintext, key) {
  if (plaintext == null) return null;
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let ciphertext = cipher.update(String(plaintext), 'utf8', 'hex');
  ciphertext += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return `${PREFIX}${iv.toString('hex')}:${ciphertext}:${tag}`;
}

function decrypt(blob, key) {
  if (blob == null || typeof blob !== 'string') return null;
  if (!blob.startsWith(PREFIX)) return blob;
  const parts = blob.slice(PREFIX.length).split(':');
  if (parts.length !== 3) return blob;
  const [ivHex, ciphertext, tagHex] = parts;
  try {
    const iv = Buffer.from(ivHex, 'hex');
    const tag = Buffer.from(tagHex, 'hex');
    if (tag.length !== TAG_LENGTH) return blob;
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(tag);
    let plain = decipher.update(ciphertext, 'hex', 'utf8');
    plain += decipher.final('utf8');
    return plain;
  } catch {
    return null;
  }
}

function generateMasterKey() {
  return crypto.randomBytes(KEY_LENGTH);
}

function deriveKeyFromPassword(password, salt) {
  return crypto.pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, KEY_LENGTH, PBKDF2_DIGEST);
}

function generateRecoveryKey(key) {
  return key.toString('base64');
}

function recoverFromRecoveryKey(recoveryKey) {
  return Buffer.from(recoveryKey, 'base64');
}

function encryptRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of SECRET_FIELDS) {
    if (out[field]) {
      out[field] = encrypt(out[field], masterKey);
    }
  }
  return out;
}

function decryptRow(row) {
  if (!row) return row;
  const out = { ...row };
  for (const field of SECRET_FIELDS) {
    if (out[field]) {
      const decrypted = decrypt(out[field], masterKey);
      if (decrypted !== null) out[field] = decrypted;
    }
  }
  return out;
}

function decryptRows(rows) {
  if (!rows) return rows;
  return rows.map(decryptRow);
}

function getMasterKey() {
  return masterKey;
}

function hasMasterKey() {
  return masterKey !== null;
}

function getMasterKeySource() {
  return masterKeySource;
}

function setMasterKey(key, source) {
  masterKey = key;
  masterKeySource = source;
}

function clearMasterKey() {
  masterKey = null;
  masterKeySource = null;
}

async function initKeytar() {
  try {
    const keytar = require('keytar');
    const existing = await keytar.getPassword('CloakManager', 'master-key');
    if (existing) {
      return Buffer.from(existing, 'hex');
    }
    const key = generateMasterKey();
    await keytar.setPassword('CloakManager', 'master-key', key.toString('hex'));
    return key;
  } catch {
    return null;
  }
}

async function initMasterKey(db) {
  if (masterKey) return masterKey;

  const configGet = db.prepare('SELECT value FROM system_config WHERE key = ?');
  const configSet = db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');

  const source = configGet.get('master_key_source');
  const sourceVal = source ? source.value : null;

  if (sourceVal === 'keytar') {
    const key = await initKeytar();
    if (key) {
      masterKey = key;
      masterKeySource = 'keytar';
      return key;
    }
    const fallback = configGet.get('master_key_fallback');
    if (fallback) {
      masterKey = Buffer.from(fallback.value, 'hex');
      masterKeySource = 'system_config';
      return masterKey;
    }
    masterKey = generateMasterKey();
    masterKeySource = 'system_config';
    configSet.run('master_key', masterKey.toString('hex'));
    configSet.run('master_key_source', 'system_config');
    const recovery = generateRecoveryKey(masterKey);
    configSet.run('recovery_key', recovery);
    return masterKey;
  }

  if (sourceVal === 'password') {
    const salt = configGet.get('master_key_salt');
    if (!salt) {
      masterKey = generateMasterKey();
      masterKeySource = 'system_config';
      configSet.run('master_key', masterKey.toString('hex'));
      configSet.run('master_key_source', 'system_config');
      return masterKey;
    }
    return null;
  }

  if (sourceVal === 'system_config') {
    const stored = configGet.get('master_key');
    if (stored) {
      masterKey = Buffer.from(stored.value, 'hex');
      masterKeySource = 'system_config';
      return masterKey;
    }
  }

  const keytarKey = await initKeytar();
  if (keytarKey) {
    masterKey = keytarKey;
    masterKeySource = 'keytar';
    configSet.run('master_key_source', 'keytar');
    configSet.run('master_key', masterKey.toString('hex'));
    return masterKey;
  }

  masterKey = generateMasterKey();
  masterKeySource = 'system_config';
  configSet.run('master_key', masterKey.toString('hex'));
  configSet.run('master_key_source', 'system_config');
  const recovery = generateRecoveryKey(masterKey);
  configSet.run('recovery_key', recovery);
  return masterKey;
}

function unlockWithPassword(password, db) {
  const configGet = db.prepare('SELECT value FROM system_config WHERE key = ?');
  const saltRow = configGet.get('master_key_salt');
  if (!saltRow) return false;
  const salt = Buffer.from(saltRow.value, 'hex');
  const key = deriveKeyFromPassword(password, salt);
  const hashRow = configGet.get('master_key_hash');
  if (!hashRow) return false;
  const storedHash = Buffer.from(hashRow.value, 'hex');
  const keyHash = crypto.createHash('sha256').update(key).digest();
  if (!crypto.timingSafeEqual(keyHash, storedHash)) return false;
  masterKey = key;
  masterKeySource = 'password';
  return true;
}

function rotateKey(oldKey, newKey, db, profileQueries) {
  const profiles = profileQueries.getAll();
  for (const profile of profiles) {
    const updated = {};
    for (const field of SECRET_FIELDS) {
      if (profile[field]) {
        updated[field] = encrypt(decrypt(profile[field], oldKey), newKey);
      }
    }
    if (Object.keys(updated).length > 0) {
      profileQueries.update(profile.id, updated);
    }
  }
}

function getRecoveryKey(db) {
  const configGet = db.prepare('SELECT value FROM system_config WHERE key = ?');
  const row = configGet.get('recovery_key');
  return row ? row.value : null;
}

function clearRecoveryKey(db) {
  const configSet = db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  configSet.run('recovery_key', '');
}

module.exports = {
  encrypt,
  decrypt,
  generateMasterKey,
  deriveKeyFromPassword,
  generateRecoveryKey,
  recoverFromRecoveryKey,
  encryptRow,
  decryptRow,
  decryptRows,
  initMasterKey,
  hasMasterKey,
  getMasterKey,
  getMasterKeySource,
  setMasterKey,
  clearMasterKey,
  unlockWithPassword,
  rotateKey,
  initKeytar,
  getRecoveryKey,
  clearRecoveryKey,
  SECRET_FIELDS,
  PREFIX,
};
