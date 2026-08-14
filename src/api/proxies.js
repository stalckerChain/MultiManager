const express = require('express');
const { getDatabase, createProxyQueries, createProfileQueries } = require('../db');
const { parseProxy, parseProxyList, checkProxy, rotateProxy, getTimezoneByIp } = require('../proxy');
const { validate, proxyCreateSchema, proxyUpdateSchema, proxyImportSchema, distributePreviewSchema, distributeSchema } = require('./validate');
const { notFound, conflict, badRequest, badGateway, serverError } = require('./errors');
const { asyncHandler } = require('./errors');

async function performProxyCheck(proxy) {
  if (proxy.proxy_rotation_url) {
    try {
      await rotateProxy(proxy.proxy_rotation_url);
      await new Promise(resolve => setTimeout(resolve, 3000));
    } catch (err) {
      err.isRotationError = true;
      throw err;
    }
  }

  return checkProxy({
    type: proxy.type,
    host: proxy.host,
    port: proxy.port,
    username: proxy.username,
    password: proxy.password,
  });
}

async function persistProxyCheckResult(proxy, result, queries, db) {
  if (result.ok) {
    queries.updateLastIp(proxy.id, result.ip);
    queries.updateActive(proxy.id, true);
    if (result.detectedType && result.detectedType !== proxy.type) {
      db.prepare('UPDATE proxies SET type = ? WHERE id = ?').run(result.detectedType, proxy.id);
    }
    const tzResult = await getTimezoneByIp(result.ip);
    if (tzResult.ok) {
      queries.updateLocation(proxy.id, tzResult.location || null);
    }
  } else {
    queries.updateActive(proxy.id, false);
  }
}

function getSourceProxyIds(mode, proxyQueries) {
  if (mode === 'used') {
    return proxyQueries.getUsedIds();
  }
  return proxyQueries.getAll().map(p => p.id);
}

function getSourceProxyRows(ids, proxyQueries) {
  return ids.map(id => proxyQueries.getById(id)).filter(Boolean);
}

const router = express.Router();

router.post('/distribute/preview', validate(distributePreviewSchema), asyncHandler(async (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const { mode } = req.body;

  const sourceRows = getSourceProxyRows(getSourceProxyIds(mode, queries), queries);

  const workingProxyIds = [];
  let checkedCount = 0;
  let failedCount = 0;

  for (const proxy of sourceRows) {
    checkedCount++;
    try {
      const result = await performProxyCheck(proxy);
      await persistProxyCheckResult(proxy, result, queries, db);
      if (result.ok) {
        workingProxyIds.push(proxy.id);
      } else {
        failedCount++;
      }
    } catch (err) {
      failedCount++;
    }
  }

  const profiles = createProfileQueries(db).getAll();

  res.json({
    mode,
    profiles_count: profiles.length,
    checked_count: checkedCount,
    working_count: workingProxyIds.length,
    failed_count: failedCount,
    working_proxy_ids: workingProxyIds,
  });
}));

router.post('/distribute', validate(distributeSchema), asyncHandler(async (req, res) => {
  const db = getDatabase();
  const proxyQueries = createProxyQueries(db);
  const profileQueries = createProfileQueries(db);
  const { mode, working_proxy_ids } = req.body;

  const sourceIds = getSourceProxyIds(mode, proxyQueries);
  const sourceSet = new Set(sourceIds);

  for (const id of working_proxy_ids) {
    if (!sourceSet.has(id)) {
      throw badRequest('working_proxy_ids содержит прокси вне допустимого источника для выбранного режима');
    }
  }

  if (working_proxy_ids.length === 0) {
    throw badRequest('Нет рабочих прокси для распределения');
  }

  const profiles = profileQueries.getAll();
  const assignments = [];
  let cycle = [];

  for (const profile of profiles) {
    if (cycle.length === 0) {
      cycle = [...working_proxy_ids];
    }
    const idx = Math.floor(Math.random() * cycle.length);
    const proxyId = cycle.splice(idx, 1)[0];
    assignments.push({ id: profile.id, proxy_id: proxyId });
  }

  if (assignments.length > 0) {
    profileQueries.updateProxyAssignments(assignments);
  }

  res.json({
    assigned_profiles: assignments.length,
    used_proxies: working_proxy_ids.length,
  });
}));

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

router.post('/:id/check', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const queries = createProxyQueries(db);
  const proxy = queries.getById(req.params.id);

  if (!proxy) {
    throw notFound('Прокси');
  }

  let result;
  try {
    result = await performProxyCheck(proxy);
  } catch (err) {
    if (err.isRotationError) {
      throw badGateway('Ошибка ротации', err.message);
    }
    throw badGateway('Ошибка проверки прокси', err.message);
  }

  await persistProxyCheckResult(proxy, result, queries, db);

  res.json(result);
}));

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
