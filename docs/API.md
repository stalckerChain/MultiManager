# API Reference

REST API для управления антидетект-браузером. Все запросы требуют заголовок авторизации.

## Авторизация

```http
Authorization: Bearer <token>
```

Токен авторизации постоянный и хранится в SQLite (`system_config.api_token`):

- при первом запуске генерируется криптографически стойким способом и сохраняется в БД;
- при последующих запусках используется сохранённое значение, новая генерация не выполняется;
- при ручном запуске backend приоритет имеют `--api-token=` и env-переменная `API_TOKEN`; такие значения не сохраняются в БД и не перезаписывают постоянный токен.

Ротация токена выполняется пользователем через GUI (Settings → «Сгенерировать API-токен заново») или через `POST /api/settings/api-token/regenerate` (см. ниже). После ротации:

- новое значение действует немедленно для REST и WebSocket;
- все активные WebSocket-соединения закрываются (close code 4401);
- старый токен больше не принимается (REST и WebSocket).

Токен не логируется и не включается в диагностические payloads.

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

## Информация о профиле (public loopback)

### GET /profile-info/:profileId

Публичный локальный HTML endpoint (без авторизации, только loopback). При запуске
профиля в браузере открывается новая вкладка с URL
`http://127.0.0.1:<port>/profile-info/<profileId>` — страница с информацией об
аккаунте. Заголовок вкладки (`<title>`) равен имени аккаунта.

Endpoint получает профиль и связанный прокси из существующих query-объектов и
возвращает HTML только с согласованными полями:

- `name` — имя аккаунта (заголовок вкладки и страницы);
- `email`;
- `wallet_evm_address`;
- `wallet_sol_address`;
- `twitter_username` — как X username;
- `discord_username`;
- `last_ip` прокси (IP прокси);
- `location` прокси (локация прокси).

Отсутствующие значения отображаются единообразным безопасным placeholder
`Не указано`. Все пользовательские значения экранируются перед вставкой в HTML.

Секретные поля не включаются в HTML: `email_password`, `wallet_password`,
`twitter_password`, `twitter_auth_token`, `twitter_email`, `discord_password`,
`discord_token`, `discord_email`, proxy username/password, fingerprint seed.

Ограничения:

- Endpoint без авторизации по согласованию. Даже при binding на `127.0.0.1`
  любой локальный процесс, знающий UUID профиля, может прочитать отображаемые
  данные аккаунта. UUID профиля не считать механизмом авторизации.
- Отдельный rate limiter для `/profile-info/:profileId` не добавляется
  (loopback-only, endpoint вне `/api/`).
- URL информационной вкладки не логируется.

**Ответ (200):** HTML страница, `Content-Type: text/html`
**Ответ (404):** `{ "error": "Профиль не найден" }`

---

## Профили

### POST /api/profiles

Создать новый профиль. Отпечаток генерируется автоматически. **timezone обязателен.**

**Тело запроса:**
```json
{
  "name": "Мой профиль",
  "platform": "windows",
  "timezone": "Europe/Berlin",
  "proxy_id": 1,
  "extensions": ["ext1", "ext2"],
  "tags": ["tag1"],
  "notes": "Заметка",
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
  "wallet_password": "my_wallet_pass",
  "profile_path": "C:\\Users\\user\\stAuto0\\config\\chrome_accounts\\auto_001"
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
  "profile_path": "C:\\Users\\user\\stAuto0\\config\\chrome_accounts\\auto_001",
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
  "wallet_evm_address": "0xabcdef1234567890abcdef1234567890abcdef12",
  "profile_path": "C:\\Users\\user\\stAuto0\\config\\chrome_accounts\\auto_001"
}
```

**Fingerprint-набор** (опционально, передаётся целиком одним набором):
```json
{
  "platform": "windows",
  "fingerprint_seed": "46f7702b-c11d-4ab7-b29c-d314472e7e5c",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
  "screen_resolution": "1920x1080",
  "hardware_cores": 8,
  "hardware_memory": 16,
  "fingerprint_platform": "windows"
}
```

Поведение:
- Если передан полный fingerprint-набор (все шесть полей), он сохраняется одним UPDATE без генерации нового fingerprint, даже при смене `platform`. `fingerprint_platform` обязан совпадать с эффективной платформой (`platform`, если передан, иначе текущая платформа профиля); при несовпадении — `400`.
- Если набор не передан и `platform` отличается от сохранённой — backend генерирует новый полный fingerprint для новой платформы (прежнее поведение).
- Если набор не передан и платформа не менялась — fingerprint-поля профиля сохраняются без изменений.
- Передача неполного набора (например, только `user_agent`) отклоняется с `400`.

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

`host` перед сохранением нормализуется: начальные и конечные пробелы удаляются (`trim`), значение приводится к нижнему регистру (`toLowerCase`). В БД сохраняется нормализованный `host`.

Дубликат определяется по нормализованной паре `host:port`. Поля `type`, `username`, `password` и `proxy_rotation_url` не входят в ключ дубликата.

**Ответ (201):** Созданный прокси (включает поле `location`, определяется при check)

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

К каждому прокси из списка применяется та же нормализация `host` (trim + lowercase), что и при одиночном создании. Дубликат определяется по нормализованной паре `host:port`. Строки, повторяющиеся внутри одного входного списка, отбрасываются по той же последовательной проверке после каждой вставки: `duplicate_count` учитывает и совпадения с уже существующими записями, и повторяющиеся строки списка.

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

Если поле `host` передано, оно нормализуется (trim + lowercase) перед проверкой и сохранением. Если `host` отсутствует, текущее значение сохраняется без изменений.

Перед обновлением выполняется проверка конфликта по нормализованной паре `host:port` (для полей, фактически переданных в запросе; отсутствующие берутся из текущей записи). При совпадении с другой записью возвращается **409** и запись не изменяется. Обновление записи на её собственный текущий нормализованный `host:port` допустимо.

**Ответ (200):** Обновлённый прокси

**Ответ (409):** Прокси с таким `host:port` уже существует
```json
{
  "error": "Прокси с таким host:port уже существует"
}
```

---

### DELETE /api/proxies/:id

Удалить прокси.

---

### POST /api/proxies/:id/check

Проверить прокси (с автоматической ротацией, если настроена). При успешной проверке определяется и сохраняется location (формат `DE(Germany)`) через ip-api.com.

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

### POST /api/proxies/distribute/preview

Предварительная проверка прокси перед распределением. Проверяет исходный набор прокси
выбранного режима **последовательно** (с ротацией при необходимости) и возвращает
результаты без изменения назначений профилей. Не возвращает username/password прокси.

**Тело запроса:**
```json
{
  "mode": "used"
}
```

**Параметры:** `mode` — `used` (уникальные прокси, назначенные хотя бы одному профилю)
или `all` (все прокси из таблицы, независимо от `is_active`).

**Ответ (200):**
```json
{
  "mode": "used",
  "profiles_count": 10,
  "checked_count": 5,
  "working_count": 4,
  "failed_count": 1,
  "working_proxy_ids": [1, 2, 3, 4]
}
```

- `profiles_count` — общее число профилей (целевая группа распределения);
- `checked_count` — количество проверенных прокси;
- `working_count` / `failed_count` — рабочие и нерабочие прокси;
- `working_proxy_ids` — числовые ID рабочих прокси, передаются во второй фазе.

Проверка отдельных прокси выполняется тем же способом, что и `POST /api/proxies/:id/check`
(rotation → ожидание → check), технические поля (`is_active`, `last_ip`, location)
обновляются. Ошибка одного прокси не прерывает обработку остальных — такой прокси
считается нерабочим.

**Ответ (400):** невалидный `mode`.

---

### POST /api/proxies/distribute

Подтверждённое распределение рабочих прокси по всем профилям. Повторной сетевой
проверки не выполняет. Обновляет только `profiles.proxy_id` в одной SQLite-транзакции.
Не возвращает username/password прокси.

**Тело запроса:**
```json
{
  "mode": "used",
  "working_proxy_ids": [1, 2, 3, 4]
}
```

**Параметры:**
- `mode` — тот же режим, что и в preview;
- `working_proxy_ids` — ID рабочих прокси из ответа preview.

Backend повторно валидирует, что все переданные ID принадлежат допустимому источнику
выбранного режима; при несоответствии операция отклоняется без изменений.

**Логика распределения:** аккаунты обрабатываются в стабильном порядке (`profiles.number`);
для каждого выбирается случайный прокси из оставшихся в текущем цикле; когда рабочие
прокси заканчиваются, список полностью восстанавливается (цикл повторяется). В рамках
одного цикла прокси не повторяются.

**Ответ (200):**
```json
{
  "assigned_profiles": 10,
  "used_proxies": 4
}
```

**Ответ (400):**
- `working_proxy_ids` содержит прокси вне допустимого источника для выбранного режима;
- `working_proxy_ids` пуст — «Нет рабочих прокси для распределения»; назначения не меняются.

---

### GET /api/proxies/:id/timezone

Определить таймзону по IP-адресу прокси. Требуется предварительная проверка прокси.

**Ответ (200):**
```json
{
  "timezone": "Europe/Berlin"
}
```

**Ответ (500):**
```json
{
  "error": "IP прокси не определён. Сначала выполните проверку прокси.",
  "code": "BAD_GATEWAY"
}
```

---

## Куки

> Таблица `cookies` — очередь одноразового импорта. Импортированные cookies
> применяются после запуска браузера через CDP `Network.setCookies`; после
> подтверждения применения через `Network.getAllCookies` запись удаляется из
> очереди. Уже применённые cookies находятся только в нативном хранилище
> Chromium и в таблицу не возвращаются. Файл `<user-data-dir>/Default/Cookies`
> напрямую не читается и не перезаписывается.

### GET /api/cookies/:profileId

Получить куки профиля (оставшиеся в очереди импорта).

**Ответ (200):** Массив куки

---

### POST /api/cookies/:profileId/import

Импортировать куки в очередь одноразового импорта.

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

Экспортировать куки. Для запущенного профиля возвращаются актуальные cookies
через CDP `Network.getAllCookies`; для остановленного — только оставшиеся в
очереди записи (пустая очередь → `[]`).

**Параметры:** `format` (json | netscape)

**Ответ (200):** Массив куки или текст в формате Netscape

---

### DELETE /api/cookies/:profileId

Удалить все куки профиля (очистить очередь импорта).

---

## Управление браузером

### POST /api/browser/:id/start

Запустить браузер. Автоматически проверяет прокси (если привязан). Браузер запускается с антидетект-аргументами: `--fingerprint-timezone` (timezone из GeoIP прокси, фоллбэк — профиль), `--lang=en-US`, `--no-first-run`, `--no-default-browser-check`, `--disable-session-crashed-bubble`. При ошибке `ERR_ADDRESS_IN_USE` автоматически повторяет запуск до 3 раз.

**Тело запроса (опционально):**
```json
{
  "run_id": "run-123"
}
```

`run_id` — идентификатор automation-run. Если передан, этапы загрузки расширений через CDP (`browser_connection`, `cdp_extension_loading`) и отдельные ошибки записываются в связанный run-лог (`logs/runs/<run_id>/<profile>.log`). Без `run_id` те же этапы не дублируются в run-лог (ручной запуск профиля). Не содержит секретов.

Передавать `run_id` должен automation-клиент (например `stAuto0`, который получает `--run-id` от executor).

**Автологин кошелька (ручной запуск, без `run_id`):** после запуска браузера и загрузки расширений выполняется preflight по wallet-полям профиля:

- Если непустые одновременно `wallet_evm_address` и `wallet_password` — выполняется существующий Zerion-автологин. Перед логином и после него (включая ошибку) все page-вкладки закрываются, остаётся одна вкладка `about:blank`.
- Если хотя бы одно из полей отсутствует или пустое — автологин не выполняется; вкладки всё равно приводятся к одной `about:blank`.
- Ошибка автологина не останавливает браузер: пишется в профильный лог без пароля, EVM-адреса и URL; запуск возвращает успешное состояние.
- Для automation-запросов с `run_id` ручной автологин не выполняется.
- Пароль, EVM-адрес и URL не логируются.

**Информационная вкладка:** в самом конце запуска (после загрузки расширений и
ручного автологина, перед ответом) открывается вкладка с URL
`http://127.0.0.1:<port>/profile-info/<profileId>`, где `<port>` — фактический
порт сервера MultiManager, принявшего start-запрос (`req.socket.localPort`).
Если после стартовых операций (автологин/нормализация вкладок) в браузере
осталась пустая вкладка `about:blank`, страница открывается в ней
(`Target.attachToTarget` + `Page.navigate`); если пустой вкладки нет
(например, при automation/MM-запуске) — создаётся новый target
(`Target.createTarget`). Страница доступна без авторизации только на loopback
(см. раздел «Информация о профиле»). Ошибка открытия вкладки не останавливает
уже успешный запуск: она логируется безопасно (только `profileId` и категория
ошибки), URL вкладки не логируется.

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

Остановить браузер. Graceful shutdown через CDP:

1. `Browser.close` на browser-level WebSocket (таймаут 2 сек) — Chromium сам корректно закрывает вкладки и сбрасывает persistent storage (включая WAL-журналы SQLite).
2. Ожидание завершения процесса до 8 секунд.
3. При таймауте — graceful-сигнал: Unix `SIGTERM`, Windows `taskkill /PID <pid> /T` без `/F`.
4. Если процесс не завершился — force kill: Unix `SIGKILL`, Windows `taskkill /PID <pid> /T /F`.

На Windows после `taskkill` без `/F` всегда выдерживается короткое фиксированное ожидание (2–3 сек): Chromium может игнорировать WM_CLOSE, поэтому далее выполняется force kill. Недоступный CDP или ошибка `Browser.close` не блокируют fallback-завершение процесса. Повторный stop/shutdown для одного профиля игнорируется (`stoppingProfiles`).

**Ответ (200):**
```json
{
  "status": "stopped"
}
```

---

### POST /api/browser/shutdown

Массовая остановка всех запущенных браузеров. Для каждого профиля выполняется graceful shutdown через CDP: `Browser.close` → ожидание завершения процесса → graceful-сигнал (`SIGTERM` / `taskkill /T`) → force kill (`SIGKILL` / `taskkill /T /F`).

**Ответ (200):**
```json
{
  "stopped": 3
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

Автоматическая авторизация в Zerion. Runtime ID расширения определяется через `computeRuntimeId`/`resolveRuntimeId` из `profile.extensions` (приоритет `Secure Preferences` по точному совпадению пути, затем `manifest.key`).

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

## Multi-Control (Синхронизация окон) — v0.17.0

Система синхронизации ввода из master окна во все slave окна через CDP (Chrome DevTools Protocol).

### WebSocket Authentication (v1.4.0)

WebSocket `/ws` требует аутентификации. Подключение с невалидным токеном отклоняется (close code 4401).

**Формат подключения:**
```
ws://127.0.0.1:{PORT}/ws?token={API_TOKEN}
```

**Архитектура:**
- **Захват ввода (DOM)**: CDP binding `Runtime.addBinding('__MM_SYNC_BIND__')` инжектируется в master page через `SYNC_EVENT_SCRIPT`. DOM events (mousemove, mousedown, mouseup, wheel [только диагностика], click) + authoritative `scroll` (абсолютные `window.scrollX/scrollY` из `window.scroll` listener, коалесцирование) + `visibilitychange` → `window.__MM_SYNC_BIND__(JSON)` → `cdpManager.onEvent` → `inputCapture.injectFromCdp()` → `controller`
- **Native hooks (OS-level)**: C++ addon `WH_KEYBOARD_LL` перехватывает ВСЕ клавиши на уровне ОС, включая browser shortcuts (Ctrl+T, Ctrl+W). HTTP POST → `/api/multi-control/os-keyboard` → `controller.onKeyDown/onKeyUp`
- **Broadcast**: `controller` → `_getSlaveSession(slaveId)` → CDP `Input.dispatch*` / `Input.dispatchKeyEvent` / `Input.insertText` → slave окна
- **Mouse smoothing**: MouseSmoother (ghost-cursor `path()`: кубическая Безье + Fitts's Law + overshoot) + `setTimeout` dispatch loop + `flush()` перед кликом
- **Scroll**: Authoritative document scroll мастера из события `window.scroll` (абсолютные `scrollX/scrollY`, без накопления дельт). Применяется в slave через CDP `Runtime.callFunctionOn('window.scrollTo(x, y)')` с `executionContextId` сессии (без `Runtime.evaluate` fallback). Wheel — только диагностика и не запускает скролл
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
- Double dispatch устранён (v0.16.0): CDP-клавиатура удалена, клавиши уходят в slave ровно один раз через native hook

**Ограничения:**
- Events привязаны к DOM — не работают на chrome:// и devtools:// страницах (только native hooks для browser chrome)
- Orphaned native tabs: возможны при race condition между `/json` polling и открытием таба в slave
- Polling latency: до 300мс для обнаружения новых табов
- **Platform Limitation:** Native OS keyboard hooks (WH_KEYBOARD_LL) доступны только на Windows. На macOS/Linux используется CDP-only режим — browser chrome shortcuts (Ctrl+T, Ctrl+W) не перехватываются.

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

Получить профили по диапазону номеров. Секретные поля (пароли, auth-токены, proxy credentials) не возвращаются.

**Параметры:** `range` — диапазон номеров в формате `NNN-NNN`

**Ответ (200):** Массив профилей (без секретных полей)
```json
[
  {
    "id": "uuid",
    "number": 1,
    "name": "auto_001",
    "email": "user@example.com",
    "twitter_username": "my_twitter",
    "discord_username": "my_discord",
    "wallet_evm_address": "0x...",
    "wallet_sol_address": "...",
    "proxy": {
      "type": "socks5",
      "host": "proxy.example.com",
      "port": 1080,
      "has_auth": true
    }
  }
]
```

**Ответ (400):** `{ "error": "Неверный формат range: 001-010" }`

---

### GET /api/internal/profiles/:id/zerion-extension

Вернуть runtime ID расширения Zerion для конкретного профиля. Используется клиентом `stAuto0` при инициализации кошелька: URL импорта строится с актуальным ID расширения, а не с устаревшей константой. Runtime ID вычисляется через `resolveRuntimeId()` (приоритет `Default/Secure Preferences` по точному пути, затем `manifest.key`); имя каталога расширения не является runtime ID.

**Параметры:** `:id` — UUID профиля

**Ответ (200):**
```json
{ "id": "abcdefghijklmnopabcdefghijklmnop" }
```

**Ошибки (400):** `{ "error": "Невалидный список расширений в профиле" }`, `{ "error": "Не найдено расширение Zerion в профиле" }`, `{ "error": "Не удалось определить runtime ID расширения Zerion" }`, `{ "error": "Runtime ID расширения Zerion имеет неверный формат" }`

**Ошибка (404):** `{ "error": "Профиль не найден" }`

---

### GET /api/internal/profile-storage

Вернуть фактический каталог, в котором MultiManager хранит стандартные профили. Используется миграционным скриптом `stAuto0` (`migrate_profile_dirs.py`), чтобы копировать данные профилей в правильный каталог. Путь учитывает переменную окружения `MULTIMANAGER_DATA_DIR`.

Требуется заголовок `Authorization: Bearer <token>`.

**Параметры:** нет

**Ответ (200):**
```json
{
  "profiles_dir": "C:\\Users\\stalcker\\AppData\\Roaming\\MultiManager\\profiles"
}
```

Endpoint не принимает параметров, не изменяет состояние и не обращается к БД. Каталог не создаётся и не проверяется на существование.

**Ошибка (401):** неверный или отсутствующий Bearer-токен.

**Ошибка (500):** ошибка конфигурации (например, некорректный `MULTIMANAGER_DATA_DIR`).

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
    "name": "Мой профиль",
    "windowTitle": "Untitled - Chromium",
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080
  }
]
```

Поля окна:

- `id` — HWND окна (идентификатор, используемый операциями `Focus`, `Grid`, `Cascade`);
- `name` — имя профиля из MultiManager при сопоставлении PID окна с запущенным
  профилем (fallback на `id` профиля при пустом имени); при отсутствии
  сопоставления — системный заголовок окна;
- `windowTitle` — исходный системный заголовок окна Windows (диагностический
  fallback);
- `x`, `y`, `width`, `height` — координаты и размер окна.

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

### POST /api/window-arranger/close-all-tabs

Закрыть все вкладки во всех запущенных (`running`) профилях.

Для каждого профиля сначала создаётся новая вкладка `about:blank`, затем
закрываются исходные page-вкладки (кроме только что созданной). Созданная
вкладка не закрывается. Ошибка одного профиля не останавливает обработку
остальных. URL и ссылки не логируются.

**Ответ (200):**
```json
{
  "total": 2,
  "success": 1,
  "failed": 1,
  "profiles": [
    {
      "profileId": "f81d4fae-...",
      "profileName": "Мой профиль",
      "success": true,
      "closed": 5,
      "kept": 1,
      "errors": []
    },
    {
      "profileId": "f81d4fae-...",
      "profileName": "Другой профиль",
      "success": false,
      "closed": 0,
      "kept": 0,
      "errors": [],
      "error": "CDP port is unavailable for profile ..."
    }
  ]
}
```

Поля:

- `total` — количество обработанных running-профилей;
- `success` / `failed` — количество профилей без ошибок / с ошибкой;
- `profiles[]` — результат по каждому профилю:
  - `profileId`, `profileName` — идентификатор и имя профиля;
  - `success` — завершилась ли операция для профиля без ошибок;
  - `closed` — сколько исходных вкладок закрыто;
  - `kept` — сколько вкладок оставлено (созданная `about:blank`);
  - `errors[]` — частичные ошибки закрытия по отдельным targets
    (`targetId` + `error`);
  - `error` — ошибка профиля целиком (например, недоступен CDP-порт).

---

### POST /api/window-arranger/open-links

Открыть переданные ссылки во всех запущенных (`running`) профилях.

**Тело запроса:**
```json
{
  "links": ["https://example.com/page1", "https://example.com/page2"]
}
```

`links` — массив строк. Пустые строки пропускаются, порядок сохраняется. Для
каждой непустой ссылки и каждого running-профиля создаётся отдельная вкладка.
Обработка продолжается после ошибки отдельной ссылки или профиля. URL не
логируются и не попадают в сообщения об ошибках.

**Ошибки (400):** `links` не является массивом строк — `{ "error": "links must be
an array of strings", "code": "BAD_REQUEST" }`.

**Ответ (200):**
```json
{
  "total": 3,
  "created": 5,
  "failed": 1,
  "profiles": [
    {
      "profileId": "f81d4fae-...",
      "profileName": "Мой профиль",
      "success": true,
      "created": 3,
      "failed": 0,
      "errors": []
    },
    {
      "profileId": "f81d4fae-...",
      "profileName": "Другой профиль",
      "success": false,
      "created": 2,
      "failed": 1,
      "errors": [{ "error": "CDP error" }]
    }
  ]
}
```

Поля:

- `total` — количество непустых ссылок;
- `created` — всего создано вкладок;
- `failed` — всего неуспешных операций;
- `profiles[]` — результат по каждому профилю:
  - `profileId`, `profileName`;
  - `success` — все ссылки профиля обработаны без ошибок;
  - `created` / `failed` — успешно / неуспешно по профилю;
  - `errors[]` — ошибки по отдельным ссылкам (без URL);
  - `error` — ошибка профиля целиком (например, недоступен CDP-порт).

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

### POST /api/settings/api-token/regenerate

Перегенерировать постоянный API-токен. Требует Bearer-аутентификации текущим токеном.

Операция атомарно обновляет `system_config.api_token`, меняет активный токен auth middleware, закрывает все активные WebSocket-соединения и уведомляет Electron main process (при запуске под ним).

**Ответ (200):**
```json
{
  "token": "<новый токен>"
}
```

После ротации новый токен действует немедленно; старый токен отклоняется всеми REST-эндпоинтами и WebSocket.

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

Обновить настройки автоматизации (пути, parallelLimit). Проекты **не синхронизируются** — для синхронизации используйте `POST /api/projects/sync`. Если пути не указаны, используются дефолтные значения (`~/AI/stAuto0` и `~/AI/stAuto0/venv/Scripts/python.exe`).

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
  "syncResult": { "added": 0, "removed": 0, "total": 0 }
}
```

---

### GET /api/settings/cloakbrowser-version

Получить текущую версию CloakBrowser. Приоритет: (1) ручная настройка, (2) авто-определение из кэша, (3) дефолт.

**Ответ (200):**
```json
{
  "manual": "",
  "detected": "146.0.7680.177",
  "current": "146.0.7680.177",
  "default": "146.0.7680.177"
}
```

### PUT /api/settings/cloakbrowser-version

Установить версию CloakBrowser вручную. Передайте `{"version": ""}` чтобы сбросить на авто-определение.

**Тело запроса:**
```json
{
  "version": "146.0.7680.177"
}
```

**Ответ (200):**
```json
{
  "status": "success",
  "version": "146.0.7680.177"
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

### DELETE /api/projects/:name

Удалить проект из БД.

**Ответ (204):** Успешное удаление
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

Отменить выполнение run. Для каждого профиля с уже запущенным Python-процессом сначала инициируется остановка браузера через MultiManager lifecycle (`POST /api/browser/:id/stop` — CDP graceful shutdown), затем Python-процесс принудительно завершается. Повторная остановка одного профиля (одновременный cancel и штатный `close` из stAuto0) не создаёт второй shutdown-flow — защита `stoppingProfiles`. Помечает все running/pending задачи как `failed`, устанавливает статус run = `cancelled`.

**Ответ (200):**
```json
{
  "status": "cancelled",
  "run_id": "uuid"
}
```

**Ответ (404):** `{ "error": "Run not found" }`

---

### POST /api/runs/:id/retry

Создать новый `pending` run из невыполненных задач исходного run. Копируются только задачи со статусом `!= 'success'` (pending, running, failed). Новый run готов к запуску, не наследуя результаты выполнения. Доступен для любого статуса исходного run.

**Тело запроса:**
```json
{
  "name": "Новое имя",
  "parallel_limit": 1
}
```

- `name` — опционально, до 200 символов; пустая строка после `trim()` заменяется на авто-имя `Run YYYY-MM-DD HH:mm` по времени сервера.
- `parallel_limit` — опционально, `1..50`; по умолчанию `1` если не передан.

Все новые `run_tasks` получают `status='pending'` и пустые `exit_code`, `log_file_path`, `attempts`, `error_message`, `started_at`, `completed_at`. Создание run и копирование задач выполняется атомарно в транзакции.

**Ответ (201):**
```json
{
  "run_id": "uuid",
  "tasks_created": 5,
  "name": "Run 2026-08-22 12:00",
  "parallel_limit": 1
}
```

**Ответ (400):** `{ "error": "No tasks to retry: all tasks succeeded or source run has no tasks" }` — у исходного run нет задач с `status != 'success'`
**Ответ (404):** `{ "error": "Run not found" }`
**Ответ (500):** `{ "error": "Internal server error" }` — ошибка БД, частично созданных данных не остаётся

---

### POST /api/runs/:id/duplicate

Создать полный дубликат run. Копируются все задачи исходного run независимо от статуса. Новый `pending` run готов к запуску.

**Тело запроса:**
```json
{
  "name": "Новое имя",
  "parallel_limit": 1
}
```

Параметры и атомарность аналогичны `retry`.

**Ответ (201):**
```json
{
  "run_id": "uuid",
  "tasks_created": 10,
  "name": "Run 2026-08-22 12:00",
  "parallel_limit": 1
}
```

**Ответ (400):** `{ "error": "Source run has no tasks to duplicate" }` — у исходного run нет задач
**Ответ (404):** `{ "error": "Run not found" }`
**Ответ (500):** `{ "error": "Internal server error" }`

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
| 4401 | WebSocket: невалидный токен (закрытие соединения) |
| 500 | Внутренняя ошибка сервера |
| 502 | Ошибка прокси/ротации / CDP порт не найден |
| 503 | Токен авторизации не инициализирован |
