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

router.get('/', (req, res) => {
  const logPath = getCoreLogPath();

  if (!fs.existsSync(logPath)) {
    return res.json([]);
  }

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
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

router.get('/tail', (req, res) => {
  const logPath = getCoreLogPath();

  if (!fs.existsSync(logPath)) {
    return res.json({ content: '' });
  }

  try {
    const stat = fs.statSync(logPath);
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

router.get('/profile/:profileId', (req, res) => {
  const logPath = getProfileLogPath(req.params.profileId);

  if (!fs.existsSync(logPath)) {
    return res.json([]);
  }

  try {
    const content = fs.readFileSync(logPath, 'utf-8');
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

router.get('/files', (req, res) => {
  const logsDir = path.join(getAppDir(), 'logs');

  if (!fs.existsSync(logsDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(logsDir).filter(f => f.endsWith('.log'));
    const logFiles = files.map(f => {
      const stat = fs.statSync(path.join(logsDir, f));
      return {
        name: f,
        size: stat.size,
        modified: stat.mtime,
      };
    }).sort((a, b) => b.modified - a.modified);

    res.json(logFiles);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
