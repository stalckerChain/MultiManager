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

### GET /api/browser/profile-windows

Получить список привязок профилей к окнам.

**Ответ (200):**
```json
[
  {
    "profileId": "f81d4fae-...",
    "pid": 48210,
    "handle": "12345"
  }
]
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

## Multi-Control (Синхронизация окон) — v0.4.0

Система синхронизации ввода из master окна во все slave окна.

**Архитектура:**
- **Захват ввода**: CDP binding (`Runtime.addBinding`) инжектируется в master page через `SYNC_EVENT_SCRIPT`
- **Передача**: DOM events → `window.__MM_SYNC_BIND__(JSON)` → `cdpManager.onEvent` → `inputCapture.injectFromCdp()`
- **Dispatch**: CDP `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` / `Input.insertText` → slave окна
- **Scroll sync**: CDP `Runtime.evaluate` (page-level)
- **Multi-tab**: `Target.setAutoAttach` + `Page.addScriptToEvaluateOnNewDocument` для новых вкладок

**Возможности:**
- Синхронизация мыши (клик, движение, скролл) между окнами
- Синхронизация клавиатуры (нажатия, печать текста)
- Ввод текста через `Input.insertText` (работает в полях ввода)
- Multi-tab support: новые вкладки в master автоматически захватываются
- Навигация sync: master переходит → slave следует (Page.navigate)

**Ограничения:**
- Browser shortcuts (Ctrl+L, Ctrl+T) не синхронизируются (DOM events не ловят браузерные шорткаты)
- Events привязаны к DOM — не работают на chrome:// и devtools:// страницах

### GET /api/multi-control/status

Получить статус multi-control.

**Ответ (200):**
```json
{
  "active": true,
  "masterId": "f81d4fae-...",
  "slaveCount": 3,
  "slaves": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

### POST /api/multi-control/start

Запустить multi-control. Устанавливает master-профиль и начинает захват ввода.

**Тело запроса:**
```json
{
  "masterId": "f81d4fae-..."
}
```

**Ответ (200):**
```json
{
  "status": "active",
  "masterId": "f81d4fae-...",
  "mode": "cdp"
}
```

**Ответ (412):** `{ "error": "CDP порт недоступен" }`

---

### POST /api/multi-control/stop

Остановить multi-control. Отвязывает всех slave.

**Ответ (200):**
```json
{
  "status": "stopped"
}
```

---

### POST /api/multi-control/slave/add

Добавить slave-профиль.

**Тело запроса:**
```json
{
  "profileId": "uuid-slave-1"
}
```

**Ответ (200):**
```json
{
  "status": "added",
  "profileId": "uuid-slave-1",
  "slaveCount": 1
}
```

**Ответ (409):** `{ "error": "Multi-control не активен" }`

---

### POST /api/multi-control/slave/remove

Удалить slave-профиль.

**Тело запроса:**
```json
{
  "profileId": "uuid-slave-1"
}
```

**Ответ (200):**
```json
{
  "status": "removed",
  "profileId": "uuid-slave-1"
}
```

---

### GET /api/multi-control/cdp-status

Получить статус CDP подключений.

**Ответ (200):**
```json
{
  "f81d4fae-...": true,
  "uuid-slave-1": true,
  "uuid-slave-2": true
}
```

---

## Расширения

### GET /api/extensions

Получить список установленных расширений.

**Ответ (200):**
```json
[
  {
    "id": "my-extension",
    "name": "My Extension",
    "version": "1.0.0",
    "description": "Extension description",
    "enabled": true,
    "path": "/path/to/extension"
  }
]
```

---

### POST /api/extensions

Установить расширение из директории на диске.

**Тело запроса:**
```json
{
  "name": "my-extension",
  "path": "/path/to/unpacked/extension"
}
```

**Ответ (201):** Установленное расширение

---

### DELETE /api/extensions/:id

Удалить расширение.

**Ответ (204):** Успешное удаление

---

### POST /api/extensions/:id/toggle

Переключить активность расширения.

**Ответ (200):**
```json
{
  "id": "my-extension",
  "enabled": true
}
```

---

## Логи

### GET /api/logs

Получить последние записи системного лога (core.log).

**Параметры:** `limit` (по умолчанию 100)

**Ответ (200):** Массив записей лога

---

### GET /api/logs/tail

Получить последние N байт системного лога.

**Параметры:** `bytes` (по умолчанию 10240)

**Ответ (200):**
```json
{
  "content": "...",
  "size": 51200
}
```

---

### GET /api/logs/profile/:profileId

Получить логи конкретного профиля.

**Параметры:** `limit` (по умолчанию 100)

**Ответ (200):** Массив записей лога

---

### GET /api/logs/files

Получить список всех файлов логов.

**Ответ (200):**
```json
[
  {
    "name": "core.log",
    "size": 51200,
    "modified": "2024-01-01T00:00:00.000Z"
  }
]
```

---

## Управление окнами (Window Arranger)

### GET /api/window-arranger/windows

Получить список текущих окон на экране.

**Ответ (200):**
```json
[
  {
    "id": "12345",
    "name": "CloakBrowser - Profile 1",
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080
  }
]
```

---

### GET /api/window-arranger/windows/grouped

Получить окна, сгруппированные по профилям.

**Ответ (200):**
```json
[
  {
    "profileId": "f81d4fae-...",
    "profileName": "Мой профиль",
    "profileNumber": 1,
    "windows": [
      {
        "id": "12345",
        "name": "CloakBrowser - Profile 1",
        "x": 0,
        "y": 0,
        "width": 1920,
        "height": 1080
      }
    ]
  }
]
```

---

### POST /api/window-arranger/grid

Расставить все окна в сетку (tile mode).

**Ответ (200):**
```json
{
  "arranged": 4,
  "cols": 2,
  "rows": 2,
  "screen": { "width": 1920, "height": 1080 }
}
```

---

### POST /api/window-arranger/grid/grouped

Расставить окна в сетку с группировкой по профилям. Каждая группа окон размещается в своей зоне экрана.

**Ответ (200):**
```json
{
  "arranged": 4,
  "groups": 2,
  "screen": { "width": 1920, "height": 1080 }
}
```

---

### POST /api/window-arranger/cascade

Расставить окна каскадом (внахлест со смещением 30px).

**Ответ (200):**
```json
{
  "arranged": 4,
  "offset": 30
}
```

---

### POST /api/window-arranger/cascade/grouped

Расставить окна каскадом с группировкой по профилям.

**Ответ (200):**
```json
{
  "arranged": 4,
  "offset": 30
}
```

---

### POST /api/window-arranger/focus/:windowId

Перевести фокус на указанное окно.

**Ответ (200):**
```json
{
  "focused": "12345"
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
