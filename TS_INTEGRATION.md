-------------------------------
## ТЕХНИЧЕСКОЕ ЗАДАНИЕ: ИНТЕГРАЦИЯ stAuto0 С MultiManager
## Спутник-документ к [TS.md](./TS.md) (MultiManager v1.1.0)
**Версия:** 1.1.0 | **Дата ревизии:** 2026-07-07

> **Принцип маркировки:** ✅ уже есть в коде stAuto0 | ❌ к реализации/изменению | ⚠️ будет удалено/переписано.
> **Расположение stAuto0:** `C:\Users\stalcker\AI\stAuto0` (отдельный проект, отдельный git).
-------------------------------

## 1. Контекст stAuto0 (что есть сейчас — аудит 2026-07-07)

stAuto0 — Playwright-based фреймворк Web3-автоматизации (дроп-охота, квесты, мультиаккаунтинг). Это «жирный инстанс» под миграцию.

**Текущая архитектура (всё ✅, но подлежит рефакторингу):**

| Компонент | Файл | Описание |
|-----------|------|----------|
| **Точка входа** | `main.py` | CLI: `--headless`, `--project=concrete,paragraph`, `--log-name=`, диапазоны `001-010` или `auto_001`. Разворачивает диапазоны через `expand_account_args()`. |
| **BaseBrowser** | `Core/browser.py` | cloakbrowser (`launch_persistent_context_async`) + Playwright. Методы: `launch()`, `connect()`, `login_zerion()`, `run_project()`, `click_confirm()`, `_wallet_confirm()`, `_kill_chrome_for_profile()`, `_get_or_create_fingerprint_seed()`, `_parse_proxy()`, `_find_zerion_in_profile()`, `close()`. |
| **ProxyChecker** | `Core/proxy.py` | aiohttp, тест через `api.ipify.org`. **Подлежит удалению.** |
| **Аккаунты** | `config/accounts.py` | Статический tuple из 10 аккаунтов (статус, name, wallet_password, email, solana, evm, profile_directory, debugging_port, proxy, timezone). **Подлежит замене на API-чтение.** |
| **Сиды** | `config/auto_sids.py` | Временный файл мнемоник (BIP39 24 слова). Создаётся `create_wallets.py`, уничтожается вручную после инициализации. |
| **Проекты** | `projects/*.py` (15 шт.) | `BaseProject` subclasses: concrete, concrete_paragraph, allscale, cambrian, litvm, neuraverse, pumpcade, rabbithole, rax_finance, test, umbraprivacy, upshot, xstocks. Интерфейс: `_get_start_url()`, `_get_max_attempts()`, `_use_new_tab()`, `_check_success()`, `_login()`, `_process()`. |
| **Wallet Factory** | `scripts/create_wallets.py`, `scripts/init_wallet4browser.py`, `scripts/fill_emails.py` | Генерация BIP39, деривация EVM/Solana, онбординг Zerion (24 слова). |
| **MCP сервер** | `mcp_server/server.py` | FastMCP, 10 tools: `browser_launch`, `browser_close`, `browser_navigate`, `browser_click`, `browser_fill`, `browser_screenshot`, `browser_get_content`, `browser_wait_for`, `browser_login_zerion`, `browser_list_sessions`. Читает `config/accounts.py`. |
| **Миграционные скрипты** | — | **НЕ существуют.** `scripts/migrate_to_sqlite.py` и `scripts/migrate_profile_dirs.py` — к созданию. |
| **Зависимости** | `requirements.txt` | mnemonic, eth-account, base58, pynacl, aiohttp, playwright, requests, websocket-client, cloakbrowser, google-auth-oauthlib, google-api-python-client, pytest, pytest-asyncio, mcp. |

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
- **Данные проектов — «Tasks как контейнер»:** код проектов в `projects/*.py`, мета (script_name, params JSON, schedule) в таблицах `tasks`/`task_executions` MultiManager.

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

### 3.1. Авто-детект Core ❌
`main.py` должен сохранять CLI для **ручного запуска без MultiManager** (требование пользователя). Реализация:

```python
CORE_HEALTH_URL = f"http://127.0.0.1:{os.environ.get('MM_PORT', '3000')}/health"

async def is_core_alive() -> bool:
    """Проверяет, запущен ли MultiManager Core."""
    try:
        async with aiohttp.ClientSession() as s:
            async with s.get(CORE_HEALTH_URL, timeout=aiohttp.ClientTimeout(total=2)) as r:
                return r.status == 200
    except Exception:
        return False
```

- **Core жив → режим MultiManager:** аккаунты из `/api/internal/profiles?range=`, браузер через `POST /api/browser/:id/start`, прокси-чеккер пропускается (всё делает Node.js).
- **Core мёртв → fallback на legacy:** аккаунты из `config/accounts.py`, браузер через `launch_persistent_context_async` напрямую, прокси через `Core/proxy.py` (aiohttp). Для ручного запуска/дебага.

### 3.2. Удаление ProxyChecker из Python ⚠️
В режиме MultiManager `check_account_proxy()` (`main.py:30`) **не вызывается** — прокси-валидация происходит в Node.js перед стартом (`src/api/browser.js:263`). `Core/proxy.py` остаётся только для fallback-режима (или удаляется, если fallback не нужен — решение за пользователем).

### 3.3. Удаление `kill_chrome_processes()` ⚠️
`main.py:49` использует `taskkill` для зависших Chrome. В режиме MultiManager — graceful shutdown через `POST /api/browser/:id/stop` (Node.js делает SIGTERM→SIGKILL через tree-kill).

-------------------------------
## 4. Рефакторинг `Core/browser.py` (BaseBrowser)

### 4.1. Метод `launch()` — переписать ❌

**Текущая реализация** (`Core/browser.py:191`): `_kill_chrome_for_profile()` → формирование chrome_args (fingerprint, --remote-debugging-port, --load-extension, proxy) → `launch_persistent_context_async`.

**Новая реализация (режим MultiManager):**
```python
async def launch(self, extensions=None):
    if await is_core_alive():
        await self._launch_via_multimanager()
    else:
        await self._launch_legacy()  # текущий код, переименованный

async def _launch_via_multimanager(self):
    resp = await self._mm_post(f"/api/browser/{self.profile_id}/start", json={})
    data = await resp.json()
    self.ws_endpoint = data["ws_endpoint"]   # "http://127.0.0.1:{cdpPort}"
    self.pid = data["pid"]
    await self.connect()   # connect_over_cdp(ws_endpoint)
```

### 4.2. Удалить ⚠️ (только legacy-режим сохраняет)
| Метод | Причина |
|-------|---------|
| `_kill_chrome_for_profile()` | Node.js Anti-Zombie делает это через tree-kill |
| `_get_or_create_fingerprint_seed()` | MultiManager генерирует seed в SQLite |
| `_parse_proxy()` | Прокси парсится в `src/proxy/index.js` MultiManager |
| `_find_zerion_in_profile()` | Zerion грузится через `--load-extension` MultiManager |
| `login_zerion()` | **Переносится в Node.js** (`POST /api/browser/:id/zerion-login`) |

> **Решение:** если fallback на legacy не нужен — эти методы удаляются полностью. Если нужен — остаются в `_launch_legacy()` ветке. Рекомендация: оставить fallback на первое время для безопасности миграции.

### 4.3. Сохранить ✅
| Метод | Зачем |
|-------|-------|
| `connect()` | CDP-подключение к ws_endpoint от MultiManager |
| `run_project(project_class)` | Динамический запуск квеста |
| `click_confirm(button, timeout)` | Обработка попапа кошелька (рекурсивный `_wallet_confirm`) |
| `_wallet_confirm(page, depth)` | Внутренняя логика confirm-цепочки |
| `close()` | В режиме MultiManager — `POST /api/browser/:id/stop`; в legacy — `context.close()` |

-------------------------------
## 5. Wallet Factory на SQLite

### 5.1. `scripts/create_wallets.py` — переписать ❌

**Текущее:** читает/пишет `config/accounts.py` (`get_existing_accounts`, `get_start_index`), генерирует BIP39 (24 слова), деривирует EVM (`m/44'/60'/0'/0/0`) и Solana (`m/44'/501'/0'/0'` через SLIP-0010 Ed25519), пишет всё в `accounts.py` + сиды в `auto_sids.py`.

**Новое:**
- `get_start_index()`: вместо exec `accounts.py` → `GET /api/profiles` → `max(number) + 1`.
- Генерация остаётся (BIP39, EVM, Solana) — ✅ без изменений.
- Запись через `POST /api/profiles/batch` (`src/api/profiles.js` новый endpoint, Roadmap Ф4 MultiManager): только публичные данные (`wallet_evm_address`, `wallet_sol_address`, `wallet_password` default 'asdfj*KK').
- **Сиды ТОЛЬКО во временный `config/auto_sids.py`** — никогда в БД. Параноидальный инвариант.
- Авто-распределение почт: читать `config/free_email.txt`, по одной почте на аккаунт через `PUT /api/profiles/:id {email}`. По завершении `free_email.txt` перезаписывается без использованных строк (логика `scripts/fill_emails.py`).

### 5.2. `scripts/init_wallet4browser.py` — переписать ❌

**Текущее:** читает `config/auto_sids.py`, поочерёдно `BaseBrowser.launch()`, навигация на `chrome-extension://.../onboarding`, ввод 24 слов, установка пароля. Идемпотентность: если `Session expired` → skip.

**Новое:**
- Чтение `auto_sids.py` — без изменений.
- `BaseBrowser.launch()` теперь дёргает MultiManager `POST /api/browser/:id/start`.
- Онбординг через CDP (Playwright поверх ws_endpoint) — без изменений.
- `keep_open=true` для ручной инспекции одного аккаунта — без изменений.

### 5.3. Уничтожение следов (без изменений ✅)
После инициализации всей партии пользователь **вручную** удаляет `config/auto_sids.py`. В системе остаются чистые рабочие сессии Chromium без мнемоник на диске. **Этот шаг НЕ автоматизируется** — сознательное действие человека.

-------------------------------
## 6. CDP-порты и ws_endpoint (решение #12)

**Текущее стАвто0:** статические `debugging_port` (9330, 9331, ...) в `accounts.py`. Запуск `cloakbrowser` с `--remote-debugging-port=N`.

**Текущее MultiManager:** `--remote-debugging-port=0` (ОС выделяет порт динамически), реальный порт ловится из stderr `DevTools listening on ws://127.0.0.1:{port}` в `cdpPorts` Map (`src/api/browser.js:344`).

**Канон v1.1.0:**
- stAuto0 **не управляет** debugging-портами. Это делает MultiManager.
- `POST /api/browser/:id/start` возвращает `{ws_endpoint: "http://127.0.0.1:{cdpPort}", pid}` (MultiManager Ф4 исправляет заглушку).
- Python: `await playwright.chromium.connect_over_cdp(ws_endpoint)` (метод `connect()` уже это делает, `Core/browser.py:62`).

-------------------------------
## 7. Миграция существующего инстанса (новые скрипты ❌)

Для переезда «жирного» инстанса с старыми куками/сессиями GUI не пишется — задача решается двумя изолированными консольными скриптами. **Скрипты удаляются после миграции.**

### 7.1. `scripts/migrate_to_sqlite.py` (создать ❌)
- Читает старый `config/accounts.py` (через exec, как `create_wallets.py:get_existing_accounts`).
- Парсит строки прокси `host:port:user:pass` → формат MultiManager.
- Для каждого аккаунта генерирует UUIDv4.
- `POST /api/profiles/batch` к MultiManager (Bearer-token из аргументов).
- Выгружает временную карту соответствия `mapping.json`: `{"auto_001": "8f3b201a-...", ...}`.
- Сохраняет `mapping.json` для второго скрипта.

### 7.2. `scripts/migrate_profile_dirs.py` (создать ❌)
- Читает `mapping.json`.
- `shutil.copytree` папок Chromium-сессий:
  - **Откуда:** `config/chrome_accounts/auto_001/`
  - **Куда:** `%APPDATA%/CloakManager/profiles/{UUID}/BrowserData/`
- Полностью сохраняет куки и авторизации кошельков.
- Логирует успех/неудачу по каждому аккаунту (не прерывается при ошибке одного).

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

### 8.1. `mcp_server/server.py` — переписать ❌

**Текущее:** читает `config/accounts.py`, `browser_launch` делает `BaseBrowser.launch()`, удерживает `_browsers` dict.

**Новое:**
- `browser_launch(account_name)` → сначала резолвит `account_name` (auto_001) в `profile_id` (UUID) через `GET /api/internal/profiles`, затем `POST /api/browser/{profile_id}/start`. Возвращает ws_endpoint.
- Удержание CDP-сессии через `connect_over_cdp` в `_browsers[profile_id]`.
- `browser_login_zerion` → делегирует в `POST /api/browser/{profile_id}/zerion-login` (Node.js).
- Остальные tools (navigate/click/fill/screenshot/get_content/wait_for) — без изменений, работают поверх удерживаемой CDP-сессии.

### 8.2. Recorder-режим (новый ❌, Roadmap ФД)
- FastMCP-сервер перехватывает CDP-события кликов и ввода пользователя (через `Input.dispatchKeyEvent`/`Input.dispatchMouseEvent` listener или DOM-инспекцию).
- ИИ-модель (PicoAgent / GPT-4o / Claude 3.5) агрегирует события.
- Компилирует в готовый Python-класс проекта, наследуемый от `BaseProject` (`projects/base.py`).
- Автосохранение в `projects/generated_{name}.py`.
- New tool: `generate_project_class(session_id, project_name)` → возвращает код класса.

### 8.3. Мультимодальный анализ (новый ❌, Roadmap ФД)
- `Page.captureScreenshot` через CDP → отправка в мультимодальную модель.
- Используется для прохождения капч и сложных интерфейсов.
- Компонуется с DOM-анализом (`browser_get_content` + LLM-резолв селекторов).

-------------------------------
## 9. Планировщик (точка стыковки с MultiManager, решение #8)

### 9.1. Внешний триггер
- **Windows:** Task Scheduler → `curl -X POST -H "Authorization: Bearer SECRET" http://127.0.0.1:3000/api/tasks/{id}/run`
- **Linux/macOS:** cron → аналогичный curl или wget.
- Core spawn'ит: `spawn('python', ['main.py', '--project='+task.script_name, '--range='+task.params.range, '--log-name='+task.id], {cwd: <stAuto0 путь>})`.
- Exit code → `task_executions.status` (0=success, ≠0=failed).
- stdout/stderr → `logs/task_{task_id}_{timestamp}.log` (путь в `task_executions.log_file_path`).
- Встроенный терминал GUI (MultiManager Ф6) tail'ит этот файл.

### 9.2. Конфигурация в Settings MultiManager (Ф5)
- Поле «Путь к stAuto0» (cwd для spawn).
- Поле «Python-интерпретатор» (путь к `python.exe` или `python3`).
- Список доступных проектов (сканирование `projects/*.py` на классы `BaseProject`) — для выбора `script_name` в Tasks Manager.

### 9.3. Без GUI (headless ферма)
- MultiManager Core работает как демон (без Electron). Запускается: `node src/index.js --api-token=SECRET --port=3000` или через systemd/Task Scheduler.
- Внешний планировщик дёргает `POST /api/tasks/:id/run`.
- GUI опционален для мониторинга.

-------------------------------
## 10. Roadmap реализации (stAuto0-сторона)

| Фаза | Задача | Файлы | Зависимости |
|------|--------|-------|-------------|
| **ФА** | `main.py`: авто-детект Core + `GET /api/internal/profiles?range=`. Удалить `Core/proxy.py` из основного пути (оставить fallback). | `main.py` | MultiManager Ф1, Ф4 |
| **ФБ** | `Core/browser.py`: новый `launch()` (`_launch_via_multimanager` + `_launch_legacy`), удалить `login_zerion`/`_kill_chrome_for_profile`/`_get_or_create_fingerprint_seed`/`_parse_proxy`/`_find_zerion_in_profile` (или в legacy). | `Core/browser.py` | MultiManager Ф4 |
| **ФВ** | Wallet Factory на SQLite: `create_wallets.py` (через `POST /api/profiles/batch`), `init_wallet4browser.py` (через API+CDP), `fill_emails.py` (через PUT). | `scripts/create_wallets.py`, `scripts/init_wallet4browser.py`, `scripts/fill_emails.py` | MultiManager Ф1, Ф4 |
| **ФГ** | Миграционные скрипты: `scripts/migrate_to_sqlite.py` + `scripts/migrate_profile_dirs.py`. | `scripts/migrate_to_sqlite.py` (новый), `scripts/migrate_profile_dirs.py` (новый) | MultiManager Ф4 |
| **ФД** | MCP: переключение на MultiManager API + Recorder-режим + мультимодальный анализ. | `mcp_server/server.py` | MultiManager Ф4 |

> **Стыковка с MultiManager Roadmap:** ФА/ФБ требуют MultiManager Ф1 (БД) + Ф4 (endpoints). ФВ требует Ф1 + Ф4. ФГ требует Ф4. ФД требует Ф4. Рекомендуемый порядок реализации: MultiManager Ф1 → Ф4 (минимум для стыковки) → параллельно stAuto0 ФА+ФБ → остальные фазы.

-------------------------------
## 11. Открытые вопросы (требуют решения до реализации)

| # | Вопрос | Контекст |
|---|--------|----------|
| Q1 | Оставлять ли legacy-fallback в `Core/browser.py` (ФБ) или удалять прокси/fingerprint логику полностью? | Рекомендация: оставить на первое время для безопасности миграции. |
| Q2 | Версионирование: stAuto0 в отдельном git или переезжает в monorepo с MultiManager? | Сейчас отдельные git. Решение за пользователем. |
| Q3 | Python-окружение в продакшене: venv рядом со stAuto0, или PyInstaller-сборка? | Влияет на упаковку и авто-обновление. |
| Q4 | `config/auto_sids.py` — где физически после миграции (в stAuto0 или в MultiManager)? | Сейчас в stAuto0. Параноидальный инвариант требует контроля доступа. |
| Q5 | Recovery при потере `auto_sids.py` ДО инициализации кошельков? | Сиды ещё не в браузере → потеря средств. Нужен backup-strategy для временного файла. |

-------------------------------
