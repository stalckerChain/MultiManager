const express = require('express');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');
const { URL } = require('url');
const AdmZip = require('adm-zip');
const { getDatabase } = require('../db');

const router = express.Router();

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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function getManifest(extDir) {
  const manifestPath = path.join(extDir, 'manifest.json');
  if (!fs.existsSync(manifestPath)) return null;

  try {
    const data = fs.readFileSync(manifestPath, 'utf-8');
    return JSON.parse(data);
  } catch {
    return null;
  }
}

function listExtensions(dir) {
  const extDir = dir || getExtensionsDir();
  ensureDir(extDir);

  const extensions = [];
  const entries = fs.readdirSync(extDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifest = getManifest(path.join(extDir, entry.name));
    if (!manifest) continue;

    const extPath = path.join(extDir, entry.name);
    extensions.push({
      id: entry.name,
      name: manifest.name || entry.name,
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      enabled: fs.existsSync(path.join(extPath, '.enabled')),
      path: extPath,
    });
  }

  return extensions;
}

router.get('/', (req, res) => {
  try {
    const extensions = listExtensions();
    res.json(extensions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', (req, res) => {
  try {
    const { name, path: extPath } = req.body;

    if (!extPath) {
      return res.status(400).json({ error: 'Extension path is required' });
    }

    if (!fs.existsSync(extPath)) {
      return res.status(404).json({ error: 'Extension path not found' });
    }

    const extDir = getExtensionsDir();
    ensureDir(extDir);

    const targetName = name || path.basename(extPath);
    const targetPath = path.join(extDir, targetName);

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }

    fs.cpSync(extPath, targetPath, { recursive: true });
    fs.writeFileSync(path.join(targetPath, '.enabled'), 'true');

    const manifest = getManifest(targetPath);
    res.status(201).json({
      id: targetName,
      name: manifest?.name || targetName,
      version: manifest?.version || '1.0.0',
      description: manifest?.description || '',
      enabled: true,
      path: targetPath,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/from-store', async (req, res) => {
  try {
    const { url } = req.body;
    if (!url) {
      return res.status(400).json({ error: 'Chrome Web Store URL is required' });
    }

    const extId = extractExtensionId(url);
    if (!extId || !/^[a-z]{32}$/.test(extId)) {
      return res.status(400).json({ error: 'Invalid Chrome Web Store URL or extension ID' });
    }

    const extDir = getExtensionsDir();
    ensureDir(extDir);
    const targetPath = path.join(extDir, extId);

    const crxUrl = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=130.0&acceptformat=crx2,crx3&x=id%3D${extId}%26installsource%3Dondemand%26uc`;
    const buffer = await downloadWithRedirects(crxUrl, 5);

    const zipBuffer = extractZipFromCrx(buffer);
    const zip = new AdmZip(zipBuffer);

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    zip.extractAllTo(targetPath, true);
    fs.writeFileSync(path.join(targetPath, '.enabled'), 'true');

    const manifest = getManifest(targetPath);
    res.status(201).json({
      id: extId,
      name: manifest?.name || extId,
      version: manifest?.version || '1.0.0',
      description: manifest?.description || '',
      enabled: true,
      path: targetPath,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to install from Chrome Web Store: ${err.message}` });
  }
});

router.post('/from-zip', async (req, res) => {
  try {
    const { name, zipPath } = req.body;
    if (!zipPath || !fs.existsSync(zipPath)) {
      return res.status(400).json({ error: 'Valid zip file path is required' });
    }

    const extDir = getExtensionsDir();
    ensureDir(extDir);

    const zip = new AdmZip(zipPath);
    const entries = zip.getEntries();

    const topLevelDirs = new Set();
    for (const entry of entries) {
      const parts = entry.entryName.split('/');
      if (parts.length > 1) topLevelDirs.add(parts[0]);
    }

    if (topLevelDirs.size === 1) {
      const dirName = [...topLevelDirs][0];
      const targetName = name || dirName;
      const targetPath = path.join(extDir, targetName);

      if (fs.existsSync(targetPath)) {
        fs.rmSync(targetPath, { recursive: true, force: true });
      }

      for (const entry of entries) {
        const relativePath = entry.entryName.substring(dirName.length + 1);
        if (!relativePath) continue;
        const fullPath = path.join(targetPath, relativePath);
        if (entry.isDirectory) {
          fs.mkdirSync(fullPath, { recursive: true });
        } else {
          fs.mkdirSync(path.dirname(fullPath), { recursive: true });
          fs.writeFileSync(fullPath, entry.getData());
        }
      }
      fs.writeFileSync(path.join(targetPath, '.enabled'), 'true');

      const manifest = getManifest(targetPath);
      return res.status(201).json({
        id: targetName,
        name: manifest?.name || targetName,
        version: manifest?.version || '1.0.0',
        description: manifest?.description || '',
        enabled: true,
        path: targetPath,
      });
    }

    const targetName = name || path.basename(zipPath, '.zip');
    const targetPath = path.join(extDir, targetName);

    if (fs.existsSync(targetPath)) {
      fs.rmSync(targetPath, { recursive: true, force: true });
    }
    zip.extractAllTo(targetPath, true);
    fs.writeFileSync(path.join(targetPath, '.enabled'), 'true');

    const manifest = getManifest(targetPath);
    res.status(201).json({
      id: targetName,
      name: manifest?.name || targetName,
      version: manifest?.version || '1.0.0',
      description: manifest?.description || '',
      enabled: true,
      path: targetPath,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to install from zip: ${err.message}` });
  }
});

function downloadWithRedirects(urlStr, maxRedirects) {
  return new Promise((resolve, reject) => {
    const doRequest = (currentUrl, remaining) => {
      const mod = currentUrl.startsWith('https') ? https : http;
      mod.get(currentUrl, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36' } }, (res) => {
        if ((res.statusCode === 301 || res.statusCode === 302) && res.headers.location) {
          if (remaining <= 0) {
            return reject(new Error('Too many redirects'));
          }
          const nextUrl = new URL(res.headers.location, currentUrl).href;
          return doRequest(nextUrl, remaining - 1);
        }

        if (res.statusCode !== 200) {
          return reject(new Error(`Server returned ${res.statusCode} ${res.statusMessage}`));
        }

        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => {
          resolve(Buffer.concat(chunks));
        });
      }).on('error', reject);
    };

    doRequest(urlStr, maxRedirects);
  });
}

function extractExtensionId(urlOrId) {
  const trimmed = urlOrId.trim();

  if (/^[a-z]{32}$/.test(trimmed)) return trimmed;

  const match = trimmed.match(/[a-z]{32}/);
  if (match) return match[0];

  return null;
}

function extractZipFromCrx(buffer) {
  if (buffer.slice(0, 4).toString() !== 'Cr24') {
    return buffer;
  }

  const version = buffer.readUInt32LE(4);

  if (version === 2) {
    const pubKeyLength = buffer.readUInt32LE(8);
    const sigLength = buffer.readUInt32LE(12);
    const headerSize = 16 + pubKeyLength + sigLength;
    return buffer.subarray(headerSize);
  }

  if (version === 3) {
    const headerDataLength = buffer.readUInt32LE(8);
    const headerSize = 12 + headerDataLength;
    return buffer.subarray(headerSize);
  }

  return buffer;
}

router.delete('/:id', (req, res) => {
  try {
    const extDir = getExtensionsDir();
    const targetPath = path.join(extDir, req.params.id);

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Extension not found' });
    }

    fs.rmSync(targetPath, { recursive: true, force: true });
    res.status(204).send();
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/toggle', (req, res) => {
  try {
    const extDir = getExtensionsDir();
    const targetPath = path.join(extDir, req.params.id);
    const enabledPath = path.join(targetPath, '.enabled');

    if (!fs.existsSync(targetPath)) {
      return res.status(404).json({ error: 'Extension not found' });
    }

    const currentlyEnabled = fs.existsSync(enabledPath);
    if (currentlyEnabled) {
      fs.unlinkSync(enabledPath);
    } else {
      fs.writeFileSync(enabledPath, 'true');
    }

    res.json({ id: req.params.id, enabled: !currentlyEnabled });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.getExtensionsDir = getExtensionsDir;
module.exports.getManifest = getManifest;
module.exports.listExtensions = listExtensions;
module.exports.extractExtensionId = extractExtensionId;
module.exports.extractZipFromCrx = extractZipFromCrx;
