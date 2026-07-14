-------------------------------
## ТЕХНИЧЕСКОЕ ЗАДАНИЕ: ИНТЕГРАЦИЯ stAuto0 С MultiManager
## Спутник-документ к [TS.md](./TS.md) (MultiManager v1.1.0)
**Версия:** 1.2.0 | **Дата ревизии:** 2026-07-10

> **Принцип маркировки:** ✅ уже есть в коде stAuto0 | ❌ к реализации/изменению | ⚠️ будет удалено/переписано.
> **Расположение stAuto0:** `C:\Users\stalcker\AI\stAuto0` (отдельный проект, отдельный git).
> **Статус аудита (2026-07-10):** миграция stAuto0 — **~100%** (ФГ ✅, ФА ✅, ФБ ✅, ФВ ✅, ФД ✅). MultiManager **Ф1–Ф6 ✅ готовы** к стыковке. Открытые вопросы Q1–Q5 — **РЕШЕНЫ** (см. §11). Детальный аудит реализации — см. **§12**.
-------------------------------

## 1. Контекст stAuto0 (что есть сейчас — аудит 2026-07-07)

stAuto0 — Playwright-based фреймворк Web3-автоматизации (дроп-охота, квесты, мультиаккаунтинг). Это «жирный инстанс» под миграцию.

**Текущая архитектура (всё ✅, но подлежит рефакторингу):**

| Компонент | Файл | Описание |
|-----------|------|----------|
| **Точка входа** | `main.py` | CLI: `--headless`, `--project=concrete,paragraph`, `--log-name=`, диапазоны `001-010` или `auto_001`. Разворачивает диапазоны через `expand_account_args()`. |
| **BaseBrowser** | `Core/browser.py` | cloakbrowser (`launch_persistent_context_async`) + Playwright. Методы: `launch()`, `connect()`, `login_zerion()`, `run_project()`, `click_confirm()`, `_wallet_confirm()`, `_kill_chrome_for_profile()`, `_get_or_create_fingerprint_seed()`, `_parse_proxy()`, `_find_zerion_in_profile()`, `close()`. |
| **ProxyChecker** | `Core/proxy.py` | aiohttp, тест через `api.ipify.org`. **Остаётся для legacy-fallback** (решение Q1, §3.2). |
| **Аккаунты** | `config/accounts.py` | Статический tuple из 10 аккаунтов (статус, name, wallet_password, email, solana, evm, profile_directory, debugging_port, proxy, timezone). **Остаётся для legacy-fallback** (решение Q1); в MM-режиме заменяется на API-чтение. |
| **Сиды** | `config/auto_sids.py` | Временный файл мнемоник (BIP39 24 слова). Создаётся `create_wallets.py`, уничтожается вручную после инициализации. |
| **Проекты** | `projects/*.py` (15 шт.) | `BaseProject` subclasses: concrete, concrete_paragraph, allscale, cambrian, litvm, neuraverse, pumpcade, rabbithole, rax_finance, test, umbraprivacy, upshot, xstocks. Интерфейс: `_get_start_url()`, `_get_max_attempts()`, `_use_new_tab()`, `_check_success()`, `_login()`, `_process()`. |
| **Wallet Factory** | `scripts/create_wallets.py`, `scripts/init_wallet4browser.py`, `scripts/fill_emails.py` | Генерация BIP39, деривация EVM/Solana, онбординг Zerion (24 слова). **Переписана** ✅ — использует MultiManager API (`POST /api/profiles/batch`, `PUT /api/profiles/:id`). |
| **MCP сервер** | `mcp_server/server.py` | FastMCP, 14 tools: `browser_launch`, `browser_close`, `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_get_content`, `browser_wait_for`, `browser_login_zerion`, `browser_list_sessions`, `browser_get_account_info`, `recorder_start`, `recorder_stop`, `generate_project_class`, `browser_vision_analyze`. MM-детект, кеш профилей, fallback на `config/accounts.py`. |
| **Миграционные скрипты** | `scripts/migrate_to_sqlite.py`, `scripts/migrate_profile_dirs.py` | **СОЗДАНЫ** ✅. Переносят 10 аккаунтов, прокси, профили. Smoke-тесты пройдены. |
| **Зависимости** | `requirements.txt` | mnemonic, eth-account, base58, pynacl, aiohttp, playwright, requests, websocket-client, cloakbrowser, google-auth-oauthlib, google-api-python-client, pytest, pytest-asyncio, mcp. |

> **🛑 Аудит 2026-07-10 (пост-ФД):** `Core/multimanager.py` **СОЗДАН** ✅. `main.py` и `Core/browser.py` **ИЗМЕНЕНЫ** ✅ — содержат авто-детект Core и MM-режим. `scripts/migrate_to_sqlite.py`, `scripts/migrate_profile_dirs.py` **СОЗДАНЫ** ✅ — smoke-тесты пройдены (10 аккаунтов, --force, directory copy, MM GUI). `scripts/create_wallets.py`, `scripts/init_wallet4browser.py`, `scripts/fill_emails.py` **ПЕРЕПИСАНЫ** ✅ — используют MultiManager API вместо `config/accounts.py`. `mcp_server/server.py` **ПЕРЕПИСАН** ✅ — MM-детект, резолв, Recorder, Vision. `mcp_server/client.py` **ИЗМЕНЕН** ✅ — MM-поддержка. `mcp_server/recorder.py`, `mcp_server/vision.py` **СОЗДАНЫ** ✅. Тесты: 131/131 pass.

**Zerion ID:** `klghhnkeealcohjjanjjdaeeggmfmlpl`. URL онбординга: `chrome-extension://{ZERION_ID}/popup.8e8f209b.html?windowType=tab&appMode=onboarding#/onboarding/import/mnemonic`.

-------------------------------
## 2. Целевая архитектура

### 2.1. Принцип разделения ответственности
- **MultiManager (Node.js)** полностью инкапсулирует: сеть (прокси, ротация, checker), запуск браузера (CloakBrowser + fingerprint + расширения), авто-логин Zerion, шифрование секретов, планировщик, БД.
- **stAuto0 (Python)** = чистая Web3-автоматизация: квесты, клики, заполнение форм, обработка попапов кошелька.

### 2.2. Топология (решения #7, #9, #10)
- **stAuto0 — отдельный проект** в своей папке, со своим git и зависимостями.
- **SQLite MultiManager = единственный источник правды.** stAuto0 **не хранит** данные аккаунтов постоянно (нет `config/accounts.py` после миграции).
- **Данные аккаунтов — через API-чтение:** `GET /api/internal/profiles?range=001-010` отдаёт массив dict.
- **Данные проектов:** код проектов в `projects/*.py`, мета (script_name, params JSON) синхронизируется в таблицу `projects` MultiManager через `POST /api/projects/sync`.

### 2.3. Маппинг полей аккаунта (Python ↔ MultiManager)

| Поле stAuto0 (`account` dict) | Поле MultiManager (SQLite) | Примечание |
|-------------------------------|----------------------------|-----------|
| `name` (auto_001) | `name` + `number` (1) | `name` сохраняется как `auto_{number:03d}` |
| `email` | `email` | |
| `wallet_password` | `wallet_password` (AES, дешифр.) | default 'asdfj*KK' |
| `evm` | `wallet_evm_address` | |
| `solana` | `wallet_sol_address` | |
| `proxy` (host:port:user:pass) | вычисляется из `proxies` JOIN | `/api/internal` отдаёт готовую строку |
| `timezone` | `timezone` | default 'Asia/Bishkek' |
| `debugging_port` | динамический из MultiManager | **больше НЕ статический** (см. §6) |
| `profile_directory` | вычисляется из `id` (UUID) | `CloakManager/profiles/{UUID}/BrowserData` |
| `id` (auto_001) | `id` (UUIDv4) | новый формат после миграции |

**Новые поля (Twitter/Discord):** `twitter_username`, `twitter_password` (дешифр.), `twitter_auth_token` (дешифр.), `twitter_email`, аналогично `discord_*`. Отдаются в `/api/internal/profiles` в cleartext (для Python).

### 2.4. Стек вызова после миграции
```
python main.py --project=concrete --range=001-010 --log-name=task_xyz
  │
  ├─ GET /api/internal/profiles?range=001-010  (MultiManager Core)
  │     └─ возвращает массив account dict (с расшифрованными секретами)
  │
  └─ for each account:
       ├─ POST /api/browser/{profile_id}/start  (MultiManager)
       │     └─ {ws_endpoint: "http://127.0.0.1:{cdpPort}", pid}
       │
       ├─ BaseBrowser.connect_over_cdp(ws_endpoint)   (Python/Playwright)
       │
       └─ browser.run_project(ConcreteProject)   (чистая автоматизация)
             └─ _process() — квест, клики, формы
```

-------------------------------
## 3. Рефакторинг `main.py` и авто-детект Core (решение #11)

### 3.1. Авто-детект Core ✅
`main.py` должен сохранять CLI для **ручного запуска без MultiManager** (требование пользователя + решение Q1 — legacy-fallback остаётся). Реализация вынесена в модуль `Core/multimanager.py` (см. §3.4), в `main.py` — только делегирование:

```python
from Core.multimanager import MultiManagerClient

mm = MultiManagerClient()  # порт из env MM_PORT (default 3000), токен из env MM_TOKEN

if await mm.is_core_alive():
    # MM-режим
    accounts = await mm.get_profiles("001-010")
else:
    # legacy-fallback (решение Q1)
    from config.accounts import accounts
```

**Переменные окружения (новое):**
- `MM_PORT` — порт Core (default `3000`).
- `MM_TOKEN` — Bearer-токен для авторизации API (если не задан и Core жив → ошибка, т.к. `/api/*` требуют авторизации).

**CLI-аргументы `main.py`:**
- `--port=N` — порт Core (приоритет над `MM_PORT`).
- `--token=SECRET` — Bearer-токен (приоритет над `MM_TOKEN`).
- `--range=001-010` — диапазон аккаунтов для MM-режима (маппинг на существующий позиционный формат `001-010`).

**Поведение по режимам:**
- **Core жив → режим MultiManager:** аккаунты из `/api/internal/profiles?range=`, браузер через `POST /api/browser/:id/start`, прокси-чеккер пропускается (всё делает Node.js).
- **Core мёртв → fallback на legacy:** аккаунты из `config/accounts.py`, браузер через `launch_persistent_context_async` напрямую, прокси через `Core/proxy.py` (aiohttp). Для ручного запуска/дебага.

### 3.2. ProxyChecker — остаётся в legacy-fallback (решение Q1) ✅
В режиме MultiManager `check_account_proxy()` (`main.py:30`) **не вызывается** — прокси-валидация происходит в Node.js перед стартом (`src/api/browser.js:263`).

**Решение (Q1, 2026-07-09):** `Core/proxy.py` **НЕ удаляется** — остаётся для legacy-fallback режима. Удалять не нужно, это обеспечивает безопасность миграции и ручной запуск без MultiManager. Вызов `check_account_proxy()` остаётся только в legacy-ветке `run_account()`.

### 3.3. `kill_chrome_processes()` — остаётся в legacy-fallback (решение Q1) ✅
`main.py:49` использует `taskkill` для зависших Chrome.

**Решение (Q1, 2026-07-09):** функция **НЕ удаляется** — остаётся в legacy-ветке `finally`/`KeyboardInterrupt`. В MM-режиме не вызывается: graceful shutdown делается через `POST /api/browser/:id/stop` (Node.js делает SIGTERM→SIGKILL через tree-kill).

### 3.4. Модуль `Core/multimanager.py` (НОВЫЙ, фаза ФА) ✅

Инкапсулирует **все** HTTP-вызовы к MultiManager Core. Переиспользуется фазами ФА/ФБ/ФВ/ФД. Без этого модуля `main.py` и `Core/browser.py` дублировали бы HTTP-логику.

```python
class MultiManagerClient:
    def __init__(self, port=None, token=None):
        self.base_url = f"http://127.0.0.1:{port or os.environ.get('MM_PORT', '3000')}"
        self.token = token or os.environ.get('MM_TOKEN')
        self._headers = {"Authorization": f"Bearer {self.token}"} if self.token else {}

    # --- Health / detection ---
    async def is_core_alive() -> bool          # GET /health, timeout 2 сек

    # --- Accounts (стоковка с MultiManager Ф4) ---
    async def get_profiles(range_str) -> list  # GET /api/internal/profiles?range=
    async def create_profiles_batch(accounts)  # POST /api/profiles/batch (возвращает [{id, name, ...}])
    async def update_profile(id, data)         # PUT /api/profiles/{id}
    async def get_all_profiles() -> list       # GET /api/profiles (для миграционных скриптов)

    # --- Browser lifecycle (стоковка с MultiManager Ф4) ---
    async def start_browser(profile_id) -> dict  # POST /api/browser/{id}/start → {ws_endpoint, pid, cdp_port}
    async def stop_browser(profile_id)           # POST /api/browser/{id}/stop
    async def zerion_login(profile_id)           # POST /api/browser/{id}/zerion-login

    # --- Proxies (для миграционных скриптов ФГ) ---
    async def create_proxy(data) -> dict         # POST /api/proxies → {id, ...}
```

**Adapter `normalize_account(raw)`** — преобразует ответ `/api/internal/profiles` в legacy-совместимый dict, ожидаемый `BaseBrowser`:

| Поле из `/api/internal/profiles` | Поле legacy-account | Примечание |
|----------------------------------|---------------------|------------|
| `id` (UUID) | `profile_id` (новое) | для API-вызовов MM |
| `id` (UUID) | `id` | сохраняем UUID как идентификатор |
| `name` (`auto_001`) | `name` | без изменений |
| `proxy.connection_string` | `proxy` (строка) | `http://user:pass@host:port` |
| `wallet_evm_address` | `evm` | обратный маппинг |
| `wallet_sol_address` | `solana` | обратный маппинг |
| `wallet_password` | `wallet_password` | уже расшифрован в MM |
| `email` | `email` | без изменений |
| `timezone` | `timezone` | без изменений |
| — | `debugging_port` | **ОТСУТСТВУЕТ** (динамический, приходит в `start_browser()`) |
| — | `profile_directory` | **ОТСУТСТВУЕТ** (браузер запускается Node.js, путь не нужен Python) |

> **Ключевой инвариант адаптера:** legacy-код (`run_project`, `click_confirm`, `_wallet_confirm`) работает с `account` dict и **не знает** о существовании MultiManager. Adapter обеспечивает совместимость без правок проектов.

-------------------------------
## 4. Рефакторинг `Core/browser.py` (BaseBrowser)

### 4.1. Метод `launch()` — разветвление по режиму ✅ (ФА — заглушка)

**Текущая реализация** (`Core/browser.py:191`): `_kill_chrome_for_profile()` → формирование chrome_args (fingerprint, --remote-debugging-port, --load-extension, proxy) → `launch_persistent_context_async`.

**Флаг режима** определяется в `__init__`:
```python
def __init__(self, account: dict, headless: bool = False):
    # ... существующая инициализация ...
    # MM-режим: account dict содержит 'profile_id' (UUID) — пришёл из normalize_account()
    # legacy-режим: account dict содержит 'profile_directory' — из config/accounts.py
    self.mm_mode = "profile_id" in account
    self.profile_id = account.get("profile_id")  # UUID для MM-режима
    self.ws_endpoint = None  # от MM API
    self.mm_pid = None
```

**Новая реализация `launch()`:**
```python
async def launch(self, extensions=None):
    if self.mm_mode:
        await self._launch_via_multimanager()
    else:
        await self._launch_legacy(extensions)  # текущий код, переименованный

async def _launch_via_multimanager(self, extensions=None):
    mm = MultiManagerClient()
    data = await mm.start_browser(self.profile_id)
    self.ws_endpoint = data["ws_endpoint"]   # "http://127.0.0.1:{cdpPort}"
    self.mm_pid = data["pid"]
    await self.connect_via_endpoint(self.ws_endpoint)
```

**Новый метод `connect_via_endpoint(ws_endpoint)`** — подключение к уже запущенному браузеру через ws_endpoint от MultiManager (вместо статического `debugging_port`):
```python
async def connect_via_endpoint(self, ws_endpoint):
    from playwright.async_api import async_playwright
    self._pw = await async_playwright().start()
    cdp_browser = await self._pw.chromium.connect_over_cdp(ws_endpoint)
    # ... получение context/page (тот же код, что в существующем connect()) ...
    self._cdp_browser = cdp_browser
    self._connected = True
```
Существующий `connect()` (по `debugging_port`) остаётся для legacy-fallback.

### 4.2. Сохранить в legacy-fallback (решение Q1, 2026-07-09) ✅

**⚠️ ВАЖНОЕ ИЗМЕНЕНИЕ vs предыдущей редакции ТЗ:** ранее эти методы помечались «Удалить». По решению Q1 (legacy-fallback остаётся) **НИ ОДИН метод не удаляется** — все остаются в `_launch_legacy()` ветке.

| Метод | Где остаётся | В MM-режиме |
|-------|-------------|-------------|
| `_kill_chrome_for_profile()` | `_launch_legacy()` | не вызывается (Node.js Anti-Zombie через tree-kill) |
| `_get_or_create_fingerprint_seed()` | `_launch_legacy()` | не вызывается (MM генерирует seed в SQLite) |
| `_parse_proxy()` | `_launch_legacy()` | не вызывается (прокси парсится в `src/proxy/index.js`) |
| `_find_zerion_in_profile()` | `_launch_legacy()` | не вызывается (Zerion грузится через `--load-extension` MM) |
| `login_zerion()` | переименовать в `_login_zerion_legacy()` | делегирует в `POST /api/browser/:id/zerion-login` через `MultiManagerClient` |

**Разветвление `login_zerion()`:**
```python
async def login_zerion(self, password=None):
    if self.mm_mode:
        mm = MultiManagerClient()
        await mm.zerion_login(self.profile_id)  # Node.js делает логин
    else:
        await self._login_zerion_legacy(password)  # текущий код
```

**Разветвление `close()`:**
```python
async def close(self):
    if self.mm_mode:
        mm = MultiManagerClient()
        await mm.stop_browser(self.profile_id)  # graceful shutdown через API
        try: await self._pw.stop()
        except: pass
    else:
        # текущий legacy код (context.close() + _kill_chrome_for_profile)
```

### 4.3. Сохранить ✅
| Метод | Зачем |
|-------|-------|
| `connect()` | CDP-подключение к ws_endpoint от MultiManager |
| `run_project(project_class)` | Динамический запуск квеста |
| `click_confirm(button, timeout)` | Обработка попапа кошелька (рекурсивный `_wallet_confirm`) |
| `_wallet_confirm(page, depth)` | Внутренняя логика confirm-цепочки |
| `close()` | В режиме MultiManager — `POST /api/browser/:id/stop`; в legacy — `context.close()` |

-------------------------------
## 5. Wallet Factory на SQLite ✅

### 5.1. `scripts/create_wallets.py` — переписано ✅

**Текущее:** читает/пишет `config/accounts.py` (`get_existing_accounts`, `get_start_index`), генерирует BIP39 (24 слова), деривирует EVM (`m/44'/60'/0'/0/0`) и Solana (`m/44'/501'/0'/0'` через SLIP-0010 Ed25519), пишет всё в `accounts.py` + сиды в `auto_sids.py`.

**Новое:**
- `get_start_index()`: вместо exec `accounts.py` → `GET /api/profiles` → `max(number) + 1`.
- Генерация остаётся (BIP39, EVM, Solana) — ✅ без изменений.
- Запись через `POST /api/profiles/batch` (`src/api/profiles.js` новый endpoint, Roadmap Ф4 MultiManager): только публичные данные (`wallet_evm_address`, `wallet_sol_address`, `wallet_password` default 'asdfj*KK').
- **Сиды ТОЛЬКО во временный `config/auto_sids.py`** — никогда в БД. Параноидальный инвариант. Расположение файла: `stAuto0/config/auto_sids.py` (решение Q4, без изменений).
- Авто-распределение почт: читать `config/free_email.txt`, по одной почте на аккаунт через `PUT /api/profiles/:id {email}`. По завершении `free_email.txt` перезаписывается без использованных строк (логика `scripts/fill_emails.py`).

### 5.2. `scripts/init_wallet4browser.py` — переписано ✅

**Текущее:** читает `config/auto_sids.py`, поочерёдно `BaseBrowser.launch()`, навигация на `chrome-extension://.../onboarding`, ввод 24 слов, установка пароля. Идемпотентность: если `Session expired` → skip.

**Новое:**
- Чтение `auto_sids.py` — без изменений.
- `BaseBrowser.launch()` теперь дёргает MultiManager `POST /api/browser/:id/start`.
- Онбординг через CDP (Playwright поверх ws_endpoint) — без изменений.
- `keep_open=true` для ручной инспекции одного аккаунта — без изменений.

### 5.3. Уничтожение следов (без изменений ✅)
После инициализации всей партии пользователь **вручную** удаляет `config/auto_sids.py`. В системе остаются чистые рабочие сессии Chromium без мнемоник на диске. **Этот шаг НЕ автоматизируется** — сознательное действие человека.

### 5.4. Backup сидов — БЕЗ автоматизации (решение Q5, 2026-07-09) ✅

**Контекст риска:** если `config/auto_sids.py` потерян ДО инициализации кошельков в браузере (Zerion), а сиды ещё не импортированы — средства **невосстановимы** (BIP39 без мнемоники = потеря навсегда).

**Решение (Q5, 2026-07-09):** backup-стратегия для временного файла **НЕ автоматизируется**. Пользователь сам отвечает за сохранность `config/auto_sids.py`:
- Ручной экспорт/копирование мнемоник в офлайн-хранилище (paper backup, hardware wallet) перед уничтожением.
- MultiManager **не прикасается** к сидам (параноидальный инвариант, см. TS.md §3.2).

> Это сознательный выбор: автоматизация backup'а сидов создала бы точку компрометации (где сиды в открытом или зашифрованном виде хранятся дольше необходимого). Ответственность остаётся на операторе фермы.

-------------------------------
## 6. CDP-порты и ws_endpoint (решение #12)

**Текущее стАвто0:** статические `debugging_port` (9330, 9331, ...) в `accounts.py`. Запуск `cloakbrowser` с `--remote-debugging-port=N`.

**Текущее MultiManager:** `--remote-debugging-port=0` (ОС выделяет порт динамически), реальный порт ловится из stderr `DevTools listening on ws://127.0.0.1:{port}` в `cdpPorts` Map (`src/api/browser.js:344`).

**Канон v1.1.0:**
- stAuto0 **не управляет** debugging-портами. Это делает MultiManager.
- `POST /api/browser/:id/start` возвращает `{ws_endpoint: "http://127.0.0.1:{cdpPort}", pid}` (MultiManager Ф4 исправляет заглушку).
- Python: `await playwright.chromium.connect_over_cdp(ws_endpoint)` (метод `connect()` уже это делает, `Core/browser.py:62`).

-------------------------------
## 7. Миграция существующего инстанса (новые скрипты ✅)

Для переезда «жирного» инстанса с старыми куками/сессиями GUI не пишется — задача решается двумя изолированными консольными скриптами. **Скрипты удаляются после миграции.**

### 7.1. `scripts/migrate_to_sqlite.py` ✅
- Читает старый `config/accounts.py` (через exec, как `create_wallets.py:get_existing_accounts`).
- **CLI-аргументы:** `--token=SECRET` (обязательный), `--port=3000` (default 3000), `--host=127.0.0.1`, `--force` (принудительное пересоздание существующих).
- **Идемпотентность:** перед batch — `GET /api/profiles`, фильтр существующих `auto_XXX` по имени. Без `--force` — skip существующих (лог warning); с `--force` — `DELETE` + пересоздание.
- **Парсинг прокси:** строка `host:port:user:pass` → `POST /api/proxies {type:'http', host, port, username, password}` → получаем `proxy_id`. Кеш прокси по строке (чтобы не дублировать одинаковые).
- **Batch-запрос:** `POST /api/profiles/batch` с массивом:
  ```json
  {
    "accounts": [
      {
        "name": "auto_001",
        "platform": "windows",
        "proxy_id": "<UUID прокси>",
        "timezone": "Europe/Berlin",
        "email": "botany-icky-rocket@duck.com",
        "wallet_evm_address": "0x48c95...",
        "wallet_sol_address": "BPxz4Pq8...",
        "wallet_password": "anal2006"
      }
    ]
  }
  ```
  > **Fingerprint** генерируется автоматически в batch endpoint (TS.md §4.1). Старые seeds из `config/fingerprints/auto_XXX_fp.json` НЕ переносятся — MultiManager создаёт новые.
- **Mapping.json:** выгружает временную карту соответствия `config/mapping.json`: `{"auto_001": "8f3b201a-...", "auto_002": "...", ...}`. Сохраняется для второго скрипта (§7.2).
- Логирование прогресса по каждому аккаунту, обработка ошибок HTTP (4xx/5xx).

> **⚠️ Прокси-тип:** в `config/accounts.py` прокси хранятся без указания типа (`ip:port:user:pass`). Миграция создаёт их с `type:'http'`. Если какие-то SOCKS5 — после миграции через GUI Proxy Manager поменять тип (или расширить скрипт авто-детектом, но это вне базового ТЗ).

### 7.2. `scripts/migrate_profile_dirs.py` ✅
- Читает `config/mapping.json` (вывод скрипта §7.1).
- **Определение целевой директории:** `%APPDATA%/CloakManager/profiles/{UUID}/BrowserData/` (через `os.environ['APPDATA']` на Windows; для Linux/macOS — `~/.config/CloakManager/` / `~/Library/Application Support/CloakManager/`, см. TS.md §3).
- **Копирование:** `shutil.copytree(src, dst, dirs_exist_ok=True)` (Python 3.8+):
  - **Откуда:** `config/chrome_accounts/auto_001/`
  - **Куда:** `%APPDATA%/CloakManager/profiles/{UUID}/BrowserData/`
- Полностью сохраняет куки и авторизации кошельков (копирование на уровне файлов сессии Chromium).
- **Безопасность:** проверка существования источника (warning + skip если нет); проверка что назначение пустое или флаг `--overwrite`.
- Логирует успех/неудачу по каждому аккаунту (не прерывается при ошибке одного). Итоговая сводка: N успешно, M с ошибками.

### 7.3. Запуск миграции
```bash
# 1. Убедиться, что MultiManager Core запущен (GUI открыто или daemon)
# 2. Выполнить:
python scripts/migrate_to_sqlite.py   --token=SECRET --port=3000
python scripts/migrate_profile_dirs.py
# 3. Проверить профили в GUI MultiManager
# 4. Удалить scripts/migrate_*.py
```

-------------------------------
## 8. MCP-сервер — переключение на MultiManager API

### 8.1. `mcp_server/server.py` — переписать ✅

**Текущее:** читает `config/accounts.py`, `browser_launch` делает `BaseBrowser.launch()`, удерживает `_browsers` dict.

**Новое:**
- `browser_launch(account_name)` → сначала резолвит `account_name` (auto_001) в `profile_id` (UUID) через `GET /api/internal/profiles`, затем `POST /api/browser/{profile_id}/start`. Возвращает ws_endpoint.
- Удержание CDP-сессии через `connect_over_cdp` в `_browsers[profile_id]`.
- `browser_login_zerion` → делегирует в `POST /api/browser/{profile_id}/zerion-login` (Node.js).
- Остальные tools (navigate/click/fill/screenshot/get_content/wait_for) — без изменений, работают поверх удерживаемой CDP-сессии.

### 8.2. Recorder-режим (новый ✅, Roadmap ФД)
- FastMCP-сервер перехватывает CDP-события кликов и ввода пользователя (через `Input.dispatchKeyEvent`/`Input.dispatchMouseEvent` listener или DOM-инспекцию).
- ИИ-модель (PicoAgent / GPT-4o / Claude 3.5) агрегирует события.
- Компилирует в готовый Python-класс проекта, наследуемый от `BaseProject` (`projects/base.py`).
- Автосохранение в `projects/generated_{name}.py`.
- New tool: `generate_project_class(session_id, project_name)` → возвращает код класса.

### 8.3. Мультимодальный анализ (новый ✅, Roadmap ФД)
- `Page.captureScreenshot` через CDP → отправка в мультимодальную модель.
- Используется для прохождения капч и сложных интерфейсов.
- Компонуется с DOM-анализом (`browser_get_content` + LLM-резолв селекторов).

-------------------------------
## 9. Планировщик (точка стыковки с MultiManager, решение #8)

### 9.1. Внешний триггер
- **Windows:** Task Scheduler → `curl -X POST -H "Authorization: Bearer SECRET" http://127.0.0.1:3000/api/runs/{id}/start`
- **Linux/macOS:** cron → аналогичный curl или wget.
- Core spawn'ит Python для каждого профиля через RunExecutor.
- Exit code → `run_tasks.status` (0=success, ≠0=failed).
- stdout/stderr → `logs/runs/{run_id}/{profile_name}.log` (путь в `run_tasks.log_file_path`).

### 9.2. Конфигурация в Settings MultiManager (Ф5)
- Поле «Путь к stAuto0» (cwd для spawn).
- Поле «Python-интерпретатор» (путь к `python.exe` или `python3`).
- Список доступных проектов (сканирование `projects/*.py` на классы `BaseProject`).

> **Python-окружение (решение Q3, 2026-07-09):** venv внутри stAuto0. Путь в Settings указывает на интерпретатор venv:
> - **Windows:** `stAuto0/venv/Scripts/python.exe`
> - **Linux/macOS:** `stAuto0/venv/bin/python3`
>
> Создание окружения: `python -m venv venv && venv\Scripts\activate && pip install -r requirements.txt` (Windows) / `python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt` (Linux/macOS).

### 9.3. Без GUI (headless ферма)
- MultiManager Core работает как демон (без Electron). Запускается: `node src/index.js --api-token=SECRET --port=3000` или через systemd/Task Scheduler.
- Внешний планировщик дёргает `POST /api/runs/{id}/start`.
- GUI опционален для мониторинга.

-------------------------------
## 10. Roadmap реализации (stAuto0-сторона)

> **Порядок реализации (решение пользователя, 2026-07-09):** ФГ (миграционные скрипты) → ФА+ФБ (ядро интеграции) → ФВ (Wallet Factory) → ФД (MCP). Каждая фаза тестируется на реальных данных перед переходом к следующей.

| Фаза | Задача | Файлы | Зависимости | Статус |
|------|--------|-------|-------------|--------|
| **ФГ** | **Миграционные скрипты** (ПЕРВАЯ): `migrate_to_sqlite.py` + `migrate_profile_dirs.py`. Перенос 10 аккаунтов из `config/accounts.py` в SQLite MultiManager. | `scripts/migrate_to_sqlite.py` (новый), `scripts/migrate_profile_dirs.py` (новый) | MultiManager Ф4 ✅ | ✅ |
| **ФА** | **`main.py` + `Core/multimanager.py`:** авто-детект Core (`is_core_alive`), `GET /api/internal/profiles?range=`, модуль-клиент MultiManager API, adapter `normalize_account()`. ProxyChecker и kill_chrome остаются в legacy. | `main.py`, `Core/multimanager.py` (новый) | MultiManager Ф1 ✅, Ф4 ✅, ФГ (для тест-данных) | ✅ |
| **ФБ** | **`Core/browser.py`:** флаг `mm_mode`, новый `launch()` (`_launch_via_multimanager` + `_launch_legacy`), `connect_via_endpoint()`, ветвление `login_zerion()`/`close()`. Все legacy-методы сохраняются. | `Core/browser.py` | MultiManager Ф4 ✅, ФА | ✅ |
| **ФВ** | **Wallet Factory на SQLite:** `create_wallets.py` (через `POST /api/profiles/batch`), `init_wallet4browser.py` (через API+CDP), `fill_emails.py` (через PUT). | `scripts/create_wallets.py`, `scripts/init_wallet4browser.py`, `scripts/fill_emails.py` | MultiManager Ф1 ✅, Ф4 ✅ | ✅ |
| **ФД** | **MCP:** переключение `mcp_server/server.py` на MultiManager API + Recorder-режим + мультимодальный анализ. | `mcp_server/server.py`, `mcp_server/recorder.py`, `mcp_server/vision.py`, `mcp_server/client.py` | MultiManager Ф4 ✅, ФА | ✅ |

> **Стыковка с MultiManager Roadmap:** MultiManager **Ф1–Ф5 готовы ✅**; **Ф6 — частично** (CRUD задач и tail-терминал готовы, но spawn Python-исполнения не реализован — см. §9.1, §12). stAuto0 может начинать миграцию немедленно для ручного/CLI-режима; автоматическое исполнение по расписанию требует доработки Ф6.
>
> **Параллельность:** ФА и ФБ реализованы параллельно (одна сессия), т.к. `Core/multimanager.py` (ФА) изолирован от `Core/browser.py` (ФБ). ФВ реализована после успешного smoke-теста ФА+ФБ (smoke-тест пройден ✅). ФД — следующая фаза.

-------------------------------
## 11. Открытые вопросы — РЕШЕНЫ (2026-07-09)

> Все вопросы Q1–Q5 закрыты решениями пользователя. Реализация может начинаться без дополнительных согласований.

| # | Вопрос | Решение (2026-07-09) | Где зафиксировано |
|---|--------|----------------------|-------------------|
| Q1 | Оставлять ли legacy-fallback в `Core/browser.py` (ФБ) или удалять прокси/fingerprint логику полностью? | ✅ **Оставить fallback.** Все legacy-методы (`_kill_chrome_for_profile`, `_get_or_create_fingerprint_seed`, `_parse_proxy`, `_find_zerion_in_profile`, `_login_zerion_legacy`) сохраняются в `_launch_legacy()` ветке. `Core/proxy.py` НЕ удаляется. | §3.2, §3.3, §4.2 |
| Q2 | Версионирование: stAuto0 в отдельном git или переезжает в monorepo с MultiManager? | ✅ **Отдельные репозитории.** stAuto0 остаётся в `C:\Users\stalcker\AI\stAuto0` со своим git. MultiManager — отдельный репозиторий. | Шапка документа |
| Q3 | Python-окружение в продакшене: venv рядом со stAuto0, или PyInstaller-сборка? | ✅ **venv внутри stAuto0.** Путь в Settings: `stAuto0/venv/Scripts/python.exe` (Win) / `stAuto0/venv/bin/python3` (Linux/macOS). | §9.2 |
| Q4 | `config/auto_sids.py` — где физически после миграции? | ✅ **`stAuto0/config/auto_sids.py`** (без изменений). MultiManager не прикасается к сидам. | §5.1, §5.4 |
| Q5 | Recovery при потере `auto_sids.py` ДО инициализации кошельков? | ✅ **Без автоматизации.** Пользователь сам отвечает за сохранность сидов (paper backup / offline). Автоматизация не создаётся — сознательный выбор безопасности. | §5.4 |

-------------------------------
## 12. Аудит реализации (2026-07-10)

Сверка заявленного в настоящем ТЗ с реальным кодом обоих репозиториев. Раздел фиксирует отклонения и фактическое состояние фаз.

### 12.1. stAuto0 (Python, ФА–ФД) — ✅ соответствует заявленному

**Тесты: 131/131 pass** (6 E2E помечены `@pytest.mark.e2e` и сняты `pytest.ini`/`-m "not e2e"`). **0 заглушек** в миграционном коде: поиск `TODO|FIXME|XXX|not implemented|NotImplementedError` и голых `pass`/`...` по `Core/`, `scripts/`, `mcp_server/`, `main.py` — без совпадений.

| Фаза | Файл | Строк | Оценка |
|------|------|-------|--------|
| ФГ | `scripts/migrate_to_sqlite.py` | 198 | ✅ реально работает (proxy parse, batch POST, proxy POST с fallback на 409, mapping.json с 10 живыми UUID — скрипт выполнялся) |
| ФГ | `scripts/migrate_profile_dirs.py` | 124 | ✅ `shutil.copytree(dirs_exist_ok=True)`, `--overwrite` |
| ФА | `Core/multimanager.py` | 139 | ✅ все 10+ методов + `normalize_account()` |
| ФА | `main.py` | 241 | ✅ авто-детект через `can_access_api()`, CLI `--port/--token/--range`, `check_account_proxy` в legacy |
| ФБ | `Core/browser.py` | 526 | ✅ mm_mode, `_launch_via_multimanager`, `connect_via_endpoint`, ветвление `login_zerion`/`close`, legacy сохранён |
| ФВ | `scripts/create_wallets.py` / `init_wallet4browser.py` / `fill_emails.py` | 150/173/61 | ✅ переписаны под API |
| ФД | `mcp_server/server.py` / `recorder.py` / `vision.py` / `client.py` | 491/181/62/222 | ✅ tri-state детект, генерация `BaseProject`-класса, GPT-4o vision, BrowserClient |

**Отклонения от буквального ТЗ (разумные инженерные решения, НЕ баги):**
- `migrate_to_sqlite.py` использует прямой `import config.accounts` вместо `exec()` — чище и безопаснее.
- `mm_mode` передаётся **аргументом конструктора** `BaseBrowser`, а не выводится из наличия ключа `profile_id` в dict — чище разделение ответственности.
- legacy-ветка инлайнена в тело `launch()` без выделения отдельного метода `_launch_legacy()` — то же поведение.
- `recorder.py` использует `page.expose_function()` + DOM-listeners вместо «сырых CDP-событий» — рабочая альтернатива.
- `vision.py` использует `page.screenshot()` (Playwright) вместо `Page.captureScreenshot` (CDP) — тот же результат.

**Реальные шероховатости (не блокирующие):**
- venv поставляется **без** `pytest`/`openai`/`mcp` → `python -m pytest` падает из коробки с `ModuleNotFoundError`, проходит только после `pip install openai mcp pytest pytest-asyncio`.
- `recorder.stop()` только сбрасывает флаг `_recording=False`, **не снимает** инжектированные DOM-listeners → мини-утечка до следующей навигации страницы.

### 12.2. MultiManager (Node.js, Ф1–Ф6) — Ф1–Ф5 ✅, Ф6 частично 🔴

| Фаза | Статус | Ключевое |
|------|--------|----------|
| Ф1 Core/health | ✅ | `GET /health` есть (`src/core/app.js:23-25`). За Bearer-auth (`app.use(authMiddleware)` до `/health`), но stAuto0 `is_core_alive()` (`Core/multimanager.py:37-42`) считает **401 признаком живого Core** → авто-детект работает корректно. Демон запускается (`src/index.js --api-token= --port=`). |
| Ф2 crypto/secrets | ✅ | AES-256-GCM (`src/crypto/index.js`). Шифруются 6 полей (`email_password, twitter_password, twitter_auth_token, discord_password, discord_token, wallet_password`). Расшифровка через `decryptRowSafe` — **только при master-ключе в памяти**. |
| Ф3 backup | ✅ | `src/backup/index.js` — hot backup + rolling window (коммит `6e29a46`). |
| **Ф4 Profiles/Browser (критичная точка стыковки)** | ✅ | `POST /api/browser/:id/start` возвращает **настоящий** `ws_endpoint` — НЕ заглушка (`src/api/browser.js:415-421`). cdpPort ловится из stderr регексом `/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)/` (`browser.js:346-349`). `GET /api/internal/profiles?range=` отдаёт **расшифрованные секреты + готовую `connection_string` прокси** (`src/api/internal.js:46-63`). `POST /api/profiles/batch` генерирует fingerprint автоматически. `POST /api/browser/:id/stop` — tree-kill (SIGTERM→SIGKILL). |
| Ф5 Settings | ✅ | `stAuto0_path`, `python_path`, список проектов из `projects/*.py` (`src/api/settings.js:91-128`, GUI `Settings.vue:73-86`). |
| **Ф6 Tasks/Scheduler+терминал** | ✅ | CRUD задач ✅; tail-терминал ✅; spawn Python-исполнения ✅ (`child_process.spawn` с `--project`, `--range`, `--log-name`, `--token`, логи в `logs/tasks/`, `updateExecutionStatus` по exit/error). Терминал привязан к задачам через кнопку "View Log". |

**Отклонения/недочёты MultiManager (исправлены):**
- ~~**Ф6 spawn-ядро отсутствует**~~ — ✅ реализовано (spawn, логи, updateExecutionStatus, привязка терминала).
- ~~**Невалидный `range`**~~ — ✅ возвращает 400 (`src/api/internal.js:35-38`).
- ~~**`src/api/auth.js` timingSafeEqual**~~ — ✅ добавлен `crypto.timingSafeEqual`.

**Остаётся:**
- `POST /api/browser/:id/zerion-login` хардкодит `popup.8e8f209b.html` (`src/api/browser.js:646`) — хрупко к версии расширения Zerion.

### 12.3. Итог по стыковке
**Ручной/CLI запуск** (`python main.py --project=... --range=... --token=...` поверх живого MultiManager Core) — **работает**: Ф1–Ф6 MultiManager и все фазы stAuto0 стыкуются корректно, `ws_endpoint` реальный, секреты и прокси приходят готовыми.
**Автоматическое исполнение** (Automation Matrix → `POST /api/runs/:id/start`) — **работает**: Core spawn'ит Python, пишет логи, обновляет статус в `run_tasks`.

-------------------------------
