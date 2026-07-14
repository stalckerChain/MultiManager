const express = require('express');
const fs = require('fs');
const path = require('path');
const { getAppDir } = require('../logger');

const router = express.Router();

function getCoreLogPath() {
  return path.join(getAppDir(), 'logs', 'core.log');
}

function getProfileLogPath(profileId) {
  return path.join(getAppDir(), 'logs', `profile_${profileId}.log`);
}

router.get('/', async (req, res) => {
  const logPath = getCoreLogPath();

  try {
    await fs.promises.access(logPath);
  } catch {
    return res.json([]);
  }

  try {
    const content = await fs.promises.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const limit = parseInt(req.query.limit) || 100;
    const logs = lines.slice(-limit).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { level: 'info', time: Date.now(), msg: line };
      }
    });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/tail', async (req, res) => {
  const logPath = getCoreLogPath();

  try {
    await fs.promises.access(logPath);
  } catch {
    return res.json({ content: '' });
  }

  try {
    const stat = await fs.promises.stat(logPath);
    const bytes = parseInt(req.query.bytes) || 10240;
    const start = Math.max(0, stat.size - bytes);

    const stream = fs.createReadStream(logPath, { start, encoding: 'utf-8' });
    let content = '';

    stream.on('data', (chunk) => { content += chunk; });
    stream.on('end', () => {
      const lines = content.split('\n');
      const trimmed = lines.length > 100 ? lines.slice(-100) : lines;
      res.json({ content: trimmed.join('\n'), size: stat.size });
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/profile/:profileId', async (req, res) => {
  const logPath = getProfileLogPath(req.params.profileId);

  try {
    await fs.promises.access(logPath);
  } catch {
    return res.json([]);
  }

  try {
    const content = await fs.promises.readFile(logPath, 'utf-8');
    const lines = content.trim().split('\n').filter(Boolean);
    const limit = parseInt(req.query.limit) || 100;
    const logs = lines.slice(-limit).map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { level: 'info', time: Date.now(), msg: line };
      }
    });

    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/files', async (req, res) => {
  const logsDir = path.join(getAppDir(), 'logs');

  try {
    await fs.promises.access(logsDir);
  } catch {
    return res.json([]);
  }

  try {
    const files = (await fs.promises.readdir(logsDir)).filter(f => f.endsWith('.log'));
    const logFiles = [];
    for (const f of files) {
      const stat = await fs.promises.stat(path.join(logsDir, f));
      logFiles.push({
        name: f,
        size: stat.size,
        modified: stat.mtime,
      });
    }
    logFiles.sort((a, b) => b.modified - a.modified);

    res.json(logFiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
