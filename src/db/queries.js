const { v4: uuidv4 } = require('uuid');

function createProfileQueries(db) {
  const insert = db.prepare(`
    INSERT INTO profiles (id, number, name, proxy_id, fingerprint_seed, platform, user_agent, screen_resolution, hardware_cores, hardware_memory, extensions, tags, notes, timezone, email, email_password, twitter_username, twitter_password, twitter_auth_token, twitter_email, discord_username, discord_password, discord_token, discord_email, wallet_evm_address, wallet_sol_address, wallet_password)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getById = db.prepare('SELECT * FROM profiles WHERE id = ?');
  const getAll = db.prepare('SELECT * FROM profiles ORDER BY number');
  const getByStatus = db.prepare('SELECT * FROM profiles WHERE status = ?');
  const updateStatus = db.prepare('UPDATE profiles SET status = ? WHERE id = ?');
  const updatePid = db.prepare('UPDATE profiles SET pid = ? WHERE id = ?');
  const deleteById = db.prepare('DELETE FROM profiles WHERE id = ?');
  const count = db.prepare('SELECT COUNT(*) as count FROM profiles');

  const update = db.prepare(`
    UPDATE profiles SET
      name = COALESCE(?, name),
      proxy_id = ?,
      platform = COALESCE(?, platform),
      user_agent = COALESCE(?, user_agent),
      screen_resolution = COALESCE(?, screen_resolution),
      hardware_cores = COALESCE(?, hardware_cores),
      hardware_memory = COALESCE(?, hardware_memory),
      fingerprint_seed = COALESCE(?, fingerprint_seed),
      extensions = COALESCE(?, extensions),
      tags = COALESCE(?, tags),
      notes = COALESCE(?, notes),
      timezone = COALESCE(?, timezone),
      email = COALESCE(?, email),
      email_password = COALESCE(?, email_password),
      twitter_username = COALESCE(?, twitter_username),
      twitter_password = COALESCE(?, twitter_password),
      twitter_auth_token = COALESCE(?, twitter_auth_token),
      twitter_email = COALESCE(?, twitter_email),
      discord_username = COALESCE(?, discord_username),
      discord_password = COALESCE(?, discord_password),
      discord_token = COALESCE(?, discord_token),
      discord_email = COALESCE(?, discord_email),
      wallet_evm_address = COALESCE(?, wallet_evm_address),
      wallet_sol_address = COALESCE(?, wallet_sol_address),
      wallet_password = COALESCE(?, wallet_password)
    WHERE id = ?
  `);

  return {
    create(data) {
      const id = uuidv4();
      const num = count.get().count + 1;
      insert.run(
        id,
        num,
        data.name,
        data.proxy_id || null,
        data.fingerprint_seed,
        data.platform,
        data.user_agent,
        data.screen_resolution,
        data.hardware_cores,
        data.hardware_memory,
        JSON.stringify(data.extensions || []),
        JSON.stringify(data.tags || []),
        data.notes || '',
        data.timezone || 'Asia/Bishkek',
        data.email || null,
        data.email_password || null,
        data.twitter_username || null,
        data.twitter_password || null,
        data.twitter_auth_token || null,
        data.twitter_email || null,
        data.discord_username || null,
        data.discord_password || null,
        data.discord_token || null,
        data.discord_email || null,
        data.wallet_evm_address || null,
        data.wallet_sol_address || null,
        data.wallet_password || 'asdfj*KK'
      );
      return getById.get(id);
    },

    getById(id) {
      return getById.get(id);
    },

    getAll() {
      return getAll.all();
    },

    getByStatus(status) {
      return getByStatus.all(status);
    },

    updateStatus(id, status) {
      updateStatus.run(status, id);
      return getById.get(id);
    },

    updatePid(id, pid) {
      updatePid.run(pid, id);
      return getById.get(id);
    },

    delete(id) {
      return deleteById.run(id);
    },

    update(id, data) {
      update.run(
        data.name || null,
        data.proxy_id !== undefined ? data.proxy_id : null,
        data.platform || null,
        data.user_agent || null,
        data.screen_resolution || null,
        data.hardware_cores || null,
        data.hardware_memory || null,
        data.fingerprint_seed || null,
        data.extensions ? JSON.stringify(data.extensions) : null,
        data.tags ? JSON.stringify(data.tags) : null,
        data.notes || null,
        data.timezone || null,
        data.email !== undefined ? data.email : null,
        data.email_password !== undefined ? data.email_password : null,
        data.twitter_username !== undefined ? data.twitter_username : null,
        data.twitter_password !== undefined ? data.twitter_password : null,
        data.twitter_auth_token !== undefined ? data.twitter_auth_token : null,
        data.twitter_email !== undefined ? data.twitter_email : null,
        data.discord_username !== undefined ? data.discord_username : null,
        data.discord_password !== undefined ? data.discord_password : null,
        data.discord_token !== undefined ? data.discord_token : null,
        data.discord_email !== undefined ? data.discord_email : null,
        data.wallet_evm_address !== undefined ? data.wallet_evm_address : null,
        data.wallet_sol_address !== undefined ? data.wallet_sol_address : null,
        data.wallet_password !== undefined ? data.wallet_password : null,
        id
      );
      return getById.get(id);
    },
  };
}

function createProxyQueries(db) {
  const insert = db.prepare(`
    INSERT INTO proxies (type, host, port, username, password, proxy_rotation_url)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const getById = db.prepare('SELECT * FROM proxies WHERE id = ?');
  const getAll = db.prepare('SELECT * FROM proxies ORDER BY created_at');
  const updateLastIp = db.prepare('UPDATE proxies SET last_ip = ?, last_checked_at = CURRENT_TIMESTAMP WHERE id = ?');
  const updateActive = db.prepare('UPDATE proxies SET is_active = ? WHERE id = ?');
  const deleteById = db.prepare('DELETE FROM proxies WHERE id = ?');

  return {
    create(data) {
      const result = insert.run(
        data.type,
        data.host,
        data.port,
        data.username || null,
        data.password || null,
        data.proxy_rotation_url || null
      );
      return getById.get(result.lastInsertRowid);
    },

    getById(id) {
      return getById.get(id);
    },

    getAll() {
      return getAll.all();
    },

    updateLastIp(id, ip) {
      updateLastIp.run(ip, id);
      return getById.get(id);
    },

    updateActive(id, isActive) {
      updateActive.run(isActive ? 1 : 0, id);
      return getById.get(id);
    },

    delete(id) {
      return deleteById.run(id);
    },
  };
}

function createCookieQueries(db) {
  const insert = db.prepare(`
    INSERT INTO cookies (profile_id, name, value, domain, path, expires, http_only, secure, same_site)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const getByProfileId = db.prepare('SELECT * FROM cookies WHERE profile_id = ?');
  const deleteByProfileId = db.prepare('DELETE FROM cookies WHERE profile_id = ?');

  return {
    import(profileId, cookies) {
      const insertMany = db.transaction((items) => {
        for (const cookie of items) {
          insert.run(
            profileId,
            cookie.name,
            cookie.value,
            cookie.domain,
            cookie.path || '/',
            cookie.expires || -1,
            cookie.httpOnly ? 1 : 0,
            cookie.secure ? 1 : 0,
            cookie.sameSite || 'Lax'
          );
        }
      });
      insertMany(cookies);
    },

    getByProfileId(profileId) {
      return getByProfileId.all(profileId);
    },

    deleteByProfileId(profileId) {
      return deleteByProfileId.run(profileId);
    },
  };
}

function createLogQueries(db) {
  const insert = db.prepare(`
    INSERT INTO profile_logs (profile_id, level, message, metadata)
    VALUES (?, ?, ?, ?)
  `);

  const getByProfileId = db.prepare(
    'SELECT * FROM profile_logs WHERE profile_id = ? ORDER BY created_at DESC LIMIT ?'
  );

  return {
    add(profileId, level, message, metadata = {}) {
      return insert.run(profileId, level, message, JSON.stringify(metadata));
    },

    getByProfileId(profileId, limit = 100) {
      return getByProfileId.all(profileId, limit);
    },
  };
}

module.exports = { createProfileQueries, createProxyQueries, createCookieQueries, createLogQueries };
