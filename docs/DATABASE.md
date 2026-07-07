# Database Schema

SQLite база данных с WAL-журналированием и ACID-транзакциями.

## Таблицы

### profiles

Хранит профили антидетект-браузера.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT (UUID) | Уникальный идентификатор |
| `number` | INTEGER | Порядковый номер |
| `name` | TEXT | Имя профиля |
| `proxy_id` | INTEGER | Внешний ключ на proxies |
| `fingerprint_seed` | TEXT | Зерно генерации отпечатка |
| `platform` | TEXT | Платформа (windows/mac/linux) |
| `user_agent` | TEXT | User-Agent строка |
| `screen_resolution` | TEXT | Разрешение экрана |
| `hardware_cores` | INTEGER | Количество ядер |
| `hardware_memory` | INTEGER | Объем ОЗУ (ГБ) |
| `extensions` | TEXT | JSON массив расширений |
| `tags` | TEXT | JSON массив тегов |
| `notes` | TEXT | Заметки |
| `status` | TEXT | Статус (stopped/starting/running) |
| `pid` | INTEGER | PID процесса браузера |
| `timezone` | TEXT | Часовой пояс (default 'Asia/Bishkek') |
| `email` | TEXT | Email |
| `email_password` | TEXT | Пароль от email |
| `twitter_username` | TEXT | X/Twitter username |
| `twitter_password` | TEXT | Пароль X/Twitter |
| `twitter_auth_token` | TEXT | X/Twitter auth token |
| `twitter_email` | TEXT | Email X/Twitter |
| `discord_username` | TEXT | Discord username |
| `discord_password` | TEXT | Пароль Discord |
| `discord_token` | TEXT | Discord токен |
| `discord_email` | TEXT | Email Discord |
| `wallet_evm_address` | TEXT | EVM-адрес кошелька |
| `wallet_sol_address` | TEXT | Solana-адрес кошелька |
| `wallet_password` | TEXT | Пароль кошелька (default 'asdfj*KK') |
| `created_at` | DATETIME | Дата создания |
| `updated_at` | DATETIME | Дата обновления |

**Индексы:**
- `idx_profiles_status` — быстрый поиск по статусу
- `idx_profiles_proxy_id` — поиск по прокси

**Триггеры:**
- `update_profiles_timestamp` — автообновление `updated_at`

**Миграция (v1.0.0 → v1.1.0):**
При инициализации БД выполняется `migrateTables()`: проверка наличия новых колонок через `PRAGMA table_info` и добавление недостающих через `ALTER TABLE ADD COLUMN`. Список мигрируемых колонок: `timezone`, `email`, `email_password`, `twitter_username`, `twitter_password`, `twitter_auth_token`, `twitter_email`, `discord_username`, `discord_password`, `discord_token`, `discord_email`, `wallet_evm_address`, `wallet_sol_address`, `wallet_password`.

**Шифрование (v1.2.0):** Поля `email_password`, `twitter_password`, `twitter_auth_token`, `discord_password`, `discord_token`, `wallet_password` автоматически шифруются AES-256-GCM при включённом крипто-модуле. Формат: `aes-256-gcm:<iv>:<ciphertext>:<tag>`. Мастер-ключ хранится в системной связке ключей (keytar) с фоллбэком на `system_config`.

---

### tasks

Хранит задачи планировщика.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT (UUID) | Уникальный идентификатор |
| `name` | TEXT | Имя задачи |
| `script_name` | TEXT | Имя скрипта для запуска |
| `schedule_type` | TEXT | Тип расписания (cron/interval/manual) |
| `cron_expression` | TEXT | Cron-выражение (для schedule_type=cron) |
| `params` | TEXT | JSON параметры задачи |
| `is_active` | INTEGER | Активна ли задача (0/1) |
| `created_at` | DATETIME | Дата создания |
| `updated_at` | DATETIME | Дата обновления |

**Индексы:**
- `idx_tasks_is_active` — поиск активных задач
- `idx_tasks_schedule_type` — фильтр по типу расписания

**Триггеры:**
- `update_tasks_timestamp` — автообновление `updated_at`

---

### task_executions

Хранит историю запусков задач.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER | Автоинкрементный ID |
| `task_id` | TEXT | Внешний ключ на tasks |
| `profile_id` | TEXT | Внешний ключ на profiles |
| `status` | TEXT | Статус (pending/running/success/failed) |
| `exit_code` | INTEGER | Код возврата |
| `last_run_at` | DATETIME | Время последнего запуска |
| `log_file_path` | TEXT | Путь к файлу лога |

**Индексы:**
- `idx_task_executions_task_id` — поиск по задаче
- `idx_task_executions_profile_id` — поиск по профилю

**Каскадное удаление:** При удалении задачи удаляются все её выполнения.

---

### proxies

Хранит прокси-серверы.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER | Автоинкрементный ID |
| `type` | TEXT | Тип (http/https/socks5) |
| `host` | TEXT | Хост |
| `port` | INTEGER | Порт |
| `username` | TEXT | Имя пользователя |
| `password` | TEXT | Пароль |
| `proxy_rotation_url` | TEXT | URL ротации IP |
| `last_ip` | TEXT | Последний проверенный IP |
| `last_checked_at` | DATETIME | Время последней проверки |
| `is_active` | INTEGER | Активен ли прокси (0/1) |
| `created_at` | DATETIME | Дата создания |
| `updated_at` | DATETIME | Дата обновления |

**Индексы:**
- `idx_proxies_host_port` — уникальность host:port

**Триггеры:**
- `update_proxies_timestamp` — автообновление `updated_at`

---

### cookies

Хранит куки профилей.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER | Автоинкрементный ID |
| `profile_id` | TEXT | Внешний ключ на profiles |
| `name` | TEXT | Имя куки |
| `value` | TEXT | Значение |
| `domain` | TEXT | Домен |
| `path` | TEXT | Путь (по умолчанию /) |
| `expires` | INTEGER | Время истечения |
| `http_only` | INTEGER | HTTP-only флаг (0/1) |
| `secure` | INTEGER | Secure флаг (0/1) |
| `same_site` | TEXT | SameSite (Lax/Strict/None) |
| `created_at` | DATETIME | Дата создания |

**Индексы:**
- `idx_cookies_profile_id` — поиск по профилю

**Каскадное удаление:** При удалении профиля удаляются все его куки.

---

### profile_logs

Хранит логи профилей.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER | Автоинкрементный ID |
| `profile_id` | TEXT | Внешний ключ на profiles |
| `level` | TEXT | Уровень (info/warn/error/debug) |
| `message` | TEXT | Сообщение |
| `metadata` | TEXT | JSON с дополнительными данными |
| `created_at` | DATETIME | Дата создания |

**Индексы:**
- `idx_profile_logs_profile_id` — поиск по профилю
- `idx_profile_logs_created_at` — сортировка по времени

---

### system_config

Хранит системные настройки.

| Поле | Тип | Описание |
|------|-----|----------|
| `key` | TEXT | Ключ настройки |
| `value` | TEXT | Значение |
| `updated_at` | DATETIME | Дата обновления |

**Триггеры:**
- `update_system_config_timestamp` — автообновление `updated_at`

---

## Связи

```
profiles ──┬── proxies (proxy_id)
           ├── cookies (profile_id) [CASCADE DELETE]
           ├── profile_logs (profile_id) [CASCADE DELETE]
           └── task_executions (profile_id)
tasks ─────┴── task_executions (task_id) [CASCADE DELETE]
```

## Режим WAL

База данных работает в режиме Write-Ahead Logging для повышения производительности параллельных чтений и записи.
