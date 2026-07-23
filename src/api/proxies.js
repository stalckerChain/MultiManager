const express = require('express');
const { getDatabase, createProxyQueries } = require('../db');
const { parseProxy, parseProxyList, checkProxy, rotateProxy, getTimezoneByIp } = require('../proxy');
const { validate, proxyCreateSchema, proxyUpdateSchema, proxyImportSchema } = require('./validate');
const { notFound, conflict, badGateway, serverError } = require('./errors');
const { asyncHandler } = require('./errors');

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const proxies = createProxyQueries(db).getAll();
  res.json(proxies);
});

router.get('/:id', (req, res) => {
  const db = getDatabase();
  const proxy = createProxyQueries(db).getById(req.params.id);

  if (!proxy) {
    throw notFound('Прокси');
  }

  res.json(proxy);
});

router.post('/', validate(proxyCreateSchema), (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);

  const { type, host, port, username, password, proxy_rotation_url } = req.body;

  const existing = queries.findByHostPort(host, port);
  if (existing) {
    throw conflict('Прокси с таким host:port уже существует');
  }

  const proxy = queries.create({ type, host, port, username, password, proxy_rotation_url });
  res.status(201).json(proxy);
});

router.post('/import', validate(proxyImportSchema), (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);

  const { text } = req.body;

  try {
    const proxies = parseProxyList(text);
    const created = [];
    const duplicates = [];
    
    for (const proxy of proxies) {
      const existing = queries.findByHostPort(proxy.host, proxy.port);
      if (existing) {
        duplicates.push(proxy);
      } else {
        const p = queries.create(proxy);
        created.push(p);
      }
    }

    res.status(201).json({
      count: created.length,
      duplicate_count: duplicates.length,
      proxies: created,
      duplicates
    });
  } catch (err) {
    const { badRequest } = require('./errors');
    throw badRequest(err.message);
  }
});

router.put('/:id', validate(proxyUpdateSchema), (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);

  if (!proxy) {
    throw notFound('Прокси');
  }

  const { type, host, port, username, password, proxy_rotation_url, is_active } = req.body;

  const updated = queries.update(req.params.id, {
    type, host, port, username, password, proxy_rotation_url, is_active,
  });
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);

  if (!proxy) {
    throw notFound('Прокси');
  }

  queries.delete(req.params.id);
  res.status(204).send();
});

router.post('/:id/check', async (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);

  if (!proxy) {
    throw notFound('Прокси');
  }

  if (proxy.proxy_rotation_url) {
    try {
      await rotateProxy(proxy.proxy_rotation_url);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      throw badGateway('Ошибка ротации', err.message);
    }
  }

  const result = await checkProxy({
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
  });

  if (result.ok) {
    queries.updateLastIp(req.params.id, result.ip);
    queries.updateActive(req.params.id, true);
    if (result.detectedType && result.detectedType !== proxy.type) {
      db.prepare('UPDATE proxies SET type = ? WHERE id = ?').run(result.detectedType, req.params.id);
    }
    const tzResult = await getTimezoneByIp(result.ip);
    if (tzResult.ok) {
      queries.updateLocation(req.params.id, tzResult.location || null);
    }
  } else {
    queries.updateActive(req.params.id, false);
  }

  res.json(result);
});

router.get('/:id/timezone', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);

  if (!proxy) {
    throw notFound('Прокси');
  }

  if (!proxy.last_ip) {
    throw badGateway('IP прокси не определён. Сначала выполните проверку прокси.');
  }

  const result = await getTimezoneByIp(proxy.last_ip);
  if (!result.ok) {
    throw serverError('Не удалось определить таймзону', result.error);
  }

  res.json({ timezone: result.timezone });
}));

module.exports = router;
