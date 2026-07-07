# TASK: Endpoints интеграции со stAuto0 (Ф4 light)

> **Статус:** ✅ Выполнено
> **Фаза:** MultiManager Ф4 (light — без crypto-зависимости)
> **Основание:** TS.md §4.12, §4.5, §7

---

## Контекст

Для интеграции с Python-фреймворком stAuto0 Core-движку не хватает трёх endpoint'ов. Они не требуют криптомодуля (Ф2), поэтому могут быть реализованы независимо.

**Проблема:** TS.md §7 фиксирует, что `ws_endpoint` в ответе `POST /api/browser/:id/start` — нерабочая заглушка `ws://127.0.0.1:3000/devtools/browser/${id}`. Реальный CDP-порт уже ловится в `cdpPorts` Map (`src/api/browser.js:344`), но не возвращается.

---

## Задачи

### 1. Исправить `ws_endpoint` в ответе старта браузера

**Файл:** `src/api/browser.js`

**Что делаем:**
- Найти место формирования ответа в `POST /api/browser/:id/start` (строится объект `{ status, profile_id, pid, ws_endpoint }`).
- После `waitForCdpPort(id)` — прочитать порт из `cdpPorts.get(id)`.
- Заменить `ws_endpoint` с фейкового URL на `http://127.0.0.1:{cdp_port}`.
- Добавить поле `cdp_port` в объект ответа.

**Ожидаемый ответ:**
```json
{
  "status": "success",
  "profile_id": "8f3b201a-...",
  "pid": 14208,
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
}
```

**Проверка:** Запустить профиль — в ответе реальный `cdp_port`, а не заглушка.

---

### 2. `POST /api/browser/:id/type` — Human-like Typing endpoint

**Файлы:** `src/api/browser.js`, `src/core/app.js`

**Что делаем:**
- Добавить в роутер browser.js новый endpoint:
  - `POST /api/browser/:id/type`
  - Тело: `{ text: string }`
- Валидация:
  - text обязателен, непустой — иначе 400.
  - Профиль должен быть `running` — иначе 409 Conflict.
- Получение CDP:
  - Достать `cdpPorts.get(id)` — если нет, 502 Bad Gateway.
  - Подключиться через `new WebSocket(wsEndpoint)` из библиотеки `ws` (уже в зависимостях).
  - Отправить `{"id":1,"method":"Runtime.evaluate","params":{"expression":"..."}}` для ввода текста, либо использовать CDP-библиотеку если она есть.
  - **Вариант A:** Если в проекте уже есть CDP-клиент (проверить import'ы в `src/multi-control/`) — использовать его.
  - **Вариант B:** Если нет — импортировать `humanType` из `src/typing/index.js` и вызывать через прямое WebSocket-соединение.

**Подробные шаги:**
1. Определить, как в проекте подключаются к CDP (посмотреть `src/multi-control/cdp-manager.js`).
2. Создать функцию `getCdpConnection(profileId)` или использовать существующую.
3. В endpoint'е вызвать `humanType(cdpSession, text)`.
4. Вернуть `{ status: "success" }`.

**Проверка:** curl с текстом к запущенному профилю — символы печатаются в активной вкладке.

---

### 3. `POST /api/profiles/batch` — массовый импорт профилей

**Файл:** `src/api/profiles.js`

**Что делаем:**
- Добавить endpoint:
  - `POST /api/profiles/batch`
  - Тело: `{ accounts: [{ name, platform, ...fields }] }`
- Валидация:
  - `accounts` — массив, непустой — иначе 400.
  - Каждый элемент должен иметь `name` и `platform` — иначе 400 с указанием индекса.
- Логика:
  - Открыть транзакцию `db.transaction()`.
  - Для каждого аккаунта:
    - Сгенерировать fingerprint через `generateFingerprint(platform)`.
    - Вызвать `queries.create({ ...acct, fingerprint_seed, user_agent, ... })`.
  - Если любой `create()` бросил исключение — транзакция откатывается (автоматика better-sqlite3).
- Ответ: `201` + массив созданных профилей.

**Проверка:** Отправить 3 аккаунта — приходят 3 профиля в ответе. Повторный запрос — создаются ещё 3 с новыми номерами.

---

## Порядок реализации

1. **Исправление `ws_endpoint`** — 1 поле в ответе, минимальное изменение.
2. **`POST /api/browser/:id/type`** — новый endpoint с CDP-подключением.
3. **`POST /api/profiles/batch`** — массовый импорт, новая логика.

---

## Файловый清单

| Файл | Действие |
|------|----------|
| `src/api/browser.js` | Изменить (ws_endpoint + добавить `/type`) |
| `src/api/profiles.js` | Добавить (`/batch`) |
| `src/core/app.js` | Проверить монтирование роутов |

---

## Не делаем в рамках этой задачи

- ❌ Crypto-модуль AES-256-GCM (Ф2)
- ❌ `/api/internal/profiles` endpoint (Ф4 — зависит от crypto)
- ❌ `/api/browser/:id/zerion-login` (Ф4 — зависит от crypto)
- ❌ `/api/tasks` CRUD + `/:id/run` (Ф4)
- ❌ Экран Tasks Manager (Ф5)
- ❌ Hot Backup + Rolling (Ф3)
- ❌ Встроенный терминал (Ф6)
- ❌ Settings: crypto + automation (Ф5)
