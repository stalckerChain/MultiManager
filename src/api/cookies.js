const express = require('express');
const path = require('path');
const fs = require('fs');
const { getDatabase, createCookieQueries, createProfileQueries } = require('../db');
const { parseJsonCookies, parseNetscapeCookies, exportCookiesToJson } = require('../cookie');

const router = express.Router();

router.get('/:profileId', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);
  
  const profile = profileQueries.getById(req.params.profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const cookies = cookieQueries.getByProfileId(req.params.profileId);
  res.json(cookies);
});

router.post('/:profileId/import', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);
  
  const profile = profileQueries.getById(req.params.profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const { format, content } = req.body;
  
  if (!format || !content) {
    return res.status(400).json({ error: 'Обязательные поля: format, content' });
  }

  let cookies;
  try {
    const tmpPath = path.join('/tmp', `cookies_${Date.now()}.txt`);
    fs.writeFileSync(tmpPath, content);
    
    if (format === 'json') {
      cookies = parseJsonCookies(tmpPath);
    } else if (format === 'netscape') {
      cookies = parseNetscapeCookies(tmpPath);
    } else {
      fs.unlinkSync(tmpPath);
      return res.status(400).json({ error: 'Поддерживаемые форматы: json, netscape' });
    }
    
    fs.unlinkSync(tmpPath);
  } catch (err) {
    return res.status(400).json({ error: 'Ошибка парсинга куки', details: err.message });
  }

  cookieQueries.deleteByProfileId(req.params.profileId);
  cookieQueries.import(req.params.profileId, cookies);

  res.json({ count: cookies.length });
});

router.get('/:profileId/export', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);
  
  const profile = profileQueries.getById(req.params.profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const { format } = req.query;
  const cookies = cookieQueries.getByProfileId(req.params.profileId);

  if (format === 'netscape') {
    const lines = cookies.map(c => {
      const flags = [
        c.domain,
        c.http_only ? 'TRUE' : 'FALSE',
        c.path,
        c.secure ? 'TRUE' : 'FALSE',
        c.expires || 0,
        c.name,
        c.value,
      ].join('\t');
      return flags;
    });
    
    res.setHeader('Content-Type', 'text/plain');
    return res.send(lines.join('\n'));
  }

  res.json(cookies);
});

router.delete('/:profileId', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);
  
  const profile = profileQueries.getById(req.params.profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  cookieQueries.deleteByProfileId(req.params.profileId);
  res.status(204).send();
});

module.exports = router;
