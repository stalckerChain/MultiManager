# TASK: ФБ — Рефакторинг `Core/browser.py` (BaseBrowser)

> **Статус:** ❌ Запланировано
> **Фаза:** ФБ (сторона stAuto0)
> **Основание:** TS_INTEGRATION.md §4 (Рефакторинг Core/browser.py)
> **Зависимости:** ФА ✅ (`Core/multimanager.py` готов, `main.py` модифицирован)
> **Вход:** `C:\Users\stalcker\AI\stAuto0\Core\browser.py` (ревизия с заглушками MM-режима)

---

## Текущее состояние (аудит)

В `Core/browser.py` уже присутствуют:
- `__init__` — поле `mm_mode`, `profile_id`, `ws_endpoint`, `mm_pid` — ✅
- `launch()` — ветвление `if self.mm_mode: _launch_via_multimanager()` — ✅
- `_launch_via_multimanager()` — **ЗАГЛУШКА** (только `self._connected = True`) — ❌
- `connect_via_endpoint()` — **реализован** (Playwright `connect_over_cdp`) — ✅
- `close()` — ветвление `if self.mm_mode` с заглушкой — ❌
- `login_zerion()` — ветвление `if self.mm_mode` с заглушкой — ❌
- Все legacy-методы не тронуты — ✅
- `connect()` — CDP по debugging_port для legacy — ✅

---

## Пошаговый план

### Шаг 1: Реализация `_launch_via_multimanager()` (замена заглушки)

**Файл:** `Core/browser.py`, метод `_launch_via_multimanager` (строка 197)

**Что сделать:**
- Создать `MultiManagerClient()` (берёт порт/токен из env)
- Вызвать `await mm.start_browser(self.profile_id)`
- Сохранить `ws_endpoint` и `mm_pid` из ответа
- Вызвать `await self.connect_via_endpoint(ws_endpoint)`

**Ожидаемый ответ MM API (`POST /api/browser/:id/start`):**
```json
{ "ws_endpoint": "http://127.0.0.1:{cdpPort}", "pid": 12345, "cdp_port": 9330 }
```

**Код:**
```python
async def _launch_via_multimanager(self, extensions=None):
    from Core.multimanager import MultiManagerClient
    mm = MultiManagerClient()
    data = await mm.start_browser(self.profile_id)
    self.ws_endpoint = data["ws_endpoint"]
    self.mm_pid = data.get("pid")
    await self.connect_via_endpoint(self.ws_endpoint)
```

**Проверка:** метод больше не заглушка, реально подключается к браузеру.

---

### Шаг 2: Реализация `close()` в MM-режиме (замена заглушки)

**Файл:** `Core/browser.py`, MM-ветка метода `close()` (строка 363)

**Что сделать:**
- Вызвать `await mm.stop_browser(self.profile_id)` — graceful shutdown на Node.js
- Остановить Playwright-сессию (`self._pw.stop()`)

**Код:**
```python
if self.mm_mode:
    mm = MultiManagerClient()
    await mm.stop_browser(self.profile_id)
    if hasattr(self, '_pw'):
        try:
            await self._pw.stop()
        except Exception:
            pass
    self._connected = False
    return
```

**Важно:** Не забыть `self._connected = False` после остановки.

---

### Шаг 3: Реализация `login_zerion()` в MM-режиме (замена заглушки)

**Файл:** `Core/browser.py`, MM-ветка метода `login_zerion()` (строка 396)

**Что сделать:**
- Вызвать `await mm.zerion_login(self.profile_id)` — Node.js делает логин через расширение

**Код:**
```python
if self.mm_mode:
    from Core.multimanager import MultiManagerClient
    mm = MultiManagerClient()
    await mm.zerion_login(self.profile_id)
    return
```

---

### Шаг 4: Проверка `connect_via_endpoint()` на корректность

**Файл:** `Core/browser.py`, метод `connect_via_endpoint()` (строка 201)

Текущая реализация уже корректна — подключение к уже запущенному браузеру через CDP ws_endpoint.

**Убедиться:** что после `connect_via_endpoint` `self._connected = True`, получены `self.context` и `self.page`.

---

### Шаг 5: Рефакторинг `connect()` — избавиться от дублирования

**Файл:** `Core/browser.py`, метод `connect()` (строка 68)

**Проблема:** методы `connect()` и `connect_via_endpoint()` дублируют логику (Playwright start → connect_over_cdp → получение context/page → bring_to_front).

**Что сделать:**
- Переписать `connect()` через `connect_via_endpoint()`:
  ```python
  async def connect(self):
      port = self.debugging_port
      if not port:
          raise RuntimeError("No debugging port configured for this account")
      await self.connect_via_endpoint(f"http://127.0.0.1:{port}")
  ```

---

### Шаг 6: Проверка legacy-веток — ничего не сломано

**Файл:** `Core/browser.py`

**Что проверить:**
- `launch()` → `_launch_legacy()` (текущий full launch код) — не изменяется
- `close()` → legacy-ветка с `context.close()` + `_kill_chrome_for_profile()` — не изменяется
- `login_zerion()` → `_login_zerion_legacy()` (текущий код с password input) — не изменяется
- `_kill_chrome_for_profile()` — не тронут
- `_get_or_create_fingerprint_seed()` — не тронут
- `_parse_proxy()` — не тронут
- `_find_zerion_in_profile()` — не тронут
- `click_confirm()` / `_wallet_confirm()` — не тронуты
- `run_project()` — не тронут

---

### Шаг 7: Проверка интеграции с `main.py` / `run_account()`

**Файл:** `main.py`, функция `run_account()` (строка 83)

**Убедиться:** что `run_account()` корректно работает с обеими ветками:
- MM-режим: `BaseBrowser(account, headless=headless, mm_mode=True)` → `browser.launch()` → `_launch_via_multimanager()`
- Legacy-режим: `BaseBrowser(account, headless=headless, mm_mode=False)` → `browser.launch()` → `_launch_legacy()`

`run_account()` в MM-режиме уже пропускает `check_account_proxy()` и `check_account_running()` — это корректно.

---

### Шаг 8: Обработка ошибок и таймаутов в MM-режиме

**Что сделать:**
- Обернуть вызовы `mm.start_browser()` / `mm.stop_browser()` / `mm.zerion_login()` в try/except
- При ошибке `start_browser` — логировать и пробрасывать исключение (не маскировать)
- При ошибке `stop_browser` в `close()` — логировать warning, не бросать (cleanup не должен прерывать)
- При ошибке `zerion_login` — логировать error и пробрасывать (авторизация критична)

---

### Шаг 9: Интеграционный тест (ручной smoke-тест)

**Что сделать:**
1. Запустить MultiManager Core (GUI или `node src/index.js`)
2. Убедиться, что есть хотя бы 1 профиль в БД
3. Запустить из stAuto0:
   ```
   python main.py --project=test --range=001-001 --token=SECRET
   ```
4. Проверить лог: `[MM-mode]` — профиль получен из API, браузер запущен через MM, `connect_via_endpoint` выполнен
5. Проверить что проект запустился и отработал
6. Проверить что `close()` вызвал `mm.stop_browser()`
7. Повторить legacy-режим (без запущенного Core):
   ```
   python main.py --project=test 001-001
   ```
8. Убедиться что legacy-ветка работает как раньше

---

## Файловый манифест

| Файл | Действие | Описание |
|------|----------|----------|
| `Core/browser.py` | **ИЗМЕНИТЬ** | Шаги 1–6: реализация MM-методов, рефакторинг `connect()` |
| `Core/multimanager.py` | **НЕ ТРОГАТЬ** | Уже готов (ФА) |
| `main.py` | **НЕ ТРОГАТЬ** | Уже готов (ФА) — проверка интеграции |

---

## Порядок реализации

| № | Шаг | Суть | Сложность |
|---|-----|------|-----------|
| 1 | `_launch_via_multimanager()` | Замена заглушки на вызов MM API + `connect_via_endpoint()` | low |
| 2 | `close()` MM-ветка | Замена заглушки на `mm.stop_browser()` + stop Playwright | low |
| 3 | `login_zerion()` MM-ветка | Замена заглушки на `mm.zerion_login()` | low |
| 4 | `connect()` → `connect_via_endpoint()` | Устранение дублирования | low |
| 5 | try/except в MM-вызовах | Обработка ошибок (error в launch/login, warning в close) | low |
| 6 | Smoke-тест | Запуск MM-mode и legacy-mode, проверка логов | medium |

---

## Не делаем в рамках ФБ

- ❌ Wallet Factory (ФВ) — будет позже
- ❌ Миграционные скрипты (ФГ) — можно делать параллельно
- ❌ MCP-сервер (ФД) — позже
- ❌ Изменение API MultiManager (всё готово в Ф4)
- ❌ Удаление legacy-методов (они остаются навсегда, решение Q1)
- ❌ Рефакторинг `config/accounts.py` или других файлов stAuto0
