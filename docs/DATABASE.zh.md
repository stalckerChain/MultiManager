# 数据库架构

SQLite 数据库，使用 WAL 日志和 ACID 事务。

## 表

### profiles

存储反检测浏览器配置文件。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | TEXT (UUID) | 唯一标识符 |
| `number` | INTEGER | 序号 |
| `name` | TEXT | 配置文件名称 |
| `proxy_id` | INTEGER | 外键关联 proxies |
| `fingerprint_seed` | TEXT | 指纹生成种子 |
| `platform` | TEXT | 平台（windows/mac/linux） |
| `user_agent` | TEXT | User-Agent 字符串 |
| `screen_resolution` | TEXT | 屏幕分辨率 |
| `hardware_cores` | INTEGER | CPU 核心数 |
| `hardware_memory` | INTEGER | 内存（GB） |
| `extensions` | TEXT | JSON 扩展 ID 数组 |
| `tags` | TEXT | JSON 标签数组 |
| `notes` | TEXT | 备注 |
| `status` | TEXT | 状态（stopped/starting/running） |
| `pid` | INTEGER | 浏览器进程 PID |
| `timezone` | TEXT | 时区（默认 'Asia/Bishkek'） |
| `email` | TEXT | 邮箱 |
| `email_password` | TEXT | 邮箱密码 |
| `twitter_username` | TEXT | X/Twitter 用户名 |
| `twitter_password` | TEXT | X/Twitter 密码 |
| `twitter_auth_token` | TEXT | X/Twitter 认证令牌 |
| `twitter_email` | TEXT | X/Twitter 邮箱 |
| `discord_username` | TEXT | Discord 用户名 |
| `discord_password` | TEXT | Discord 密码 |
| `discord_token` | TEXT | Discord 令牌 |
| `discord_email` | TEXT | Discord 邮箱 |
| `wallet_evm_address` | TEXT | EVM 钱包地址 |
| `wallet_sol_address` | TEXT | Solana 钱包地址 |
| `wallet_password` | TEXT | 钱包密码（默认 'asdfj*KK'） |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**索引：**
- `idx_profiles_status` — 按状态快速搜索
- `idx_profiles_proxy_id` — 按代理搜索

**触发器：**
- `update_profiles_timestamp` — 自动更新 `updated_at`

**迁移 (v1.0.0 → v1.1.0)：**
数据库初始化时，`migrateTables()` 通过 `PRAGMA table_info` 检查新列，并通过 `ALTER TABLE ADD COLUMN` 添加缺失列。迁移的列包括：`timezone`, `email`, `email_password`, `twitter_username`, `twitter_password`, `twitter_auth_token`, `twitter_email`, `discord_username`, `discord_password`, `discord_token`, `discord_email`, `wallet_evm_address`, `wallet_sol_address`, `wallet_password`。

**加密 (v1.2.0)：** 字段 `email_password`、`twitter_password`、`twitter_auth_token`、`discord_password`、`discord_token`、`wallet_password` 在加密模块启用时会自动使用 AES-256-GCM 加密。格式：`aes-256-gcm:<iv>:<ciphertext>:<tag>`。主密钥存储在操作系统密钥链（keytar）中，并回退到 `system_config`。

---

### proxies

存储代理服务器。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | INTEGER | 自增 ID |
| `type` | TEXT | 类型（http/https/socks5） |
| `host` | TEXT | 主机 |
| `port` | INTEGER | 端口 |
| `username` | TEXT | 用户名 |
| `password` | TEXT | 密码 |
| `proxy_rotation_url` | TEXT | IP 轮换 URL |
| `last_ip` | TEXT | 最后检查的 IP |
| `last_checked_at` | DATETIME | 最后检查时间 |
| `is_active` | INTEGER | 是否激活（0/1） |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**索引：**
- `idx_proxies_host_port` — host:port 查找（用于 API 层通过 `findByHostPort()` 进行重复检测）

**触发器：**
- `update_proxies_timestamp` — 自动更新 `updated_at`

---

### cookies

存储配置文件的 Cookie。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | INTEGER | 自增 ID |
| `profile_id` | TEXT | 外键关联 profiles |
| `name` | TEXT | Cookie 名称 |
| `value` | TEXT | 值 |
| `domain` | TEXT | 域名 |
| `path` | TEXT | 路径（默认 /） |
| `expires` | INTEGER | 过期时间 |
| `http_only` | INTEGER | HTTP-only 标志（0/1） |
| `secure` | INTEGER | Secure 标志（0/1） |
| `same_site` | TEXT | SameSite（Lax/Strict/None） |
| `created_at` | DATETIME | 创建时间 |

**索引：**
- `idx_cookies_profile_id` — 按配置文件搜索

**级联删除：** 删除配置文件时，其所有 Cookie 一并删除。

---

### profile_logs

存储配置文件日志。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | INTEGER | 自增 ID |
| `profile_id` | TEXT | 外键关联 profiles |
| `level` | TEXT | 级别（info/warn/error/debug） |
| `message` | TEXT | 消息 |
| `metadata` | TEXT | JSON 附加数据 |
| `created_at` | DATETIME | 创建时间 |

**索引：**
- `idx_profile_logs_profile_id` — 按配置文件搜索
- `idx_profile_logs_created_at` — 按时间排序

---

### system_config

存储系统配置。

| 字段 | 类型 | 描述 |
|------|------|------|
| `key` | TEXT | 配置键 |
| `value` | TEXT | 值 |
| `updated_at` | DATETIME | 更新时间 |

**触发器：**
- `update_system_config_timestamp` — 自动更新 `updated_at`

---

### projects

存储来自 stAuto0 的自动化项目/脚本。

| 字段 | 类型 | 描述 |
|------|------|------|
| `name` | TEXT PK | 项目名称（concrete, allscale...） |
| `display_name` | TEXT | 人类可读名称 |
| `module_path` | TEXT | 模块导入路径 |
| `class_name` | TEXT | Python 类名 |
| `is_active` | INTEGER | 1/0 — 项目是否启用 |
| `default_config` | TEXT | JSON 默认配置 |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**索引：**
- 无（主键为 `name`）

**触发器：**
- `update_projects_timestamp` — 自动更新 `updated_at`

---

### project_profile_config

项目×配置文件标记矩阵（复选框）。

| 字段 | 类型 | 描述 |
|------|------|------|
| `project_name` | TEXT | 外键关联 projects(name) |
| `profile_id` | TEXT | 外键关联 profiles(id) |
| `is_enabled` | INTEGER | 0/1 — 矩阵中的复选框 |
| `config_override` | TEXT | JSON 参数覆盖 |

**复合主键：** `(project_name, profile_id)`

**索引：**
- `idx_project_profile_config_project` — 按项目搜索
- `idx_project_profile_config_profile` — 按配置文件搜索

**级联删除：** 删除项目或配置文件时，记录会被删除。

---

### runs

批量任务（批处理运行）。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | TEXT PK | UUIDv4 |
| `name` | TEXT | 运行名称 |
| `status` | TEXT | pending / running / completed / partial / cancelled |
| `parallel_limit` | INTEGER | 最大并发账户数 |
| `total_tasks` | INTEGER | 总单元格数 |
| `completed_tasks` | INTEGER | 已完成 |
| `success_tasks` | INTEGER | 成功 |
| `failed_tasks` | INTEGER | 失败 |
| `started_at` | DATETIME | 开始时间 |
| `completed_at` | DATETIME | 完成时间 |
| `created_at` | DATETIME | 创建时间 |

**索引：**
- `idx_runs_status` — 按状态搜索
- `idx_runs_created_at` — 按时间排序

---

### run_tasks

特定运行中的每个矩阵单元格。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | INTEGER PK | 自增 ID |
| `run_id` | TEXT | 外键关联 runs(id) |
| `project_name` | TEXT | 外键关联 projects(name) |
| `profile_id` | TEXT | 外键关联 profiles(id) |
| `status` | TEXT | pending / running / success / failed |
| `exit_code` | INTEGER | Python 退出码 |
| `log_file_path` | TEXT | 日志文件路径 |
| `attempts` | INTEGER | 尝试次数 |
| `started_at` | DATETIME | 开始时间 |
| `completed_at` | DATETIME | 完成时间 |

**索引：**
- `idx_run_tasks_run_id` — 按运行搜索
- `idx_run_tasks_profile_id` — 按配置文件搜索

**级联删除：** 删除运行时，其所有任务会被删除。

---

## 关系

```
profiles ──┬── proxies (proxy_id)
           ├── cookies (profile_id) [CASCADE DELETE]
           ├── profile_logs (profile_id) [CASCADE DELETE]
           └── project_profile_config (profile_id) [CASCADE DELETE]
projects ──┬── project_profile_config (project_name) [CASCADE DELETE]
           └── run_tasks (project_name)
runs ──────┴── run_tasks (run_id) [CASCADE DELETE]
```

## WAL 模式

数据库使用 Write-Ahead Logging 模式，提升并发读写性能。
