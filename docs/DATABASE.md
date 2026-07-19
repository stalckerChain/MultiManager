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

**Шифрование прокси (v1.4.0):** Поля `username` и `password` в таблице `proxies` также шифруются AES-256-GCM тем же мастер-ключом. При чтении расшифровываются прозрачно через `decryptProxyRow()`.

---

### proxies

Хранит прокси-серверы.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER | Автоинкрементный ID |
| `type` | TEXT | Тип (http/https/socks5) |
| `host` | TEXT | Хост |
| `port` | INTEGER | Порт |
| `username` | TEXT | Имя пользователя (шифруется AES-256-GCM, v1.4.0) |
| `password` | TEXT | Пароль (шифруется AES-256-GCM, v1.4.0) |
| `proxy_rotation_url` | TEXT | URL ротации IP |
| `last_ip` | TEXT | Последний проверенный IP |
| `last_checked_at` | DATETIME | Время последней проверки |
| `is_active` | INTEGER | Активен ли прокси (0/1) |
| `created_at` | DATETIME | Дата создания |
| `updated_at` | DATETIME | Дата обновления |

**Индексы:**
- `idx_proxies_host_port` — поиск по host:port (используется для проверки дубликатов при добавлении)

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

### projects

Хранит проекты/скрипты автоматизации из stAuto0.

| Поле | Тип | Описание |
|------|-----|----------|
| `name` | TEXT PK | Имя проекта (concrete, allscale...) |
| `display_name` | TEXT | Человеческое название |
| `module_path` | TEXT | Путь модуля для импорта |
| `class_name` | TEXT | Имя класса Python |
| `is_active` | INTEGER | 1/0 — включён ли проект |
| `default_config` | TEXT | JSON конфигурация по умолчанию |
| `created_at` | DATETIME | Дата создания |
| `updated_at` | DATETIME | Дата обновления |

**Индексы:**
- Нет (PK по `name`)

**Триггеры:**
- `update_projects_timestamp` — автообновление `updated_at`

---

### project_profile_config

Матрица отметок Проекты×Профили (чекбоксы).

| Поле | Тип | Описание |
|------|-----|----------|
| `project_name` | TEXT | FK → projects(name) |
| `profile_id` | TEXT | FK → profiles(id) |
| `is_enabled` | INTEGER | 0/1 — чекбокс в матрице |
| `config_override` | TEXT | JSON переопределение параметров |

**Составной PK:** `(project_name, profile_id)`

**Индексы:**
- `idx_project_profile_config_project` — поиск по проекту
- `idx_project_profile_config_profile` — поиск по профилю

**Каскадное удаление:** При удалении проекта или профиля запись удаляется.

---

### runs

Групповая задача (batch запуск).

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | TEXT PK | UUIDv4 |
| `name` | TEXT | Имя запуска |
| `status` | TEXT | pending / running / completed / partial / cancelled |
| `parallel_limit` | INTEGER | Максимум одновременных аккаунтов |
| `total_tasks` | INTEGER | Всего клеток |
| `completed_tasks` | INTEGER | Выполнено |
| `success_tasks` | INTEGER | Успешно |
| `failed_tasks` | INTEGER | С ошибками |
| `started_at` | DATETIME | Время начала |
| `completed_at` | DATETIME | Время завершения |
| `created_at` | DATETIME | Дата создания |

**Индексы:**
- `idx_runs_status` — поиск по статусу
- `idx_runs_created_at` — сортировка по времени

---

### run_tasks

Каждая клетка матрицы в рамках конкретного run.

| Поле | Тип | Описание |
|------|-----|----------|
| `id` | INTEGER PK | Автоинкремент |
| `run_id` | TEXT | FK → runs(id) |
| `project_name` | TEXT | FK → projects(name) |
| `profile_id` | TEXT | FK → profiles(id) |
| `status` | TEXT | pending / running / success / failed |
| `exit_code` | INTEGER | Код выхода Python |
| `log_file_path` | TEXT | Путь к логу |
| `attempts` | INTEGER | Количество попыток |
| `started_at` | DATETIME | Время начала |
| `completed_at` | DATETIME | Время завершения |

**Индексы:**
- `idx_run_tasks_run_id` — поиск по run
- `idx_run_tasks_profile_id` — поиск по профилю

**Каскадное удаление:** При удалении run все его задачи удаляются.

---

## Связи

```
profiles ──┬── proxies (proxy_id)
           ├── cookies (profile_id) [CASCADE DELETE]
           ├── profile_logs (profile_id) [CASCADE DELETE]
           └── project_profile_config (profile_id) [CASCADE DELETE]
projects ──┬── project_profile_config (project_name) [CASCADE DELETE]
           └── run_tasks (project_name)
runs ──────┴── run_tasks (run_id) [CASCADE DELETE]
```

## Режим WAL

База данных работает в режиме Write-Ahead Logging для повышения производительности параллельных чтений и записи.
