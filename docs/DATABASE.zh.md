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

---

### tasks

存储调度任务。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | TEXT (UUID) | 唯一标识符 |
| `name` | TEXT | 任务名称 |
| `script_name` | TEXT | 要运行的脚本 |
| `schedule_type` | TEXT | 调度类型（cron/interval/manual） |
| `cron_expression` | TEXT | Cron 表达式（schedule_type=cron 时使用） |
| `params` | TEXT | JSON 任务参数 |
| `is_active` | INTEGER | 活动标志（0/1） |
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**索引：**
- `idx_tasks_is_active` — 活动任务搜索
- `idx_tasks_schedule_type` — 按调度类型筛选

**触发器：**
- `update_tasks_timestamp` — 自动更新 `updated_at`

---

### task_executions

存储任务执行历史。

| 字段 | 类型 | 描述 |
|------|------|------|
| `id` | INTEGER | 自增 ID |
| `task_id` | TEXT | 外键关联 tasks |
| `profile_id` | TEXT | 外键关联 profiles |
| `status` | TEXT | 状态（pending/running/success/failed） |
| `exit_code` | INTEGER | 退出码 |
| `last_run_at` | DATETIME | 最后运行时间 |
| `log_file_path` | TEXT | 日志文件路径 |

**索引：**
- `idx_task_executions_task_id` — 按任务搜索
- `idx_task_executions_profile_id` — 按配置文件搜索

**级联删除：** 删除任务时，其所有执行记录一并删除。

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
- `idx_proxies_host_port` — host:port 唯一性

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

## 关系

```
profiles ──┬── proxies (proxy_id)
           ├── cookies (profile_id) [CASCADE DELETE]
           ├── profile_logs (profile_id) [CASCADE DELETE]
           └── task_executions (profile_id)
tasks ─────┴── task_executions (task_id) [CASCADE DELETE]
```

## WAL 模式

数据库使用 Write-Ahead Logging 模式，提升并发读写性能。
