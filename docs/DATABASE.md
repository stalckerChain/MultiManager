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
| `created_at` | DATETIME | Дата создания |
| `updated_at` | DATETIME | Дата обновления |

**Индексы:**
- `idx_profiles_status` — быстрый поиск по статусу
- `idx_profiles_proxy_id` — поиск по прокси

**Триггеры:**
- `update_profiles_timestamp` — автообновление `updated_at`

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
           └── profile_logs (profile_id) [CASCADE DELETE]
```

## Режим WAL

База данных работает в режиме Write-Ahead Logging для повышения производительности параллельных чтений и записи.
