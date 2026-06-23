# API Reference

REST API для управления антидетект-браузером. Все запросы требуют заголовок авторизации.

## Авторизация

```http
Authorization: Bearer <token>
```

Токен генерируется при первом запуске или передаётся через `--api-token=SECRET`.

---

## Health Check

### GET /health

Проверка работоспособности сервера.

**Ответ:**
```json
{
  "status": "ok"
}
```

---

## Профили

### POST /api/profiles

Создать новый профиль. Отпечаток генерируется автоматически.

**Тело запроса:**
```json
{
  "name": "Мой профиль",
  "platform": "windows",
  "proxy_id": 1,
  "extensions": ["ext1", "ext2"],
  "tags": ["tag1"],
  "notes": "Заметка"
}
```

**Обязательные поля:** `name`, `platform` (windows | macos | linux)

**Ответ (201):**
```json
{
  "id": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "number": 1,
  "name": "Мой профиль",
  "proxy_id": 1,
  "fingerprint_seed": "a1b2c3d4-...",
  "platform": "windows",
  "user_agent": "Mozilla/5.0 ...",
  "screen_resolution": "1920x1080",
  "hardware_cores": 8,
  "hardware_memory": 16,
  "extensions": "[\"ext1\",\"ext2\"]",
  "tags": "[\"tag1\"]",
  "notes": "Заметка",
  "status": "stopped",
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

### GET /api/profiles

Получить список всех профилей.

**Ответ (200):** Массив профилей

---

### GET /api/profiles/:id

Получить профиль по ID.

**Ответ (200):** Профиль
**Ответ (404):** `{ "error": "Профиль не найден" }`

---

### PUT /api/profiles/:id

Обновить профиль.

**Тело запроса:**
```json
{
  "name": "Новое имя",
  "proxy_id": 2,
  "extensions": ["new_ext"],
  "tags": ["new_tag"],
  "notes": "Новая заметка"
}
```

**Ответ (200):** Обновленный профиль

---

### DELETE /api/profiles/:id

Удалить профиль. Невозможно удалить запущенный профиль.

**Ответ (204):** Успешное удаление
**Ответ (409):** `{ "error": "Невозможно удалить запущенный профиль" }`

---

### POST /api/profiles/:id/regenerate

Перегенерировать отпечаток профиля.

**Ответ (200):** Профиль с новым отпечатком

---

## Прокси

### POST /api/proxies

Добавить прокси.

**Тело запроса:**
```json
{
  "type": "socks5",
  "host": "proxy.example.com",
  "port": 1080,
  "username": "user",
  "password": "pass",
  "proxy_rotation_url": "https://api.proxy.com/rotate"
}
```

**Обязательные поля:** `type`, `host`, `port`

**Ответ (201):** Созданный прокси

---

### POST /api/proxies/import

Массовый импорт прокси.

**Тело запроса:**
```json
{
  "text": "socks5://user:pass@host1:1080\nhttp://host2:8080"
}
```

**Ответ (201):**
```json
{
  "count": 2,
  "proxies": [...]
}
```

---

### GET /api/proxies

Получить список всех прокси.

**Ответ (200):** Массив прокси

---

### GET /api/proxies/:id

Получить прокси по ID.

---

### PUT /api/proxies/:id

Обновить прокси.

**Тело запроса:**
```json
{
  "host": "new-host.com",
  "port": 9090,
  "is_active": true
}
```

---

### DELETE /api/proxies/:id

Удалить прокси.

---

### POST /api/proxies/:id/check

Проверить прокси (с автоматической ротацией, если настроена).

**Ответ (200):**
```json
{
  "ok": true,
  "ip": "1.2.3.4"
}
```

**Ответ (502):**
```json
{
  "error": "Ошибка ротации",
  "details": "Timeout"
}
```

---

## Куки

### GET /api/cookies/:profileId

Получить куки профиля.

**Ответ (200):** Массив куки

---

### POST /api/cookies/:profileId/import

Импортировать куки.

**Тело запроса:**
```json
{
  "format": "json",
  "content": "[{\"name\":\"session\",\"value\":\"abc123\",\"domain\":\".example.com\"}]"
}
```

**Форматы:** `json`, `netscape`

**Ответ (200):**
```json
{
  "count": 1
}
```

---

### GET /api/cookies/:profileId/export?format=json

Экспортировать куки.

**Параметры:** `format` (json | netscape)

**Ответ (200):** Массив куки или текст в формате Netscape

---

### DELETE /api/cookies/:profileId

Удалить все куки профиля.

---

## Управление браузером

### POST /api/browser/:id/start

Запустить браузер. Автоматически проверяет прокси (если привязан).

**Ответ (200):**
```json
{
  "status": "success",
  "profile_id": "f81d4fae-...",
  "pid": 48210,
  "ws_endpoint": "ws://127.0.0.1:3000/devtools/browser/f81d4fae-..."
}
```

**Ответ (412):** Прокси недоступен
```json
{
  "error": "Прокси недоступен",
  "details": "Connection refused"
}
```

**Ответ (502):** Ошибка ротации прокси

---

### POST /api/browser/:id/stop

Остановить браузер. Если процесс не завершается за 5 секунд, происходит принудительное завершение.

**Ответ (200):**
```json
{
  "status": "stopped"
}
```

---

### GET /api/browser/:id/status

Получить статус браузера.

**Ответ (200):**
```json
{
  "id": "f81d4fae-...",
  "status": "running",
  "pid": 48210
}
```

---

### POST /api/browser/:id/clean

Очистить кэш профиля. Доступно только для остановленных профилей.

**Ответ (200):**
```json
{
  "status": "cleaned"
}
```

**Ответ (409):**
```json
{
  "error": "Невозможно очистить кэш запущенного профиля"
}
```

---

## Статусы профиля

| Статус | Описание |
|--------|----------|
| `stopped` | Профиль остановлен |
| `starting` | Профиль запускается |
| `running` | Профиль запущен |

---

## Коды ошибок

| Код | Описание |
|-----|----------|
| 200 | Успешный запрос |
| 201 | Ресурс создан |
| 204 | Успешное удаление |
| 400 | Неверный запрос |
| 401 | Не авторизован |
| 404 | Ресурс не найден |
| 409 | Конфликт (запущенный профиль и т.д.) |
| 412 | Прокси недоступен |
| 500 | Внутренняя ошибка сервера |
| 502 | Ошибка прокси/ротации |
