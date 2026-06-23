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
| `created_at` | DATETIME | 创建时间 |
| `updated_at` | DATETIME | 更新时间 |

**索引：**
- `idx_profiles_status` — 按状态快速搜索
- `idx_profiles_proxy_id` — 按代理搜索

**触发器：**
- `update_profiles_timestamp` — 自动更新 `updated_at`

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
           └── profile_logs (profile_id) [CASCADE DELETE]
```

## WAL 模式

数据库使用 Write-Ahead Logging 模式，提升并发读写性能。
