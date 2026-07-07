const express = require('express');
const { getDatabase } = require('../db');
const { createProfileQueries, createProxyQueries } = require('../db/queries');
const { logger } = require('../logger');

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

function buildProxyString(proxy) {
  if (!proxy) return null;
  const auth = proxy.username && proxy.password
    ? `${proxy.username}:${proxy.password}@`
    : '';
  return `${proxy.type}://${auth}${proxy.host}:${proxy.port}`;
}

router.get('/profiles', (req, res) => {
  const db = getDatabase();
  const profileQueries = createProfileQueries(db);
  const proxyQueries = createProxyQueries(db);

  const rangeNames = parseRange(req.query.range);

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
          username: p.username,
          password: p.password,
          connection_string: buildProxyString(p),
        };
      }
    }

    return {
      id: profile.id,
      number: profile.number,
      name: profile.name,
      email: profile.email,
      email_password: profile.email_password,
      twitter_username: profile.twitter_username,
      twitter_password: profile.twitter_password,
      twitter_auth_token: profile.twitter_auth_token,
      twitter_email: profile.twitter_email,
      discord_username: profile.discord_username,
      discord_password: profile.discord_password,
      discord_token: profile.discord_token,
      discord_email: profile.discord_email,
      wallet_evm_address: profile.wallet_evm_address,
      wallet_sol_address: profile.wallet_sol_address,
      wallet_password: profile.wallet_password,
      proxy,
    };
  });

  logger.info({ count: result.length, range: req.query.range }, '[INTERNAL] /api/internal/profiles');
  res.json(result);
});

module.exports = router;
