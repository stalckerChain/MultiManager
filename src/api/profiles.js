const express = require('express');
const { getDatabase, createProfileQueries } = require('../db');
const { generateFingerprint } = require('../fingerprint');

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
    return res.status(404).json({ error: 'Профиль не найден' });
  }
  
  res.json(profile);
});

router.post('/', (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  
  const { name, proxy_id, platform, extensions, tags, notes, timezone, email, email_password, twitter_username, twitter_password, twitter_auth_token, twitter_email, discord_username, discord_password, discord_token, discord_email, wallet_evm_address, wallet_sol_address, wallet_password } = req.body;
  
  if (!name || !platform) {
    return res.status(400).json({ error: 'Обязательные поля: name, platform' });
  }

  const fingerprint = generateFingerprint(platform);
  
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
  });

  res.status(201).json(profile);
});

router.put('/:id', (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const profile = queries.getById(req.params.id);
  
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const { name, proxy_id, platform, extensions, tags, notes, timezone, email, email_password, twitter_username, twitter_password, twitter_auth_token, twitter_email, discord_username, discord_password, discord_token, discord_email, wallet_evm_address, wallet_sol_address, wallet_password } = req.body;
  
  const fingerprint = platform && platform !== profile.platform
    ? generateFingerprint(platform)
    : null;

  const updated = queries.update(req.params.id, {
    name,
    proxy_id: proxy_id !== undefined ? proxy_id : profile.proxy_id,
    platform,
    user_agent: fingerprint ? fingerprint.user_agent : null,
    screen_resolution: fingerprint ? fingerprint.screen_resolution : null,
    hardware_cores: fingerprint ? fingerprint.hardware_cores : null,
    hardware_memory: fingerprint ? fingerprint.hardware_memory : null,
    fingerprint_seed: fingerprint ? fingerprint.fingerprint_seed : null,
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
  });

  res.json(updated);
});

router.delete('/:id', (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const profile = queries.getById(req.params.id);
  
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  if (profile.status !== 'stopped') {
    return res.status(409).json({ error: 'Невозможно удалить запущенный профиль' });
  }

  queries.delete(req.params.id);
  res.status(204).send();
});

router.post('/:id/regenerate', (req, res) => {
  const db = getDatabase();
  const queries = createProfileQueries(db);
  const profile = queries.getById(req.params.id);
  
  if (!profile) {
    return res.status(404).json({ error: 'Профиль не найден' });
  }

  const fingerprint = generateFingerprint(profile.platform);
  
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
