const express = require('express');
const fs = require('fs');
const path = require('path');
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

function listExtensions() {
  const extDir = getExtensionsDir();
  ensureDir(extDir);

  const extensions = [];
  const entries = fs.readdirSync(extDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const manifest = getManifest(path.join(extDir, entry.name));
    if (!manifest) continue;

    extensions.push({
      id: entry.name,
      name: manifest.name || entry.name,
      version: manifest.version || '1.0.0',
      description: manifest.description || '',
      enabled: true,
      path: path.join(extDir, entry.name),
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
