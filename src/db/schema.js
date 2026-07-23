const NEW_PROFILE_COLUMNS = [
  'timezone',
  'email',
  'email_password',
  'twitter_username',
  'twitter_password',
  'twitter_auth_token',
  'twitter_email',
  'discord_username',
  'discord_password',
  'discord_token',
  'discord_email',
  'wallet_evm_address',
  'wallet_sol_address',
  'wallet_password',
];

const AUTOMATION_TABLES_SQL = `
    CREATE TABLE IF NOT EXISTS projects (
      name TEXT PRIMARY KEY,
      display_name TEXT NOT NULL DEFAULT '',
      module_path TEXT NOT NULL DEFAULT '',
      class_name TEXT NOT NULL DEFAULT '',
      is_active INTEGER DEFAULT 1,
      default_config TEXT DEFAULT '{}',
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS project_profile_config (
      project_name TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      is_enabled INTEGER DEFAULT 0,
      config_override TEXT DEFAULT '{}',
      PRIMARY KEY (project_name, profile_id),
      FOREIGN KEY (project_name) REFERENCES projects(name) ON DELETE CASCADE,
      FOREIGN KEY (profile_id) REFERENCES profiles(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      name TEXT DEFAULT '',
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','completed','partial','cancelled')),
      parallel_limit INTEGER DEFAULT 2,
      total_tasks INTEGER DEFAULT 0,
      completed_tasks INTEGER DEFAULT 0,
      success_tasks INTEGER DEFAULT 0,
      failed_tasks INTEGER DEFAULT 0,
      started_at DATETIME,
      completed_at DATETIME,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS run_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      project_name TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      status TEXT DEFAULT 'pending' CHECK(status IN ('pending','running','success','failed')),
      exit_code INTEGER,
      log_file_path TEXT,
      attempts INTEGER,
      started_at DATETIME,
      completed_at DATETIME,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
      FOREIGN KEY (project_name) REFERENCES projects(name),
      FOREIGN KEY (profile_id) REFERENCES profiles(id)
    );

    CREATE INDEX IF NOT EXISTS idx_project_profile_config_project ON project_profile_config(project_name);
    CREATE INDEX IF NOT EXISTS idx_project_profile_config_profile ON project_profile_config(profile_id);
    CREATE INDEX IF NOT EXISTS idx_runs_status ON runs(status);
    CREATE INDEX IF NOT EXISTS idx_runs_created_at ON runs(created_at);
    CREATE INDEX IF NOT EXISTS idx_run_tasks_run_id ON run_tasks(run_id);
    CREATE INDEX IF NOT EXISTS idx_run_tasks_profile_id ON run_tasks(profile_id);

    CREATE TRIGGER IF NOT EXISTS update_projects_timestamp
    AFTER UPDATE ON projects
    BEGIN
      UPDATE projects SET updated_at = CURRENT_TIMESTAMP WHERE name = NEW.name;
    END;
`;

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
      timezone TEXT,
      email TEXT,
      email_password TEXT,
      twitter_username TEXT,
      twitter_password TEXT,
      twitter_auth_token TEXT,
      twitter_email TEXT,
      discord_username TEXT,
      discord_password TEXT,
      discord_token TEXT,
      discord_email TEXT,
      wallet_evm_address TEXT,
      wallet_sol_address TEXT,
      wallet_password TEXT,
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
      location TEXT,
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

    ${AUTOMATION_TABLES_SQL}
  `);
}

function migrateTables(db) {
  const existing = db.pragma('table_info(profiles)').map(r => r.name);
  const missing = NEW_PROFILE_COLUMNS.filter(c => !existing.includes(c));

  if (missing.length > 0) {
    const mig = db.transaction(() => {
      for (const col of missing) {
        let sql;
        if (col === 'timezone') {
          sql = `ALTER TABLE profiles ADD COLUMN timezone TEXT`;
        } else if (col === 'wallet_password') {
          sql = `ALTER TABLE profiles ADD COLUMN wallet_password TEXT`;
        } else {
          sql = `ALTER TABLE profiles ADD COLUMN ${col} TEXT`;
        }
        db.exec(sql);
      }
    });

    mig();
  }

  // Создаём automation-таблицы если их нет (используем тот же SQL что и createTables)
  if (db.pragma('table_info(projects)').length === 0) {
    db.exec(AUTOMATION_TABLES_SQL);
  }

  // Миграция proxies: добавляем колонку location если её нет
  const proxyTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='proxies'").all();
  if (proxyTableExists.length > 0) {
    const proxyColumns = db.pragma('table_info(proxies)').map(r => r.name);
    if (!proxyColumns.includes('location')) {
      db.exec('ALTER TABLE proxies ADD COLUMN location TEXT');
    }
  }
}

module.exports = { createTables, migrateTables };
