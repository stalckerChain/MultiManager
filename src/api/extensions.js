const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const crypto = require('crypto');
const { URL } = require('url');
const AdmZip = require('adm-zip');
const os = require('os');
const { getDatabase } = require('../db');
const { logger } = require('../logger');

const router = express.Router();

const LIMITS = Object.freeze({
  MAX_ARCHIVE_SIZE: 10 * 1024 * 1024,
  MAX_UNCOMPRESSED_SIZE: 100 * 1024 * 1024,
  MAX_ENTRIES: 500,
  MAX_PER_FILE_SIZE: 50 * 1024 * 1024,
  MAX_REDIRECTS: 5,
  MAX_DOWNLOAD_SIZE: 20 * 1024 * 1024,
  MAX_NAME_LENGTH: 128,
});

// eslint-disable-next-line no-control-regex
const DANGEROUS_NAME_RE = /\.\.|[\\/:*?"<>|]|[\x00-\x1F]|^[A-Za-z]:/;

function getExtensionsDir() {
  const platform = process.platform;
  const home = process.env.HOME || process.env.USERPROFILE;

  if (platform === 'win32') {
    return path.join(process.env.APPDATA, 'CloakManager', 'extensions');
  } else if (platform === 'darwin') {
    return path.join(home, 'Library', 'Application Support', 'CloakManager', 'extensions');
  } else {
    return path.join(home, '.config', 'CloakManager', 'extensions');
  }
}

async function ensureDir(dir) {
  try {
    await fs.promises.access(dir);
  } catch {
    await fs.promises.mkdir(dir, { recursive: true });
  }
}

async function getManifest(extDir) {
  const manifestPath = path.join(extDir, 'manifest.json');
  try {
    await fs.promises.access(manifestPath);
    const data = await fs.promises.readFile(manifestPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

async function getLocale(extDir) {
  const localesDir = path.join(extDir, '_locales');
  try {
    await fs.promises.access(localesDir);
    const locales = await fs.promises.readdir(localesDir);
    const sysLocale = Intl.DateTimeFormat().resolvedOptions().locale;
    const sysLang = sysLocale.split('-')[0];
    if (locales.includes(sysLocale)) return sysLocale;
    if (locales.includes(sysLang)) return sysLang;
    if (locales.includes('en')) return 'en';
    if (locales.includes('en_US')) return 'en_US';
    return locales[0] || null;
  } catch {
    return null;
  }
}

async function resolveMSG(value, extDir) {
  if (!value || typeof value !== 'string') return value;

  const msgRegex = /__MSG_(\w+)__/g;
  if (!msgRegex.test(value)) return value;
  msgRegex.lastIndex = 0;

  const locale = await getLocale(extDir);
  if (!locale) return value;

  const messagesPath = path.join(extDir, '_locales', locale, 'messages.json');
  try {
    await fs.promises.access(messagesPath);
    const messages = JSON.parse(await fs.promises.readFile(messagesPath, 'utf-8'));
    return value.replace(msgRegex, (_, key) => messages[key]?.message || value);
  } catch {
    return value;
  }
}

async function listExtensions(dir) {
  const extDir = dir || getExtensionsDir();
  await ensureDir(extDir);

  const extensions = [];
  const entries = await fs.promises.readdir(extDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifest = await getManifest(path.join(extDir, entry.name));
    if (!manifest) continue;

    const extPath = path.join(extDir, entry.name);
    let enabled = false;
    try {
      await fs.promises.access(path.join(extPath, '.enabled'));
      enabled = true;
    } catch { /* .enabled file missing */ }

    const name = await resolveMSG(manifest.name, extPath) || entry.name;
    const description = await resolveMSG(manifest.description, extPath) || '';

    extensions.push({
      id: entry.name,
      name,
      version: manifest.version || '1.0.0',
      description,
      enabled,
      path: extPath,
    });
  }

  return extensions;
}

function validateName(name) {
  if (!name || typeof name !== 'string') return false;
  if (name.length > LIMITS.MAX_NAME_LENGTH) return false;
  if (DANGEROUS_NAME_RE.test(name)) return false;
  return true;
}

function isPathInside(targetPath, baseDir) {
  const relative = path.relative(baseDir, targetPath);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return false;
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(relative)) return false;
  return true;
}

function isSafeEntryName(entryName) {
  if (!entryName || typeof entryName !== 'string') return false;
  if (entryName.includes('\0')) return false;
  const normalized = path.normalize(entryName);
  if (normalized.startsWith('..') || path.isAbsolute(normalized)) return false;
  if (process.platform === 'win32' && /^[A-Za-z]:/.test(normalized)) return false;
  return true;
}

function isSymlinkOrHardlink(entry) {
  return !!(entry && (entry.isSymlink || entry.isSymlink?.()));
}

async function safeExtract(zipBuffer, targetName, extDir) {
  const tmpDir = path.join(os.tmpdir(), 'ext-install-' + Date.now() + '-' + crypto.randomBytes(4).toString('hex'));
  let targetPath;

  try {
    await fs.promises.mkdir(tmpDir, { recursive: true });

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    if (entries.length > LIMITS.MAX_ENTRIES) {
      throw new Error(`Archive contains too many entries: ${entries.length} (max ${LIMITS.MAX_ENTRIES})`);
    }

    let totalUncompressed = 0;

    for (const entry of entries) {
      if (isSymlinkOrHardlink(entry)) {
        throw new Error('Archive contains symlink or hardlink entries');
      }

      if (!isSafeEntryName(entry.entryName)) {
        throw new Error(`Unsafe entry name: ${entry.entryName}`);
      }

      const entryPath = path.join(tmpDir, entry.entryName);
      if (!isPathInside(entryPath, tmpDir)) {
        throw new Error(`Entry path traversal detected: ${entry.entryName}`);
      }

      if (entry.isDirectory) {
        await fs.promises.mkdir(entryPath, { recursive: true });
      } else {
        const entryData = entry.getData();
        totalUncompressed += entryData.length;

        if (entryData.length > LIMITS.MAX_PER_FILE_SIZE) {
          throw new Error(`File too large: ${entry.entryName} (${entryData.length} bytes, max ${LIMITS.MAX_PER_FILE_SIZE})`);
        }

        if (totalUncompressed > LIMITS.MAX_UNCOMPRESSED_SIZE) {
          throw new Error(`Total uncompressed size exceeds limit (${LIMITS.MAX_UNCOMPRESSED_SIZE} bytes)`);
        }

        await fs.promises.mkdir(path.dirname(entryPath), { recursive: true });
        await fs.promises.writeFile(entryPath, entryData);
      }
    }

    const manifest = await validateExtensionDir(tmpDir);

    targetPath = path.join(extDir, targetName);
    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    await fs.promises.rename(tmpDir, targetPath);

    return { manifest, targetPath };
  } catch (err) {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* cleanup on best-effort */ }
    throw err;
  }
}

function downloadWithRedirects(urlStr, maxRedirects) {
  return new Promise((resolve, reject) => {
    let aborted = false;

    const doRequest = (currentUrl, remaining) => {
      try {
        const parsed = new URL(currentUrl);
        if (parsed.protocol !== 'https:') {
          return reject(new Error(`Only HTTPS is allowed for downloads`));
        }

        const hostname = parsed.hostname.toLowerCase();
        if (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' ||
            hostname.startsWith('127.') || hostname.startsWith('10.') ||
            hostname.startsWith('192.168.') || hostname.startsWith('172.16.') ||
            hostname === '0.0.0.0' || hostname === '[::]') {
          return reject(new Error(`Private/local addresses are not allowed`));
        }
      } catch (err) {
        return reject(err);
      }

      const req = https.get(currentUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308) && res.headers.location) {
          if (remaining <= 0) {
            res.destroy();
            return reject(new Error('Too many redirects'));
          }

          try {
            const nextUrl = new URL(res.headers.location, currentUrl).href;
            res.destroy();
            return doRequest(nextUrl, remaining - 1);
          } catch (err) {
            res.destroy();
            return reject(err);
          }
        }

        if (res.statusCode !== 200) {
          res.destroy();
          return reject(new Error(`Server returned ${res.statusCode}`));
        }

        const chunks = [];
        let totalSize = 0;

        res.on('data', (chunk) => {
          totalSize += chunk.length;
          if (totalSize > LIMITS.MAX_DOWNLOAD_SIZE) {
            aborted = true;
            req.destroy();
            res.destroy();
            reject(new Error(`Download exceeds maximum size (${LIMITS.MAX_DOWNLOAD_SIZE} bytes)`));
            return;
          }
          chunks.push(chunk);
        });

        res.on('end', () => {
          if (!aborted) {
            resolve(Buffer.concat(chunks));
          }
        });

        res.on('error', (err) => {
          if (!aborted) reject(err);
        });
      });

      req.on('error', (err) => {
        if (!aborted) reject(err);
      });

      req.setTimeout(60000, () => {
        aborted = true;
        req.destroy();
        reject(new Error('Download timed out'));
      });
    };

    doRequest(urlStr, maxRedirects);
  });
}

function extractZipFromCrx(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 4) {
    throw new Error('Not a valid CRX file: buffer too small');
  }

  if (buffer.slice(0, 4).toString() !== 'Cr24') {
    throw new Error('Not a valid CRX file: bad magic bytes');
  }

  const version = buffer.readUInt32LE(4);

  if (version === 2) {
    if (buffer.length < 16) {
      throw new Error('Not a valid CRX file: v2 header truncated');
    }
    const pubKeyLength = buffer.readUInt32LE(8);
    const sigLength = buffer.readUInt32LE(12);
    const headerSize = 16 + pubKeyLength + sigLength;
    if (headerSize < 16 || headerSize > buffer.length) {
      throw new Error('Not a valid CRX file: header exceeds buffer size');
    }
    return buffer.subarray(headerSize);
  }

  if (version === 3) {
    if (buffer.length < 12) {
      throw new Error('Not a valid CRX file: v3 header truncated');
    }
    const headerDataLength = buffer.readUInt32LE(8);
    const headerSize = 12 + headerDataLength;
    if (headerSize < 12 || headerSize > buffer.length) {
      throw new Error('Not a valid CRX file: header exceeds buffer size');
    }
    return buffer.subarray(headerSize);
  }

  throw new Error(`Unsupported CRX version: ${version}`);
}

async function validateExtensionDir(extPath) {
  const manifest = await getManifest(extPath);
  if (!manifest) {
    throw new Error('Missing or invalid manifest.json');
  }
  if (!manifest.name) {
    throw new Error('manifest.json missing "name" field');
  }
  if (!manifest.version) {
    throw new Error('manifest.json missing "version" field');
  }
  if (!manifest.manifest_version || ![2, 3].includes(manifest.manifest_version)) {
    throw new Error('manifest.json must have manifest_version 2 or 3');
  }
  return manifest;
}

function extractExtensionId(urlOrId) {
  const trimmed = urlOrId.trim();

  if (/^[a-z]{32}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/[a-z]{32}/);
  if (match) return match[0];

  return null;
}

function computeRuntimeId(manifestKey) {
  if (!manifestKey || typeof manifestKey !== 'string') return null;
  try {
    const rawKey = Buffer.from(manifestKey, 'base64');
    if (rawKey.length === 0) return null;
    const hash = crypto.createHash('sha256').update(rawKey).digest();
    const first16 = hash.subarray(0, 16);
    const chars = [];
    for (let i = 0; i < 16; i++) {
      const byte = first16[i];
      chars.push(String.fromCharCode(0x61 + (byte >> 4)));
      chars.push(String.fromCharCode(0x61 + (byte & 0x0f)));
    }
    return chars.join('');
  } catch {
    return null;
  }
}

async function resolveRuntimeId(extPath, profilePath) {
  if (profilePath) {
    const securePrefsPath = path.join(profilePath, 'Default', 'Secure Preferences');
    try {
      const data = JSON.parse(await fs.promises.readFile(securePrefsPath, 'utf-8'));
      const settings = data?.extensions?.settings || {};
      for (const [extId, extSettings] of Object.entries(settings)) {
        if (extSettings.path && extSettings.path === extPath) {
          return extId;
        }
      }
    } catch { /* Secure Preferences unavailable */ }
  }

  const manifest = await getManifest(extPath);
  if (manifest && manifest.key) {
    const computedId = computeRuntimeId(manifest.key);
    if (computedId) return computedId;
  }

  return null;
}

const safeError = (res, status, message) => {
  res.status(status).json({ error: message });
};

router.get('/', async (req, res) => {
  try {
    const extensions = await listExtensions();
    res.json(extensions);
  } catch (err) {
    logger.error({ err }, 'Failed to list extensions');
    safeError(res, 500, 'Failed to list extensions');
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, path: extPath } = req.body;

    if (!extPath) {
      return safeError(res, 400, 'Extension path is required');
    }

    if (!fs.existsSync(extPath)) {
      return safeError(res, 404, 'Extension path not found');
    }

    const extDir = getExtensionsDir();
    ensureDir(extDir);

    const targetName = name || path.basename(extPath);

    if (!validateName(targetName)) {
      return safeError(res, 400, 'Invalid extension name');
    }

    const targetPath = path.join(extDir, targetName);
    if (!isPathInside(targetPath, extDir)) {
      return safeError(res, 400, 'Invalid extension path');
    }

    let manifest;
    try {
      manifest = await validateExtensionDir(extPath);
    } catch (err) {
      return safeError(res, 400, err.message);
    }

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    fs.cpSync(extPath, targetPath, { recursive: true });

    res.status(201).json({
      id: targetName,
      name: await resolveMSG(manifest.name, targetPath) || targetName,
      version: manifest.version || '1.0.0',
      description: await resolveMSG(manifest.description, targetPath) || '',
      enabled: false,
      path: targetPath,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to add extension');
    safeError(res, 500, 'Failed to add extension');
  }
});

router.post('/from-store', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return safeError(res, 400, 'Chrome Web Store URL is required');
    }

    const extId = extractExtensionId(url);
    if (!extId || !/^[a-z]{32}$/.test(extId)) {
      return safeError(res, 400, 'Invalid Chrome Web Store URL or extension ID');
    }

    const extDir = getExtensionsDir();
    ensureDir(extDir);

    const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${extId}%26installsource%3Dondemand%26uc`;

    let buffer;
    try {
      buffer = await downloadWithRedirects(crxUrl, LIMITS.MAX_REDIRECTS);
    } catch (err) {
      logger.error({ err, extId }, 'Failed to download extension');
      return safeError(res, 400, `Failed to download extension: ${err.message}`);
    }

    let zipBuffer;
    try {
      zipBuffer = extractZipFromCrx(buffer);
    } catch (err) {
      logger.error({ err, extId }, 'Failed to extract CRX');
      return safeError(res, 400, err.message);
    }

    if (zipBuffer.length > LIMITS.MAX_ARCHIVE_SIZE) {
      return safeError(res, 400, `Archive exceeds maximum size (${LIMITS.MAX_ARCHIVE_SIZE} bytes)`);
    }

    let result;
    try {
      result = await safeExtract(zipBuffer, extId, extDir);
    } catch (err) {
      logger.error({ err, extId }, 'Failed to extract extension archive');
      return safeError(res, 400, err.message);
    }

    const { manifest, targetPath } = result;

    res.status(201).json({
      id: extId,
      name: await resolveMSG(manifest.name, targetPath) || extId,
      version: manifest.version || '1.0.0',
      description: await resolveMSG(manifest.description, targetPath) || '',
      enabled: false,
      path: targetPath,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to install from Chrome Web Store');
    safeError(res, 500, 'Failed to install from Chrome Web Store');
  }
});

router.post('/from-zip', async (req, res) => {
  try {
    const { name, zipPath } = req.body;
    if (!zipPath || !fs.existsSync(zipPath)) {
      return safeError(res, 400, 'Valid zip file path is required');
    }

    const extDir = getExtensionsDir();
    ensureDir(extDir);

    const stat = fs.statSync(zipPath);
    if (stat.size > LIMITS.MAX_ARCHIVE_SIZE) {
      return safeError(res, 400, `Archive exceeds maximum size (${LIMITS.MAX_ARCHIVE_SIZE} bytes)`);
    }

    const zipBuffer = fs.readFileSync(zipPath);

    if (zipBuffer.length > LIMITS.MAX_ARCHIVE_SIZE) {
      return safeError(res, 400, `Archive exceeds maximum size (${LIMITS.MAX_ARCHIVE_SIZE} bytes)`);
    }

    const zip = new AdmZip(zipBuffer);
    const entries = zip.getEntries();

    const topLevelDirs = new Set();
    for (const entry of entries) {
      const parts = entry.entryName.split('/');
      if (parts.length > 1) topLevelDirs.add(parts[0]);
    }

    let targetName;
    if (topLevelDirs.size === 1) {
      const dirName = [...topLevelDirs][0];
      targetName = name || dirName;
    } else {
      targetName = name || path.basename(zipPath, '.zip');
    }

    if (!validateName(targetName)) {
      return safeError(res, 400, 'Invalid extension name');
    }

    const targetPath = path.join(extDir, targetName);
    if (!isPathInside(targetPath, extDir)) {
      return safeError(res, 400, 'Invalid extension path');
    }

    let result;
    try {
      result = await safeExtract(zipBuffer, targetName, extDir);
    } catch (err) {
      logger.error({ err, targetName }, 'Failed to extract extension archive');
      return safeError(res, 400, err.message);
    }

    const { manifest, targetPath: finalPath } = result;

    res.status(201).json({
      id: targetName,
      name: await resolveMSG(manifest.name, finalPath) || targetName,
      version: manifest.version || '1.0.0',
      description: await resolveMSG(manifest.description, finalPath) || '',
      enabled: false,
      path: finalPath,
    });
  } catch (err) {
    logger.error({ err }, 'Failed to install from zip');
    safeError(res, 500, 'Failed to install from zip');
  }
});

router.delete('/:id', (req, res) => {
  try {
    const extDir = getExtensionsDir();
    const targetPath = path.join(extDir, req.params.id);

    if (!isPathInside(targetPath, extDir)) {
      return safeError(res, 400, 'Invalid extension ID');
    }

    if (!fs.existsSync(targetPath)) {
      return safeError(res, 404, 'Extension not found');
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
    res.status(204).send();
  } catch (err) {
    logger.error({ err }, 'Failed to delete extension');
    safeError(res, 500, 'Failed to delete extension');
  }
});

router.post('/:id/toggle', (req, res) => {
  try {
    const extDir = getExtensionsDir();
    const targetPath = path.join(extDir, req.params.id);

    if (!isPathInside(targetPath, extDir)) {
      return safeError(res, 400, 'Invalid extension ID');
    }

    const enabledPath = path.join(targetPath, '.enabled');

    if (!fs.existsSync(targetPath)) {
      return safeError(res, 404, 'Extension not found');
    }

    const currentlyEnabled = fs.existsSync(enabledPath);
    if (currentlyEnabled) {
      fs.unlinkSync(enabledPath);
    } else {
      fs.writeFileSync(enabledPath, 'true');
    }

    res.json({ id: req.params.id, enabled: !currentlyEnabled });
  } catch (err) {
    logger.error({ err }, 'Failed to toggle extension');
    safeError(res, 500, 'Failed to toggle extension');
  }
});

router.post('/:id/assign-all', (req, res) => {
  try {
    const extDir = getExtensionsDir();
    const targetPath = path.join(extDir, req.params.id);

    if (!isPathInside(targetPath, extDir)) {
      return safeError(res, 400, 'Invalid extension ID');
    }

    if (!fs.existsSync(targetPath)) {
      return safeError(res, 404, 'Extension not found');
    }

    const db = getDatabase();
    const profiles = db.prepare('SELECT id, extensions FROM profiles').all();
    let assigned = 0;

    const assignTx = db.transaction(() => {
      for (const profile of profiles) {
        let exts = [];
        try { exts = JSON.parse(profile.extensions || '[]'); } catch { exts = []; }
        if (!exts.includes(req.params.id)) {
          exts.push(req.params.id);
          db.prepare('UPDATE profiles SET extensions = ? WHERE id = ?').run(JSON.stringify(exts), profile.id);
          assigned++;
        }
      }
    });
    assignTx();

    res.json({ assigned });
  } catch (err) {
    logger.error({ err }, 'Failed to assign extension');
    safeError(res, 500, 'Failed to assign extension');
  }
});

module.exports = router;
module.exports.getExtensionsDir = getExtensionsDir;
module.exports.getManifest = getManifest;
module.exports.getLocale = getLocale;
module.exports.resolveMSG = resolveMSG;
module.exports.listExtensions = listExtensions;
module.exports.extractExtensionId = extractExtensionId;
module.exports.extractZipFromCrx = extractZipFromCrx;
module.exports.computeRuntimeId = computeRuntimeId;
module.exports.resolveRuntimeId = resolveRuntimeId;
module.exports.validateName = validateName;
module.exports.isPathInside = isPathInside;
module.exports.isSafeEntryName = isSafeEntryName;
module.exports.LIMITS = LIMITS;
