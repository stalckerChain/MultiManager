const { v4: uuidv4 } = require('uuid');
const { encrypt, decrypt, decryptRow, decryptRows, SECRET_FIELDS, hasMasterKey, getMasterKey } = require('../crypto');

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

  const mk = () => hasMasterKey() ? getMasterKey() : null;

  function encryptFields(data) {
    const key = mk();
    if (!key) return data;
    const out = { ...data };
    for (const field of SECRET_FIELDS) {
      if (out[field] !== undefined && out[field] !== null) {
        out[field] = encrypt(String(out[field]), key);
      }
    }
    return out;
  }

  function decryptRowSafe(row) {
    if (!hasMasterKey() || !row) return row;
    return decryptRow(row);
  }

  function decryptRowsSafe(rows) {
    if (!hasMasterKey() || !rows) return rows;
    return rows.map(r => decryptRow(r));
  }

  return {
    create(data) {
      const id = uuidv4();
      const num = count.get().count + 1;
      const enc = encryptFields(data);
      insert.run(
        id,
        num,
        enc.name,
        enc.proxy_id || null,
        enc.fingerprint_seed,
        enc.platform,
        enc.user_agent,
        enc.screen_resolution,
        enc.hardware_cores,
        enc.hardware_memory,
        JSON.stringify(enc.extensions || []),
        JSON.stringify(enc.tags || []),
        enc.notes || '',
        enc.timezone || 'Asia/Bishkek',
        enc.email || null,
        enc.email_password || null,
        enc.twitter_username || null,
        enc.twitter_password || null,
        enc.twitter_auth_token || null,
        enc.twitter_email || null,
        enc.discord_username || null,
        enc.discord_password || null,
        enc.discord_token || null,
        enc.discord_email || null,
        enc.wallet_evm_address || null,
        enc.wallet_sol_address || null,
        enc.wallet_password || 'asdfj*KK'
      );
      return decryptRowSafe(getById.get(id));
    },

    getById(id) {
      return decryptRowSafe(getById.get(id));
    },

    getAll() {
      return decryptRowsSafe(getAll.all());
    },

    getByStatus(status) {
      return decryptRowsSafe(getByStatus.all(status));
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
      const enc = encryptFields(data);
      update.run(
        enc.name || null,
        enc.proxy_id !== undefined ? enc.proxy_id : null,
        enc.platform || null,
        enc.user_agent || null,
        enc.screen_resolution || null,
        enc.hardware_cores || null,
        enc.hardware_memory || null,
        enc.fingerprint_seed || null,
        enc.extensions ? JSON.stringify(enc.extensions) : null,
        enc.tags ? JSON.stringify(enc.tags) : null,
        enc.notes || null,
        enc.timezone || null,
        enc.email !== undefined ? enc.email : null,
        enc.email_password !== undefined ? enc.email_password : null,
        enc.twitter_username !== undefined ? enc.twitter_username : null,
        enc.twitter_password !== undefined ? enc.twitter_password : null,
        enc.twitter_auth_token !== undefined ? enc.twitter_auth_token : null,
        enc.twitter_email !== undefined ? enc.twitter_email : null,
        enc.discord_username !== undefined ? enc.discord_username : null,
        enc.discord_password !== undefined ? enc.discord_password : null,
        enc.discord_token !== undefined ? enc.discord_token : null,
        enc.discord_email !== undefined ? enc.discord_email : null,
        enc.wallet_evm_address !== undefined ? enc.wallet_evm_address : null,
        enc.wallet_sol_address !== undefined ? enc.wallet_sol_address : null,
        enc.wallet_password !== undefined ? enc.wallet_password : null,
        id
      );
      return decryptRowSafe(getById.get(id));
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
  const findByHostPort = db.prepare('SELECT * FROM proxies WHERE host = ? AND port = ?');

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

    findByHostPort(host, port) {
      return findByHostPort.get(host, port);
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

function createTaskQueries(db) {
  const insert = db.prepare(`
    INSERT INTO tasks (id, name, script_name, schedule_type, cron_expression, params, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const getById = db.prepare('SELECT * FROM tasks WHERE id = ?');
  const getAll = db.prepare('SELECT * FROM tasks ORDER BY created_at DESC');
  const getActive = db.prepare('SELECT * FROM tasks WHERE is_active = 1 ORDER BY created_at DESC');

  const update = db.prepare(`
    UPDATE tasks SET
      name = COALESCE(?, name),
      script_name = COALESCE(?, script_name),
      schedule_type = COALESCE(?, schedule_type),
      cron_expression = ?,
      params = COALESCE(?, params),
      is_active = COALESCE(?, is_active),
      updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `);

  const deleteById = db.prepare('DELETE FROM tasks WHERE id = ?');

  const insertExecution = db.prepare(`
    INSERT INTO task_executions (task_id, profile_id, status, exit_code, last_run_at, log_file_path)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `);

  const getExecutionsByTaskId = db.prepare(
    'SELECT * FROM task_executions WHERE task_id = ? ORDER BY last_run_at DESC'
  );

  const updateExecutionStatus = db.prepare(`
    UPDATE task_executions SET status = ?, exit_code = ? WHERE id = ?
  `);

  return {
    create(data) {
      if (!data.name || !data.script_name || !data.schedule_type) {
        throw new Error('name, script_name и schedule_type обязательны');
      }
      const id = uuidv4();
      insert.run(
        id, data.name, data.script_name, data.schedule_type,
        data.cron_expression || null,
        JSON.stringify(data.params || {}),
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : 1
      );
      return getById.get(id);
    },

    getById(id) {
      return getById.get(id);
    },

    getAll() {
      return getAll.all();
    },

    getActive() {
      return getActive.all();
    },

    update(id, data) {
      update.run(
        data.name || null,
        data.script_name || null,
        data.schedule_type || null,
        data.cron_expression !== undefined ? data.cron_expression : null,
        data.params ? JSON.stringify(data.params) : null,
        data.is_active !== undefined ? (data.is_active ? 1 : 0) : null,
        id
      );
      return getById.get(id);
    },

    delete(id) {
      return deleteById.run(id);
    },

    createExecution(taskId, profileId, status = 'running', logFilePath = null) {
      const result = insertExecution.run(taskId, profileId, status, null, logFilePath);
      return result.lastInsertRowid;
    },

    getExecutions(taskId) {
      return getExecutionsByTaskId.all(taskId);
    },

    updateExecutionStatus(id, status, exitCode = null) {
      updateExecutionStatus.run(status, exitCode, id);
    },
  };
}

function createSystemConfigQueries(db) {
  const get = db.prepare('SELECT value FROM system_config WHERE key = ?');
  const set = db.prepare('INSERT OR REPLACE INTO system_config (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)');
  const del = db.prepare('DELETE FROM system_config WHERE key = ?');

  return {
    get(key) {
      const row = get.get(key);
      return row ? row.value : null;
    },

    set(key, value) {
      set.run(key, String(value));
    },

    delete(key) {
      del.run(key);
    },
  };
}

module.exports = {
  createProfileQueries,
  createProxyQueries,
  createCookieQueries,
  createLogQueries,
  createTaskQueries,
  createSystemConfigQueries,
};
