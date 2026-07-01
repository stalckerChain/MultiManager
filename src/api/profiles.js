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
  
  const { name, proxy_id, platform, extensions, tags, notes } = req.body;
  
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

  const { name, proxy_id, platform, extensions, tags, notes } = req.body;
  
  const fingerprint = platform && platform !== profile.platform
    ? generateFingerprint(platform)
    : null;

  db.prepare(`
    UPDATE profiles 
    SET name = COALESCE(?, name),
        proxy_id = ?,
        platform = COALESCE(?, platform),
        user_agent = COALESCE(?, user_agent),
        screen_resolution = COALESCE(?, screen_resolution),
        hardware_cores = COALESCE(?, hardware_cores),
        hardware_memory = COALESCE(?, hardware_memory),
        fingerprint_seed = COALESCE(?, fingerprint_seed),
        extensions = COALESCE(?, extensions),
        tags = COALESCE(?, tags),
        notes = COALESCE(?, notes)
    WHERE id = ?
  `).run(
    name || null,
    proxy_id !== undefined ? proxy_id : profile.proxy_id,
    platform || null,
    fingerprint ? fingerprint.user_agent : null,
    fingerprint ? fingerprint.screen_resolution : null,
    fingerprint ? fingerprint.hardware_cores : null,
    fingerprint ? fingerprint.hardware_memory : null,
    fingerprint ? fingerprint.fingerprint_seed : null,
    extensions ? JSON.stringify(extensions) : null,
    tags ? JSON.stringify(tags) : null,
    notes || null,
    req.params.id
  );

  const updated = queries.getById(req.params.id);
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
