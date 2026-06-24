function createTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS profiles (
      id TEXT PRIMARY KEY,
      number INTEGER NOT NULL,
      name TEXT NOT NULL,
      proxy_id INTEGER,
      fingerprint_seed TEXT NOT NULL,
      platform TEXT NOT NULL CHECK(platform IN ('windows', 'macos', 'linux')),
      user_agent TEXT NOT NULL,
      screen_resolution TEXT NOT NULL,
      hardware_cores INTEGER NOT NULL,
      hardware_memory INTEGER NOT NULL,
      extensions TEXT DEFAULT '[]',
      tags TEXT DEFAULT '[]',
      notes TEXT DEFAULT '',
      status TEXT DEFAULT 'stopped' CHECK(status IN ('stopped', 'starting', 'running')),
      pid INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (proxy_id) REFERENCES proxies(id) ON DELETE SET NULL
    );

    CREATE TABLE IF NOT EXISTS proxies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      type TEXT NOT NULL CHECK(type IN ('http', 'https', 'socks5')),
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      username TEXT,
      password TEXT,
      proxy_rotation_url TEXT,
      last_ip TEXT,
      last_checked_at DATETIME,
      is_active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS cookies (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      name TEXT NOT NULL,
      value TEXT NOT NULL,
      domain TEXT NOT NULL,
      path TEXT DEFAULT '/',
      expires INTEGER DEFAULT -1,
      http_only INTEGER DEFAULT 0,
      secure INTEGER DEFAULT 0,
      same_site TEXT DEFAULT 'Lax',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS profile_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      profile_id TEXT NOT NULL,
      level TEXT NOT NULL CHECK(level IN ('info', 'warn', 'error', 'debug')),
      message TEXT NOT NULL,
      metadata TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS system_config (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE INDEX IF NOT EXISTS idx_profiles_status ON profiles(status);
    CREATE INDEX IF NOT EXISTS idx_profiles_proxy_id ON profiles(proxy_id);
    CREATE INDEX IF NOT EXISTS idx_proxies_host_port ON proxies(host, port);
    CREATE INDEX IF NOT EXISTS idx_cookies_profile_id ON cookies(profile_id);
    CREATE INDEX IF NOT EXISTS idx_profile_logs_profile_id ON profile_logs(profile_id);
    CREATE INDEX IF NOT EXISTS idx_profile_logs_created_at ON profile_logs(created_at);

    CREATE TRIGGER IF NOT EXISTS update_profiles_timestamp
    AFTER UPDATE ON profiles
    BEGIN
      UPDATE profiles SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_proxies_timestamp
    AFTER UPDATE ON proxies
    BEGIN
      UPDATE proxies SET updated_at = CURRENT_TIMESTAMP WHERE id = NEW.id;
    END;

    CREATE TRIGGER IF NOT EXISTS update_system_config_timestamp
    AFTER UPDATE ON system_config
    BEGIN
      UPDATE system_config SET updated_at = CURRENT_TIMESTAMP WHERE key = NEW.key;
    END;
  `);
}

module.exports = { createTables };
