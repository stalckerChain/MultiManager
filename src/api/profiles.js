const express = require('express');
const { getDatabase, createProfileQueries, createSystemConfigQueries } = require('../db');
const { generateFingerprint } = require('../fingerprint');
const { getCloakBrowserVersion } = require('../core/cloakbrowser-version');
const { validate, profileCreateSchema, profileUpdateSchema, profileBatchSchema } = require('./validate');
const { notFound, conflict, serverError, badRequest } = require('./errors');
const { logger } = require('../logger');

function getChromeVersion(db) {
  const configQueries = createSystemConfigQueries(db);
  return getCloakBrowserVersion((key) => configQueries.get(key));
}

const router = express.Router();

router.get('/', (req, res) => {
  const db = getDatabase();
  const profiles = createProfileQueries(db).getAll();
  res.json(profiles);
});

router.get('/:id', (req, res) => {
  const db = getDatabase();
  const profile = createProfileQueries(db).getById(req.params.id);

  if (!profile) {
    throw notFound('Профиль');
  }

  res.json(profile);
});

router.post('/batch', validate(profileBatchSchema), (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const chromeVersion = getChromeVersion(db);

  const { accounts } = req.body;

  const insertBatch = db.transaction((items) => {
    return items.map((acct) => {
      const fingerprint = generateFingerprint(acct.platform, chromeVersion);
      return queries.create({
        name: acct.name,
        platform: acct.platform,
        proxy_id: acct.proxy_id,
        extensions: acct.extensions,
        tags: acct.tags,
        notes: acct.notes,
        timezone: acct.timezone,
        email: acct.email,
        email_password: acct.email_password,
        twitter_username: acct.twitter_username,
        twitter_password: acct.twitter_password,
        twitter_auth_token: acct.twitter_auth_token,
        twitter_email: acct.twitter_email,
        discord_username: acct.discord_username,
        discord_password: acct.discord_password,
        discord_token: acct.discord_token,
        discord_email: acct.discord_email,
        wallet_evm_address: acct.wallet_evm_address,
        wallet_sol_address: acct.wallet_sol_address,
        wallet_password: acct.wallet_password,
        profile_path: acct.profile_path,
        fingerprint_seed: fingerprint.fingerprint_seed,
        user_agent: fingerprint.user_agent,
        screen_resolution: fingerprint.screen_resolution,
        hardware_cores: fingerprint.hardware_cores,
        hardware_memory: fingerprint.hardware_memory,
      });
    });
  });

  try {
    const created = insertBatch(accounts);
    res.status(201).json(created);
  } catch (err) {
    const { serverError } = require('./errors');
    throw serverError('Ошибка массового импорта', err.message);
  }
});

router.post('/', validate(profileCreateSchema), (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const chromeVersion = getChromeVersion(db);

  const { name, proxy_id, platform, extensions, tags, notes, timezone, email, email_password, twitter_username, twitter_password, twitter_auth_token, twitter_email, discord_username, discord_password, discord_token, discord_email, wallet_evm_address, wallet_sol_address, wallet_password, profile_path } = req.body;

  const fingerprint = generateFingerprint(platform, chromeVersion);
  
  const profile = queries.create({
    name,
    proxy_id,
    fingerprint_seed: fingerprint.fingerprint_seed,
    platform: fingerprint.platform,
    user_agent: fingerprint.user_agent,
    screen_resolution: fingerprint.screen_resolution,
    hardware_cores: fingerprint.hardware_cores,
    hardware_memory: fingerprint.hardware_memory,
    extensions,
    tags,
    notes,
    timezone,
    email,
    email_password,
    twitter_username,
    twitter_password,
    twitter_auth_token,
    twitter_email,
    discord_username,
    discord_password,
    discord_token,
    discord_email,
    wallet_evm_address,
    wallet_sol_address,
    wallet_password,
    profile_path,
  });

  res.status(201).json(profile);
});

router.put('/:id', validate(profileUpdateSchema), (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const profile = queries.getById(req.params.id);

  if (!profile) {
    throw notFound('Профиль');
  }

  const body = req.body;
  const toNull = (v) => (v === '' || v === undefined) ? null : v;

  const { name, proxy_id, platform, extensions, tags, notes, timezone, email, email_password, twitter_username, twitter_password, twitter_auth_token, twitter_email, discord_username, discord_password, discord_token, discord_email, wallet_evm_address, wallet_sol_address, wallet_password, profile_path, fingerprint_seed, user_agent, screen_resolution, hardware_cores, hardware_memory, fingerprint_platform } = body;

  const chromeVersion = getChromeVersion(db);

  let fingerprint = null;

  if (fingerprint_seed !== undefined) {
    const effectivePlatform = platform !== undefined ? platform : profile.platform;
    if (fingerprint_platform !== effectivePlatform) {
      throw badRequest('fingerprint_platform не совпадает с выбранной платформой');
    }
    fingerprint = {
      fingerprint_seed,
      user_agent,
      screen_resolution,
      hardware_cores,
      hardware_memory,
    };
  } else if (platform && platform !== profile.platform) {
    fingerprint = generateFingerprint(platform, chromeVersion);
  }

  const updated = queries.update(req.params.id, {
    name: toNull(name),
    proxy_id: proxy_id !== undefined ? proxy_id : profile.proxy_id,
    platform: toNull(platform),
    user_agent: fingerprint ? fingerprint.user_agent : null,
    screen_resolution: fingerprint ? fingerprint.screen_resolution : null,
    hardware_cores: fingerprint ? fingerprint.hardware_cores : null,
    hardware_memory: fingerprint ? fingerprint.hardware_memory : null,
    fingerprint_seed: fingerprint ? fingerprint.fingerprint_seed : null,
    extensions: toNull(extensions),
    tags: toNull(tags),
    notes: toNull(notes),
    timezone: toNull(timezone),
    email: toNull(email),
    email_password: toNull(email_password),
    twitter_username: toNull(twitter_username),
    twitter_password: toNull(twitter_password),
    twitter_auth_token: toNull(twitter_auth_token),
    twitter_email: toNull(twitter_email),
    discord_username: toNull(discord_username),
    discord_password: toNull(discord_password),
    discord_token: toNull(discord_token),
    discord_email: toNull(discord_email),
    wallet_evm_address: toNull(wallet_evm_address),
    wallet_sol_address: toNull(wallet_sol_address),
    wallet_password: toNull(wallet_password),
    profile_path: profile_path !== undefined ? toNull(profile_path) : profile.profile_path,
  });

  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const profile = queries.getById(req.params.id);

  if (!profile) {
    throw notFound('Профиль');
  }

  if (profile.status !== 'stopped') {
    throw conflict('Невозможно удалить запущенный профиль');
  }

  try {
    queries.delete(req.params.id);
  } catch (err) {
    logger.error({ profileId: req.params.id, err: err.message }, 'Ошибка удаления профиля');
    throw conflict('Не удалось удалить профиль. Убедитесь, что он не используется в задачах');
  }

  res.status(204).send();
});

router.post('/:id/regenerate', (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const profile = queries.getById(req.params.id);

  if (!profile) {
    throw notFound('Профиль');
  }

  const chromeVersion = getChromeVersion(db);
  const fingerprint = generateFingerprint(profile.platform, chromeVersion);
  
  db.prepare(`
    UPDATE profiles 
    SET fingerprint_seed = ?,
        user_agent = ?,
        screen_resolution = ?,
        hardware_cores = ?,
        hardware_memory = ?
    WHERE id = ?
  `).run(
    fingerprint.fingerprint_seed,
    fingerprint.user_agent,
    fingerprint.screen_resolution,
    fingerprint.hardware_cores,
    fingerprint.hardware_memory,
    req.params.id
  );

  const updated = queries.getById(req.params.id);
  res.json(updated);
});

module.exports = router;
