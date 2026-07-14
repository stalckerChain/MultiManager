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
  "notes": "Заметка",
  "timezone": "Asia/Bishkek",
  "email": "user@example.com",
  "email_password": "secret",
  "twitter_username": "my_twitter",
  "twitter_password": "tw_ secret",
  "twitter_auth_token": "auth_token_123",
  "twitter_email": "tw@example.com",
  "discord_username": "my_discord",
  "discord_password": "dc_secret",
  "discord_token": "dc_token_456",
  "discord_email": "dc@example.com",
  "wallet_evm_address": "0x1234567890abcdef1234567890abcdef12345678",
  "wallet_sol_address": "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
  "wallet_password": "my_wallet_pass"
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
  "timezone": "Asia/Bishkek",
  "email": "user@example.com",
  "email_password": "secret",
  "twitter_username": "my_twitter",
  "twitter_password": "tw_secret",
  "twitter_auth_token": "auth_token_123",
  "twitter_email": "tw@example.com",
  "discord_username": "my_discord",
  "discord_password": "dc_secret",
  "discord_token": "dc_token_456",
  "discord_email": "dc@example.com",
  "wallet_evm_address": "0x1234567890abcdef1234567890abcdef12345678",
  "wallet_sol_address": "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
  "wallet_password": "my_wallet_pass",
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
  "notes": "Новая заметка",
  "timezone": "Europe/London",
  "email": "new@example.com",
  "email_password": "new_secret",
  "twitter_username": "new_twitter",
  "twitter_auth_token": "new_token",
  "discord_username": "new_discord",
  "wallet_evm_address": "0xabcdef1234567890abcdef1234567890abcdef12"
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

### POST /api/profiles/batch

Массовое создание профилей. Все операции выполняются в одной транзакции (автооткат при ошибке).

**Тело запроса:**
```json
{
  "accounts": [
    { "name": "Profile 1", "platform": "windows" },
    { "name": "Profile 2", "platform": "macos" }
  ]
}
```

**Обязательные поля для каждого элемента:** `name`, `platform`

**Ответ (201):** Массив созданных профилей
```json
[
  { "id": "...", "name": "Profile 1", "number": 1, ... },
  { "id": "...", "name": "Profile 2", "number": 2, ... }
]
```

**Ответ (400):** `{ "error": "Элемент [0] требует name и platform" }`

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

**Ответ (409):** Прокси с таким `host:port` уже существует
```json
{
  "error": "Прокси с таким host:port уже существует"
}
```

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
  "duplicate_count": 1,
  "proxies": [...],
  "duplicates": [...]
}
```

Поле `count` — количество созданных прокси, `duplicate_count` — количество пропущенных дубликатов.

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
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
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

### POST /api/browser/:id/type

Human-like ввод текста через CDP. Имитирует реальный ввод с задержками 50–150 мс и 3% опечаток с Backspace.

**Тело запроса:**
```json
{
  "text": "Привет, мир!"
}
```

**Обязательные поля:** `text`

**Ответ (200):**
```json
{
  "status": "success"
}
```

**Ответ (400):** `{ "error": "Поле text обязательно" }`
**Ответ (404):** `{ "error": "Профиль не найден" }`
**Ответ (409):** `{ "error": "Профиль не запущен" }`
**Ответ (502):** `{ "error": "CDP порт не найден" }`

---

### POST /api/browser/:id/zerion-login

Автоматическая авторизация в Zerion (ID расширения: `klghhnkeealcohjjanjjdaeeggmfmlpl`).

**Тело запроса:**
```json
{
  "password": "zerion_password"
}
```

**Ответ (200):**
```json
{
  "status": "success"
}
```

**Ответ (404):** `{ "error": "Профиль не найден" }`
**Ответ (409):** `{ "error": "Профиль не запущен" }`
**Ответ (502):** `{ "error": "CDP порт не найден" }`

---

## Multi-Control (Синхронизация окон) — v0.13.0

Система синхронизации ввода из master окна во все slave окна через CDP (Chrome DevTools Protocol).

**Архитектура:**
- **Захват ввода (DOM)**: CDP binding `Runtime.addBinding('__MM_SYNC_BIND__')` инжектируется в master page через `SYNC_EVENT_SCRIPT`. DOM events (mousemove, mousedown, mouseup, wheel, keydown, keyup) + `visibilitychange` → `window.__MM_SYNC_BIND__(JSON)` → `cdpManager.onEvent` → `inputCapture.injectFromCdp()` → `controller.onMouseMoved/onKeyDown/etc.`
- **Native hooks (OS-level)**: C++ addon `WH_KEYBOARD_LL` перехватывает ВСЕ клавиши на уровне ОС, включая browser shortcuts (Ctrl+T, Ctrl+W). HTTP POST → `/api/multi-control/os-keyboard` → `controller.onKeyDown/onKeyUp`
- **Broadcast**: `controller` → `_getSlaveSession(slaveId)` → CDP `Input.dispatch*` / `Input.dispatchKeyEvent` / `Input.insertText` → slave окна
- **Mouse smoothing**: MouseSmoother (ghost-cursor `path()`: кубическая Безье + Fitts's Law + overshoot) + `setTimeout` dispatch loop + `flush()` перед кликом
- **Scroll**: Разбивается на серию `wheel` dispatch'ей (SCROLL_STEP_PX=40, SCROLL_TICK_MS=16)
- **Multi-tab**: HTTP `/json` polling каждые 300мс (DevTools endpoint) для обнаружения нативно-открытых вкладок. `Page.addScriptToEvaluateOnNewDocument` для инжекции sync-script в новые вкладки. Tab mapping 1:N через `Map<masterTargetId, Map<slaveId, slaveTargetId>>` + `tabIndex` matrix
- **Активация фокуса**: Цепочка `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()` для закрепления DOM-фокуса в slave

**Возможности:**
- Синхронизация мыши (клик, движение, скролл) с human-like траекториями
- Синхронизация клавиатуры (нажатия, Enter, стрелки)
- Ввод текста через `Input.insertText` (работает в полях ввода)
- Multi-tab support: новые вкладки в master автоматически захватываются через HTTP `/json` polling
- Навигация sync: master переходит → slave следует (Page.navigate)
- Browser shortcuts: Ctrl+T (нативное открытие, polling подхватывает), Ctrl+W (закрытие slave табов через CDP)
- Native hooks: перехват ВСЕХ клавиш на уровне ОС для browser chrome (адресная строка, tab bar)
- Double dispatch: при вводе в DOM-элементе клавиши уходят в slave дважды (CDP + native hook)

**Ограничения:**
- Events привязаны к DOM — не работают на chrome:// и devtools:// страницах (только native hooks для browser chrome)
- Orphaned native tabs: возможны при race condition между `/json` polling и открытием таба в slave
- Polling latency: до 300мс для обнаружения новых табов

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

### POST /api/multi-control/window-position

Установить позицию окна для slave-профиля.

**Тело запроса:**
```json
{
  "profileId": "uuid-slave-1",
  "x": 100,
  "y": 100,
  "width": 800,
  "height": 600
}
```

**Ответ (200):**
```json
{
  "status": "ok"
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

### POST /api/multi-control/os-keyboard

Получить событие клавиатуры от OS-level hook (Electron main process, WH_KEYBOARD_LL C++ addon). 

**Перехватывает ВСЕ клавиши на уровне ОС**, включая:
- Browser shortcuts (Ctrl+T, Ctrl+W, etc.)
- Enter в адресной строке
- Обычные символы при вводе в любом приложении

Это единственный источник событий для ввода в browser chrome (адресная строка, tab bar), поскольку CDP SYNC_EVENT_SCRIPT ловит только DOM-события.

> **Double Dispatch:** При вводе в DOM-элементе страницы (textarea, input), клавиша отправляется в slave дважды — один раз через CDP SYNC_EVENT_SCRIPT и второй раз через этот endpoint.

**Тело запроса:**
```json
{
  "type": "keyDown",
  "key": "l",
  "code": "KeyL",
  "windowsVirtualKeyCode": 76,
  "ctrlKey": true,
  "shiftKey": false,
  "altKey": false,
  "metaKey": false
}
```

**Ответ (200):**
```json
{
  "ok": true
}
```

---

### POST /api/multi-control/focus-windows

Перевести фокос на все окна multi-control (сначала slave, затем master).

**Ответ (200):**
```json
{
  "focused": true
}
```

---

## Internal API

### GET /api/internal/profiles?range=001-010

Получить профили по диапазону номеров. Возвращает секреты в расшифрованном виде.

**Параметры:** `range` — диапазон номеров в формате `NNN-NNN`

**Ответ (200):** Массив профилей с расшифрованными секретами

**Ответ (400):** `{ "error": "Неверный формат range: 001-010" }`

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

> **Примечание:** Если в `manifest.json` расширения используются i18n-плейсхолдеры вида `__MSG_appName__`, они автоматически резолвятся через `_locales/<locale>/messages.json`. Локаль выбирается по системе пользователя с fallback на `en`. Если резолв невозможен — возвращается исходное значение из манифеста.

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

### POST /api/extensions/:id/assign-all

Назначить расширение всем профилям. ID расширения добавляется в поле `extensions` каждого профиля в БД. Профили, у которых расширение уже назначено, пропускаются.

**Ответ (200):**
```json
{
  "assigned": 5
}
```

`assigned` — количество профилей, которым было назначено расширение.

**Ответ (404):** `{ "error": "Extension not found" }`

---

### POST /api/extensions/from-store

Установить расширение из Chrome Web Store по ссылке или ID.

**Тело запроса:**
```json
{
  "url": "https://chrome.google.com/webstore/detail/extension-name/abcdefghijklmnopqrstuvwxyzabcdef"
}
```

**ID расширения** — 32 символа `[a-z]`, извлекается автоматически из URL.

**Ответ (201):** Установленное расширение

---

### POST /api/extensions/from-zip

Установить расширение из ZIP или CRX архива.

**Тело запроса:**
```json
{
  "name": "my-extension",
  "zipPath": "/path/to/extension.zip"
}
```

Если архив содержит один корневой каталог — он автоматически срезается.
Поддерживаются форматы CRX v2 и CRX v3.

**Ответ (201):** Установленное расширение

---

## Задачи

### GET /api/tasks

Получить список всех задач.

**Ответ (200):** Массив задач

---

### POST /api/tasks

Создать задачу.

**Тело запроса:**
```json
{
  "name": "Моя задача",
  "script_name": "concrete",
  "schedule_type": "once",
  "params": { "referral_code": "abc" },
  "is_active": true
}
```

**Обязательные поля:** `name`, `script_name`, `schedule_type`

**Допустимые schedule_type:** `once`, `daily`, `weekly`, `manual`, `archive`

**Ответ (201):** Созданная задача

---

### GET /api/tasks/:id

Получить задачу по ID.

**Ответ (200):** Задача
**Ответ (404):** `{ "error": "Задача не найдена" }`

---

### PUT /api/tasks/:id

Обновить задачу.

**Ответ (200):** Обновленная задача

---

### DELETE /api/tasks/:id

Удалить задачу.

**Ответ (204):** Успешное удаление

---

### GET /api/tasks/:id/executions

Получить историю запусков задачи.

**Ответ (200):** Массив запусков

---

### POST /api/tasks/:id/run

Запустить задачу вручную. Если `stAuto0_path` и `python_path` не настроены, используются дефолтные значения (`~/AI/stAuto0` и `~/AI/stAuto0/venv/Scripts/python.exe`). Spawn'ит Python для каждого профиля, пишет логи, обновляет статус выполнения.

**Ответ (200):**
```json
{
  "status": "started",
  "task_id": "uuid",
  "task_name": "Моя задача",
  "script_name": "concrete",
  "profiles_count": 5,
  "executions": [
    { "executionId": 1, "profileId": "uuid", "profileName": "Profile 1", "status": "running", "scriptName": "concrete", "logFile": "/path/to/tasks/log.log" }
  ]
}
```

**Ответ (400):** `{ "error": "Задача неактивна" }` / `{ "error": "Нет профилей для выполнения задачи" }` / `{ "error": "Неверный формат range" }`
**Ответ (404):** `{ "error": "Задача не найдена" }`

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

## Генератор отпечатков (Fingerprint)

### POST /api/fingerprint/generate

Сгенерировать случайный отпечаток для указанной платформы. Не создаёт профиль.

**Тело запроса:**
```json
{
  "platform": "macos"
}
```

**Обязательные поля:** `platform` (windows | macos | linux)

**Ответ (200):**
```json
{
  "platform": "macos",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
  "screen_resolution": "2560x1600",
  "hardware_cores": 10,
  "hardware_memory": 16,
  "color_depth": 24,
  "webgl_renderer": "Apple GPU",
  "fingerprint_seed": "a1b2c3d4-..."
}
```

---

## Настройки

### GET /api/settings/crypto-status

Получить статус крипто-модуля (AES-256-GCM шифрование секретных полей профилей).

**Ответ (200):**
```json
{
  "initialized": true,
  "hasMasterKey": true,
  "keySource": "keytar",
  "passwordMode": false,
  "encryptedFields": ["email_password", "twitter_password", "twitter_auth_token", "discord_password", "discord_token", "wallet_password"]
}
```

---

### POST /api/settings/set-master-password

Установить мастер-пароль (включает passwordMode). Минимум 8 символов.

**Тело запроса:**
```json
{
  "password": "my_strong_password"
}
```

**Ответ (200):**
```json
{
  "status": "success",
  "passwordMode": true
}
```

**Ответ (400):** `{ "error": "Пароль должен быть не менее 8 символов" }`

---

### POST /api/settings/change-master-password

Сменить мастер-пароль.

**Тело запроса:**
```json
{
  "old_password": "old_password",
  "new_password": "new_password"
}
```

**Ответ (200):**
```json
{
  "status": "success"
}
```

**Ответ (400):** `{ "error": "Неверный старый пароль" }`

---

### GET /api/settings/recovery-key

Получить recovery-ключ (требуется мастер-пароль).

**Ответ (200):**
```json
{
  "recoveryKey": "recovery-key-here"
}
```

**Ответ (400):** `{ "error": "Крипто-модуль не инициализирован" }`

---

### GET /api/settings/automation

Получить настройки автоматизации (пути к директориям скриптов и проектов).

Если пути не настроены в БД, используются дефолтные значения:
- `stAuto0Path`: `~/AI/stAuto0` (на Windows: `C:\Users\<user>\AI\stAuto0`)
- `pythonPath`: `~/AI/stAuto0/venv/Scripts/python.exe` (на Windows)

**Ответ (200):**
```json
{
  "stAuto0Path": "C:\\Users\\stalcker\\AI\\stAuto0",
  "pythonPath": "C:\\Users\\stalcker\\AI\\stAuto0\\venv\\Scripts\\python.exe",
  "parallelLimit": 2,
  "availableProjects": ["concrete", "allscale", ...]
}
```

---

### PUT /api/settings/automation

Обновить настройки автоматизации. Если пути не указаны, используются дефолтные значения (`~/AI/stAuto0` и `~/AI/stAuto0/venv/Scripts/python.exe`).

**Тело запроса:**
```json
{
  "stAuto0Path": "/path/to/stAuto0",
  "pythonPath": "/path/to/python",
  "parallelLimit": 3
}
```

**Ответ (200):**
```json
{
  "status": "success",
  "syncResult": { "added": 2, "removed": 0, "total": 5 }
}
```

---

## Проекты (Automation Matrix)

### GET /api/projects

Список всех проектов, синхронизированных из `stAuto0/projects/*.py`.

**Ответ (200):**
```json
[
  {
    "name": "concrete",
    "display_name": "concrete",
    "module_path": "projects.concrete",
    "class_name": "",
    "is_active": 1,
    "default_config": "{}",
    "created_at": "2026-07-13 12:00:00",
    "updated_at": "2026-07-13 12:00:00"
  }
]
```

---

### POST /api/projects/sync

Сканировать директорию `stAuto0/projects/*.py`, добавить новые проекты, деактивировать удалённые. Игнорирует `__init__.py`, `base.py`, `loader.py`. Если `stAuto0_path` не настроен, используется дефолтный путь `~/AI/stAuto0`.

**Ответ (200):**
```json
{
  "added": 2,
  "removed": 0,
  "total": 5
}
```

---

### GET /api/projects/:name

Получить один проект с его профилями из матрицы.

**Ответ (200):**
```json
{
  "name": "concrete",
  "display_name": "Concrete Points",
  "is_active": 1,
  "profiles": [
    { "project_name": "concrete", "profile_id": "uuid", "is_enabled": 1 }
  ]
}
```

**Ответ (404):** `{ "error": "Project not found" }`

---

### PUT /api/projects/:name

Обновить настройки проекта (display_name, is_active, default_config, module_path, class_name).

**Тело запроса:**
```json
{
  "display_name": "Concrete Points",
  "is_active": 1,
  "default_config": "{\"referral_code\": \"ABC\"}"
}
```

**Ответ (200):** Обновлённый объект проекта

**Ответ (404):** `{ "error": "Project not found" }`

---

## Матрица (Matrix)

### GET /api/matrix

Вся матрица Проекты×Профили: проекты (из `stAuto0/config/projects.py`, только active), профили и отметки (чекбоксы). Проекты читаются напрямую из конфигурационного файла при каждом запросе — синхронизация не требуется.

**Ответ (200):**
```json
{
  "projects": [
    {
      "name": "concrete",
      "display_name": "Concrete",
      "is_active": true,
      "allowed_profile_ids": ["uuid1", "uuid2"]
    }
  ],
  "profiles": [
    { "id": "uuid", "number": 1, "name": "auto_001", "status": "stopped" }
  ],
  "matrix": [
    {
      "project_name": "concrete",
      "profile_id": "uuid",
      "is_enabled": 1,
      "config_override": "{}",
      "profile_name": "auto_001",
      "project_display": "Concrete"
    }
  ]
}
```

> `allowed_profile_ids` — список ID профилей, допустимых для проекта (на основе `PROJECT_FLAGS.accounts` в `config/projects.py`). Если `accounts` не указан — доступны все профили.

---

### PUT /api/matrix

Batch-обновление отметок матрицы. Транзакция: все изменения applied атомарно.

**Тело запроса:**
```json
{
  "entries": [
    { "project_name": "concrete", "profile_id": "uuid", "is_enabled": 1 },
    { "project_name": "allscale", "profile_id": "uuid", "is_enabled": 0 }
  ]
}
```

**Ответ (200):**
```json
{
  "updated": 2
}
```

**Ответ (400):** `{ "error": "Each entry requires project_name and profile_id" }`

---

## Запуски (Runs)

### GET /api/runs

Список запусков с пагинацией. Результаты сортируются по `created_at DESC`.

**Параметры:** `?page=1&limit=20`

**Ответ (200):**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Run 2026-07-13 12:00",
      "status": "pending",
      "parallel_limit": 2,
      "total_tasks": 5,
      "completed_tasks": 0,
      "success_tasks": 0,
      "failed_tasks": 0,
      "started_at": null,
      "completed_at": null,
      "created_at": "2026-07-13 12:00:00"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

---

### POST /api/runs

Создать новый run из текущих отмеченных клеток матрицы (`is_enabled=1`).

**Тело запроса:**
```json
{
  "name": "Daily run 2026-07-13",
  "parallel_limit": 3
}
```

Если `name` не указан — генерируется авто: `"Run 2026-07-13 12:00"`.

**Ответ (201):**
```json
{
  "run_id": "uuid",
  "tasks_created": 10,
  "name": "Daily run 2026-07-13"
}
```

**Ответ (400):** `{ "error": "No enabled entries in matrix" }`

---

### GET /api/runs/:id

Получить run со всеми run_tasks.

**Ответ (200):**
```json
{
  "id": "uuid",
  "name": "Daily run",
  "status": "running",
  "parallel_limit": 2,
  "total_tasks": 5,
  "completed_tasks": 2,
  "success_tasks": 2,
  "failed_tasks": 0,
  "tasks": [
    {
      "id": 1,
      "run_id": "uuid",
      "project_name": "concrete",
      "profile_id": "uuid",
      "status": "success",
      "exit_code": 0,
      "log_file_path": "logs/runs/uuid/auto_001.log",
      "attempts": 1,
      "started_at": "2026-07-13 12:00:00",
      "completed_at": "2026-07-13 12:05:00"
    }
  ]
}
```

**Ответ (404):** `{ "error": "Run not found" }`

---

### POST /api/runs/:id/start

Запустить выполнение run. Только для `pending` статуса. Запускает RunExecutor, который spawn'ит Python-процессы для каждого профиля с параллельным лимитом.

**Ответ (200):**
```json
{
  "status": "started",
  "run_id": "uuid"
}
```

**Ответ (400):** `{ "error": "Only pending runs can be started" }`
**Ответ (404):** `{ "error": "Run not found" }`

---

### POST /api/runs/:id/cancel

Отменить выполнение run. Убивает активные процессы (SIGTERM → SIGKILL), помечает все running/pending задачи как `failed`, устанавливает статус run = `cancelled`.

**Ответ (200):**
```json
{
  "status": "cancelled",
  "run_id": "uuid"
}
```

**Ответ (404):** `{ "error": "Run not found" }`

---

## Internal API (Callback от stAuto0)

### POST /api/internal/runs/:id/task-status

Callback endpoint для stAuto0. Обновляет статус одной клетки (project + profile) внутри run. Доступен только с localhost. Аутентифицируется тем же Bearer-токеном.

**Тело запроса:**
```json
{
  "project_name": "concrete",
  "profile_name": "auto_001",
  "status": "success",
  "attempts": 2
}
```

**Статусы:** `success`, `failed`, `running`

**Логика:**
- Находит `run_task` по `run_id + project_name + profile_name (→ profile_id)`
- Обновляет `status`, `exit_code`, `attempts`, `completed_at`
- Инкрементирует счётчики run (`completed_tasks`, `success_tasks`/`failed_tasks`)
- Если все задачи завершены → run.status = `completed` (или `partial` при наличии ошибок)

**Ответ (200):**
```json
{
  "ok": true
}
```

**Ответ (400):** `{ "error": "project_name, profile_name and status are required" }`
**Ответ (404):** `{ "error": "Run not found" }` / `{ "error": "Task not found" }`
**Ответ (403):** `{ "error": "Only localhost allowed" }`

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
| 502 | Ошибка прокси/ротации / CDP порт не найден |
