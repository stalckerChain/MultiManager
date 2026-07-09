# ФГ: Миграционные скрипты — План реализации

> **Цель:** Перенести 10 существующих аккаунтов (auto_001–auto_010) из `config/accounts.py` + `config/chrome_accounts/` в SQLite MultiManager, сохранив куки, сессии кошельков и прокси.
>
> **Статус:** ⬜ Не начато
> **Документ ТЗ:** `TS_INTEGRATION.md §7`

---

## Этап 1: Скрипт `scripts/migrate_to_sqlite.py`

### 1.1. Базовая структура (скелет)

- [ ] Создать файл `C:\Users\stalcker\AI\stAuto0\scripts\migrate_to_sqlite.py`
- [ ] CLI-аргументы через `argparse`:
  - `--token` (обязательный) — Bearer-токен MM API
  - `--port` (default: 3000) — порт MM Core
  - `--host` (default: 127.0.0.1)
  - `--force` (flag) — принудительное пересоздание существующих профилей
- [ ] Импорт: `asyncio`, `argparse`, `json`, `logging`, `sys`, `os`
- [ ] Импорт: `Core.multimanager.MultiManagerClient`
- [ ] Импорт: `config.accounts.accounts` (через `sys.path.append`)
- [ ] `main()` с `async def`, запуск через `asyncio.run()`
- [ ] Логирование в `logs/migrate_to_sqlite_YYYYMMDD_HHMMSS.log`

### 1.2. Определение существующих профилей

- [ ] Подключение к MM API: `GET /api/profiles` через `mm_client.get_all_profiles()`
- [ ] Построить `set` существующих имён (например `auto_001`)
- [ ] Если `--force`:
  - Для каждого существующего профиля, чьё имя совпадает с мигрируемым:
    - `DELETE /api/profiles/:id` (игнорировать 404/409)
    - Лог: `[force] auto_001: удалён и будет пересоздан`
- [ ] Если `--force` не задан:
  - Фильтр: пропускать аккаунты, уже существующие в MM (лог warning)
  - Работать только с отсутствующими

### 1.3. Парсинг прокси

- [ ] Чтение прокси из `account['proxy']` (формат: `host:port:user:pass`)
- [ ] Разбивка строки: `host, port_str, user, pass_str = proxy.split(':')`
- [ ] Кеш прокси (dict по строке `host:port`) — чтобы не плодить дубликаты
- [ ] Для каждой уникальной прокси:
  - `POST /api/proxies` c `{ type: 'http', host, port: int(port), username: user, password: pass_str }`
  - Обработка 409 (уже существует) — `GET /api/proxies`, поиск по host:port
  - Сохранение `proxy_id` в кеш
- [ ] Лог: `[proxy] 45.151.163.190:5943 → proxy_id=5`

### 1.4. Batch-создание профилей

- [ ] Для каждого аккаунта (после фильтрации существующих):
  - Формирование payload:
    ```json
    {
      "name": "auto_001",
      "platform": "windows",
      "proxy_id": "<UUID или null>",
      "timezone": "Europe/Berlin",
      "email": "botany-icky-rocket@duck.com",
      "wallet_evm_address": "0x48c95...",
      "wallet_sol_address": "BPxz4Pq8...",
      "wallet_password": "anal2006"
    }
    ```
- [ ] Вызов `mm_client.create_profiles_batch(payloads)`
- [ ] Обработка ошибок HTTP — логирование + прерывание скрипта

### 1.5. Генерация mapping.json

- [ ] По map: `{ "auto_001": "<UUID_из_ответа>", ... }`
- [ ] Сохранение в `config/mapping.json` (формат JSON, `indent=2`)
- [ ] Лог: `[mapping] config/mapping.json сохранён (N записей)`
- [ ] Итоговая сводка:
  ```
  ===== ИТОГ МИГРАЦИИ =====
  Всего аккаунтов:        10
  Создано:                10
  Пропущено (существуют): 0
  Ошибок:                 0
  Прокси создано:         4
  Mapping:                config/mapping.json
  ```

### 1.6. Обработка крайних случаев

- [ ] Если `--force` и `DELETE` возвращает 409 (профиль запущен) — `SystemExit` с сообщением
- [ ] Если `--token` не указан — `SystemExit`
- [ ] Если Core недоступен — `SystemExit` с советом запустить MM
- [ ] Если `accounts` пустой tuple — лог warning, выход без ошибки
- [ ] Если прокси с таким `host:port` уже существует — 409, поиск существующей

---

## Этап 2: Скрипт `scripts/migrate_profile_dirs.py`

### 2.1. Базовая структура

- [ ] Создать файл `C:\Users\stalcker\AI\stAuto0\scripts\migrate_profile_dirs.py`
- [ ] CLI-аргументы:
  - `--mapping` (default: `config/mapping.json`)
  - `--overwrite` (flag) — перезаписывать существующие директории
- [ ] Импорт: `shutil`, `json`, `logging`, `os`, `sys`
- [ ] `main()` синхронная (без asyncio — только файловые операции)

### 2.2. Чтение mapping.json

- [ ] Проверка существования `config/mapping.json` — если нет, `SystemExit` с инструкцией запустить `migrate_to_sqlite.py`
- [ ] Загрузка JSON: `{ "auto_001": "8f3b201a-...", ... }`

### 2.3. Определение путей

- [ ] **Source:** `config/chrome_accounts/{name}/` (например `config/chrome_accounts/auto_001/`)
- [ ] **Target:** `{APPDATA}/CloakManager/profiles/{UUID}/BrowserData/`
  - Windows: `os.environ['APPDATA']` → `C:\Users\stalcker\AppData\Roaming\CloakManager\profiles\{UUID}\BrowserData\`
  - Платформозависимость: пока только Windows (stAuto0 на Windows)
- [ ] Проверка: существует ли `APPDATA` (если нет — fallback на `~/CloakManager/profiles/...`)

### 2.4. Копирование профилей

- [ ] Для каждой записи `{ name: uuid }`:
  - Проверка: `source` существует? Если нет — лог `[skip] auto_001: исходная директория не найдена`
  - Проверка: `target` уже существует?
    - Если да и не `--overwrite` — лог `[skip] auto_001: целевая директория не пуста (используй --overwrite)`
    - Если да и `--overwrite` — `shutil.rmtree(target)` + создание заново
  - **Копирование:** `shutil.copytree(source, target, dirs_exist_ok=True)`
  - Лог: `[ok] auto_001 → {UUID} (N файлов)`
  - При ошибке копирования: лог `[err] auto_001: {traceback}`, **продолжить** со следующим

### 2.5. Итоговая сводка

- [ ] Вывод:
  ```
  ===== ИТОГ КОПИРОВАНИЯ =====
  Успешно:   10
  Пропущено: 0
  Ошибок:    0
  ```
- [ ] Если есть ошибки — exit code 1 (для CI/CD)
- [ ] Рекомендация: `Теперь можно запустить main.py --project=... --range=001-010 и проверить в MM GUI`

### 2.6. Безопасность и edge cases

- [ ] `source` не существует → skip, не прерывать
- [ ] `target` частично заполнен (бывший неудачный запуск) → `--overwrite` решает
- [ ] Пробелы в пути `APPDATA` → корректная обработка (shutil сам экранирует)
- [ ] Атомарность на уровне одного профиля: ошибка одного не ломает остальные
- [ ] Если mapping.json пустой — `SystemExit`

---

## Этап 3: Тестирование интеграции

### 3.1. Smoke-тест migrate_to_sqlite (без --force)

- [ ] Убедиться, что MM Core запущен
- [ ] Запустить: `python scripts/migrate_to_sqlite.py --token=SECRET`
- [ ] Проверить: профили созданы, прокси созданы, mapping.json создан
- [ ] Проверить в GUI: 10 профилей, данные совпадают с accounts.py

### 3.2. Smoke-тест migrate_to_sqlite (с --force, идемпотентность)

- [ ] Запустить повторно без `--force` — должно сказать «все пропущены»
- [ ] Запустить с `--force` — должно пересоздать все 10

### 3.3. Smoke-тест migrate_profile_dirs

- [ ] Убедиться, что mapping.json существует
- [ ] Запустить: `python scripts/migrate_profile_dirs.py`
- [ ] Проверить: `%APPDATA%/CloakManager/profiles/{UUID}/BrowserData/` существуют
- [ ] Проверить: внутри есть куки, Local Storage и т.д.

### 3.4. Интеграционный тест: main.py в MM-режиме

- [ ] **Отключить legacy:** временно убрать токен/порт, чтобы убедиться что MM-режим работает
- [ ] Запустить: `python main.py --project=test --range=001-003 --token=SECRET`
- [ ] Проверить: браузер стартует через MM API, проект запускается, браузер стопается

### 3.5. Интеграционный тест: legacy fallback

- [ ] **Отключить MM Core** (остановить процесс)
- [ ] Запустить: `python main.py --project=test 001-003`
- [ ] Проверить: работает в legacy-режиме через accounts.py + прямой launch

---

## Этап 4: Финализация

- [ ] Убедиться, что оба скрипта Console Scripts (не GUI)
- [ ] Проверить `--help` для обоих скриптов
- [ ] Проверить логирование (читаемые сообщения)
- [ ] Удалить скрипты **только после подтверждения пользователя** (§7.3 ТЗ)
- [ ] Обновить `TS_INTEGRATION.md`: поменять статус ❌ → ✅ для ФГ
