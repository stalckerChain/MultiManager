const express = require('express');
const { getDatabase, createProxyQueries } = require('../db');
const { parseProxy, parseProxyList, checkProxy, rotateProxy } = require('../proxy');

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
    return res.status(404).json({ error: 'Прокси не найден' });
  }
  
  res.json(proxy);
});

router.post('/', (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  
  const { type, host, port, username, password, proxy_rotation_url } = req.body;
  
  if (!type || !host || !port) {
    return res.status(400).json({ error: 'Обязательные поля: type, host, port' });
  }

  const proxy = queries.create({ type, host, port, username, password, proxy_rotation_url });
  res.status(201).json(proxy);
});

router.post('/import', (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  
  const { text } = req.body;
  
  if (!text) {
    return res.status(400).json({ error: 'Поле text обязательно' });
  }

  try {
    const proxies = parseProxyList(text);
    const created = [];
    
    for (const proxy of proxies) {
      const p = queries.create(proxy);
      created.push(p);
    }

    res.status(201).json({ count: created.length, proxies: created });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);
  
  if (!proxy) {
    return res.status(404).json({ error: 'Прокси не найден' });
  }

  const { type, host, port, username, password, proxy_rotation_url, is_active } = req.body;
  
  db.prepare(`
    UPDATE proxies 
    SET type = COALESCE(?, type),
        host = COALESCE(?, host),
        port = COALESCE(?, port),
        username = COALESCE(?, username),
        password = COALESCE(?, password),
        proxy_rotation_url = COALESCE(?, proxy_rotation_url),
        is_active = COALESCE(?, is_active)
    WHERE id = ?
  `).run(
    type || null,
    host || null,
    port || null,
    username !== undefined ? username : null,
    password !== undefined ? password : null,
    proxy_rotation_url !== undefined ? proxy_rotation_url : null,
    is_active !== undefined ? (is_active ? 1 : 0) : null,
    req.params.id
  );

  const updated = queries.getById(req.params.id);
  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);
  
  if (!proxy) {
    return res.status(404).json({ error: 'Прокси не найден' });
  }

  queries.delete(req.params.id);
  res.status(204).send();
});

router.post('/:id/check', async (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);
  
  if (!proxy) {
    return res.status(404).json({ error: 'Прокси не найден' });
  }

  if (proxy.proxy_rotation_url) {
    try {
      await rotateProxy(proxy.proxy_rotation_url);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      return res.status(502).json({ error: 'Ошибка ротации', details: err.message });
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
  } else {
    queries.updateActive(req.params.id, false);
  }

  res.json(result);
});

module.exports = router;
