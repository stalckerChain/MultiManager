const express = require('express');
const { getDatabase } = require('../db');
const { createProfileQueries, createProxyQueries } = require('../db/queries');
const { logger } = require('../logger');
const path = require('path');
const { getExtensionsDir, resolveRuntimeId } = require('./extensions');
const { getBrowserDataDir } = require('../core/profile-path');
const { asyncHandler, notFound, badRequest, serverError, ApiError } = require('./errors');
const { getDataDir } = require('../core/data-dir');

const router = express.Router();

function parseRange(rangeStr) {
  if (!rangeStr || typeof rangeStr !== 'string') return null;
  const parts = rangeStr.split('-');
  if (parts.length !== 2) return null;
  const start = parseInt(parts[0], 10);
  const end = parseInt(parts[1], 10);
  if (isNaN(start) || isNaN(end) || start > end) return null;
  const names = [];
  for (let i = start; i <= end; i++) {
    names.push(`auto_${String(i).padStart(3, '0')}`);
  }
  return names;
}

router.get('/profiles', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const proxyQueries = createProxyQueries(db);

  const rangeNames = req.query.range ? parseRange(req.query.range) : null;
  if (req.query.range && !rangeNames) {
    return res.status(400).json({ error: 'Invalid range format. Use e.g. 001-010' });
  }

  let profiles;
  if (rangeNames) {
    profiles = profileQueries.getAll().filter(p => rangeNames.includes(p.name));
  } else {
    profiles = profileQueries.getAll();
  }

  const proxyCache = new Map();

  const result = profiles.map(profile => {
    let proxy = null;
    if (profile.proxy_id) {
      if (!proxyCache.has(profile.proxy_id)) {
        proxyCache.set(profile.proxy_id, proxyQueries.getById(profile.proxy_id));
      }
      const p = proxyCache.get(profile.proxy_id);
      if (p) {
        proxy = {
          type: p.type,
          host: p.host,
          port: p.port,
          has_auth: !!(p.username && p.password),
        };
      }
    }

    return {
      id: profile.id,
      number: profile.number,
      name: profile.name,
      email: profile.email,
      twitter_username: profile.twitter_username,
      twitter_email: profile.twitter_email,
      discord_username: profile.discord_username,
      discord_email: profile.discord_email,
      wallet_evm_address: profile.wallet_evm_address,
      wallet_sol_address: profile.wallet_sol_address,
      proxy,
    };
  });

  logger.info({ count: result.length, range: req.query.range }, '[INTERNAL] /api/internal/profiles');
  res.json(result);
});

router.get('/profiles/:id/zerion-extension', asyncHandler(async (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);

  const profile = profileQueries.getById(req.params.id);
  if (!profile) {
    throw notFound('Профиль');
  }

  let extIds;
  try {
    extIds = JSON.parse(profile.extensions || '[]');
  } catch {
    throw badRequest('Невалидный список расширений в профиле');
  }

  if (!Array.isArray(extIds) || extIds.length === 0 || typeof extIds[0] !== 'string' || !extIds[0]) {
    throw badRequest('Не найдено расширение Zerion в профиле');
  }

  const extPath = path.join(getExtensionsDir(), extIds[0]);

  let runtimeId;
  try {
    const profileDir = getBrowserDataDir(profile);
    runtimeId = await resolveRuntimeId(extPath, profileDir);
  } catch (err) {
    if (err instanceof ApiError) throw err;
    logger.error({ err: err.message, profileId: req.params.id }, 'Failed to resolve Zerion extension ID');
    throw serverError('Не удалось определить runtime ID расширения Zerion');
  }

  if (!runtimeId) {
    throw badRequest('Не удалось определить runtime ID расширения Zerion');
  }

  if (!/^[a-z]{32}$/.test(runtimeId)) {
    throw badRequest('Runtime ID расширения Zerion имеет неверный формат');
  }

  logger.info({ profileId: req.params.id }, '[INTERNAL] /api/internal/profiles/:id/zerion-extension resolved');
  return res.json({ id: runtimeId });
}));

router.get('/profile-storage', (req, res) => {
  const profilesDir = path.join(getDataDir(), 'profiles');
  logger.info({ profiles_dir: profilesDir }, '[INTERNAL] /api/internal/profile-storage');
  res.json({ profiles_dir: profilesDir });
});

module.exports = { router, parseRange };
