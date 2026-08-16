const express = require('express');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { getDatabase, createCookieQueries, createProfileQueries } = require('../db');
const { parseJsonCookies, parseNetscapeCookies } = require('../cookie');
const { validate, cookieImportSchema } = require('./validate');
const { getProfileCookiesViaCdp } = require('./browser');

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

router.post('/:profileId/import', validate(cookieImportSchema), async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);

  const profile = profileQueries.getById(req.params.profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const { format, content } = req.body;

  let cookies;
  let tmpPath;
  try {
    tmpPath = path.join(os.tmpdir(), `cookies_${Date.now()}.txt`);
    await fs.promises.writeFile(tmpPath, content);

    if (format === 'json') {
      cookies = parseJsonCookies(tmpPath);
    } else {
      cookies = parseNetscapeCookies(tmpPath);
    }
  } catch (err) {
    return res.status(400).json({ error: 'Ошибка парсинга куки', details: err.message });
  } finally {
    if (tmpPath) {
      await fs.promises.unlink(tmpPath).catch(() => {});
    }
  }

  cookieQueries.deleteByProfileId(req.params.profileId);
  cookieQueries.import(req.params.profileId, cookies);

  res.json({ count: cookies.length });
});

router.get('/:profileId/export', async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const cookieQueries = createCookieQueries(db);
  
  const profile = profileQueries.getById(req.params.profileId);
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const { format } = req.query;

  // Таблица cookies — очередь одноразового импорта: уже применённые cookies
  // находятся только в нативном хранилище Chromium. Для запущенного профиля
  // берём актуальные cookies через CDP Network.getAllCookies; для остановленного
  // возвращаем только оставшиеся в очереди записи.
  let cookies;
  if (profile.status === 'running') {
    try {
      cookies = (await getProfileCookiesViaCdp(req.params.profileId)) || [];
    } catch (err) {
      return res.status(502).json({ error: 'Ошибка получения cookies через CDP', details: err.message });
    }
  } else {
    cookies = cookieQueries.getByProfileId(req.params.profileId);
  }

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
