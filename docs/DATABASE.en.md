# Database Schema

SQLite database with WAL journaling and ACID transactions.

## Tables

### profiles

Stores anti-detect browser profiles.

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT (UUID) | Unique identifier |
| `number` | INTEGER | Sequential number |
| `name` | TEXT | Profile name |
| `proxy_id` | INTEGER | Foreign key to proxies |
| `fingerprint_seed` | TEXT | Fingerprint generation seed |
| `platform` | TEXT | Platform (windows/mac/linux) |
| `user_agent` | TEXT | User-Agent string |
| `screen_resolution` | TEXT | Screen resolution |
| `hardware_cores` | INTEGER | CPU core count |
| `hardware_memory` | INTEGER | RAM (GB) |
| `extensions` | TEXT | JSON array of extension IDs |
| `tags` | TEXT | JSON array of tags |
| `notes` | TEXT | Notes |
| `status` | TEXT | Status (stopped/starting/running) |
| `pid` | INTEGER | Browser process PID |
| `timezone` | TEXT | Timezone (default 'Asia/Bishkek') |
| `email` | TEXT | Email |
| `email_password` | TEXT | Email password |
| `twitter_username` | TEXT | X/Twitter username |
| `twitter_password` | TEXT | X/Twitter password |
| `twitter_auth_token` | TEXT | X/Twitter auth token |
| `twitter_email` | TEXT | X/Twitter email |
| `discord_username` | TEXT | Discord username |
| `discord_password` | TEXT | Discord password |
| `discord_token` | TEXT | Discord token |
| `discord_email` | TEXT | Discord email |
| `wallet_evm_address` | TEXT | EVM wallet address |
| `wallet_sol_address` | TEXT | Solana wallet address |
| `wallet_password` | TEXT | Wallet password (default 'asdfj*KK') |
| `created_at` | DATETIME | Creation date |
| `updated_at` | DATETIME | Update date |

**Indexes:**
- `idx_profiles_status` — Fast search by status
- `idx_profiles_proxy_id` — Search by proxy

**Triggers:**
- `update_profiles_timestamp` — Auto-update `updated_at`

**Migration (v1.0.0 → v1.1.0):**
On DB initialization, `migrateTables()` checks for new columns via `PRAGMA table_info` and adds missing ones via `ALTER TABLE ADD COLUMN`. Migrated columns: `timezone`, `email`, `email_password`, `twitter_username`, `twitter_password`, `twitter_auth_token`, `twitter_email`, `discord_username`, `discord_password`, `discord_token`, `discord_email`, `wallet_evm_address`, `wallet_sol_address`, `wallet_password`.

**Encryption (v1.2.0):** Fields `email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password` are automatically encrypted with AES-256-GCM when the crypto module is enabled. Format: `aes-256-gcm:<iv>:<ciphertext>:<tag>`. Master key is stored in the OS keychain (keytar) with fallback to `system_config`.

---

### proxies

Stores proxy servers.

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Auto-increment ID |
| `type` | TEXT | Type (http/https/socks5) |
| `host` | TEXT | Host |
| `port` | INTEGER | Port |
| `username` | TEXT | Username |
| `password` | TEXT | Password |
| `proxy_rotation_url` | TEXT | IP rotation URL |
| `last_ip` | TEXT | Last checked IP |
| `last_checked_at` | DATETIME | Last check time |
| `is_active` | INTEGER | Active (0/1) |
| `created_at` | DATETIME | Creation date |
| `updated_at` | DATETIME | Update date |

**Indexes:**
- `idx_proxies_host_port` — host:port lookup (used for duplicate detection at API layer via `findByHostPort()`)

**Triggers:**
- `update_proxies_timestamp` — Auto-update `updated_at`

---

### cookies

Stores profile cookies.

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Auto-increment ID |
| `profile_id` | TEXT | Foreign key to profiles |
| `name` | TEXT | Cookie name |
| `value` | TEXT | Value |
| `domain` | TEXT | Domain |
| `path` | TEXT | Path (default /) |
| `expires` | INTEGER | Expiration time |
| `http_only` | INTEGER | HTTP-only flag (0/1) |
| `secure` | INTEGER | Secure flag (0/1) |
| `same_site` | TEXT | SameSite (Lax/Strict/None) |
| `created_at` | DATETIME | Creation date |

**Indexes:**
- `idx_cookies_profile_id` — Search by profile

**Cascade Delete:** When a profile is deleted, all its cookies are deleted.

---

### profile_logs

Stores profile logs.

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER | Auto-increment ID |
| `profile_id` | TEXT | Foreign key to profiles |
| `level` | TEXT | Level (info/warn/error/debug) |
| `message` | TEXT | Message |
| `metadata` | TEXT | JSON with additional data |
| `created_at` | DATETIME | Creation date |

**Indexes:**
- `idx_profile_logs_profile_id` — Search by profile
- `idx_profile_logs_created_at` — Sort by time

---

### system_config

Stores system configuration.

| Field | Type | Description |
|-------|------|-------------|
| `key` | TEXT | Configuration key |
| `value` | TEXT | Value |
| `updated_at` | DATETIME | Update date |

**Triggers:**
- `update_system_config_timestamp` — Auto-update `updated_at`

---

### projects

Stores automation projects/scripts from stAuto0.

| Field | Type | Description |
|-------|------|-------------|
| `name` | TEXT PK | Project name (concrete, allscale...) |
| `display_name` | TEXT | Human-readable name |
| `module_path` | TEXT | Module path for import |
| `class_name` | TEXT | Python class name |
| `is_active` | INTEGER | 1/0 — whether project is enabled |
| `default_config` | TEXT | JSON default configuration |
| `created_at` | DATETIME | Creation date |
| `updated_at` | DATETIME | Update date |

**Indexes:**
- None (PK on `name`)

**Triggers:**
- `update_projects_timestamp` — Auto-update `updated_at`

---

### project_profile_config

Matrix of Project×Profile marks (checkboxes).

| Field | Type | Description |
|-------|------|-------------|
| `project_name` | TEXT | FK → projects(name) |
| `profile_id` | TEXT | FK → profiles(id) |
| `is_enabled` | INTEGER | 0/1 — checkbox in matrix |
| `config_override` | TEXT | JSON parameter override |

**Composite PK:** `(project_name, profile_id)`

**Indexes:**
- `idx_project_profile_config_project` — Search by project
- `idx_project_profile_config_profile` — Search by profile

**Cascade Delete:** When a project or profile is deleted, the record is removed.

---

### runs

Group task (batch run).

| Field | Type | Description |
|-------|------|-------------|
| `id` | TEXT PK | UUIDv4 |
| `name` | TEXT | Run name |
| `status` | TEXT | pending / running / completed / partial / cancelled |
| `parallel_limit` | INTEGER | Max concurrent accounts |
| `total_tasks` | INTEGER | Total cells |
| `completed_tasks` | INTEGER | Completed |
| `success_tasks` | INTEGER | Successful |
| `failed_tasks` | INTEGER | Failed |
| `started_at` | DATETIME | Start time |
| `completed_at` | DATETIME | Completion time |
| `created_at` | DATETIME | Creation date |

**Indexes:**
- `idx_runs_status` — Search by status
- `idx_runs_created_at` — Sort by time

---

### run_tasks

Each matrix cell within a specific run.

| Field | Type | Description |
|-------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `run_id` | TEXT | FK → runs(id) |
| `project_name` | TEXT | FK → projects(name) |
| `profile_id` | TEXT | FK → profiles(id) |
| `status` | TEXT | pending / running / success / failed |
| `exit_code` | INTEGER | Python exit code |
| `log_file_path` | TEXT | Log file path |
| `attempts` | INTEGER | Number of attempts |
| `started_at` | DATETIME | Start time |
| `completed_at` | DATETIME | Completion time |

**Indexes:**
- `idx_run_tasks_run_id` — Search by run
- `idx_run_tasks_profile_id` — Search by profile

**Cascade Delete:** When a run is deleted, all its tasks are removed.

---

## Relationships

```
profiles ──┬── proxies (proxy_id)
           ├── cookies (profile_id) [CASCADE DELETE]
           ├── profile_logs (profile_id) [CASCADE DELETE]
           └── project_profile_config (profile_id) [CASCADE DELETE]
projects ──┬── project_profile_config (project_name) [CASCADE DELETE]
           └── run_tasks (project_name)
runs ──────┴── run_tasks (run_id) [CASCADE DELETE]
```

## WAL Mode

Database operates in Write-Ahead Logging mode for improved concurrent read/write performance.
