# TASK — Внешние пути к профилям браузера (stAuto0 import)

## Описание

Сейчас MM детерминированно вычисляет путь к user-data-dir браузера через `getProfileDir(profileId)` (%APPDATA%\CloakManager\profiles\<id>). Не требуется возможность использовать произвольный (внешний) путь к профилю — например, при импорте аккаунтов из stAuto0. Цель: в БД хранится абсолютный `profile_path`; если задан — MM запускает браузер/cookies/cache по внешнему пути, иначе — по стандартному (гибридный режим). Заодно унифицируем расхождение cookie-путей (inject.js пишет в `<MMdir>/<id>/Default/Cookies`, а браузер стартует из `<MMdir>/<id>/BrowserData`).

## Требования

- Гибридный режим: `profile_path IS NULL` → стандартное место MM; не NULL → абсолютный внешний путь.
- `profile_path` валидируется как абсолютный (reject относительных и path traversal `..`).
- Запуск браузера, cookie-инжект/export, чистка кэша, secure prefs — все используют единый helper для user-data-dir.
- Унификация cookie-пути: cookies лежат в `<user_data_dir>/Default/Cookies` (для default-профилей MM это перенос с текущего места `<MMdir>/<id>/Default/Cookies` в `<MMdir>/<id>/BrowserData/Default/Cookies`).
- API и GUI позволяют задавать/редактировать `profile_path`.
- stAuto0 `migrate_to_sqlite.py` отдаёт `profile_path` (абсолютный), копирование профилей (`migrate_profile_dirs.py`) больше не требуется.

## План реализации

### Шаг 1. Схема БД и миграция

**Файлы:** `src/db/schema.js`

1.1. В `createSchema` добавить колонку `profile_path TEXT` в таблицу `profiles` (nullable).

1.2. В блок `runMigrations` (или существующий `existing columns`-блок) добавить миграцию `ALTER TABLE profiles ADD COLUMN profile_path TEXT` (if not exists).

1.3. Добавить one-time data migration (через `system_config` ключ `cookies_path_unified_v1`):
- Для каждого существующего профиля MM:
  - src = `<getDefaultProfileDir(id)>/Default/Cookies`
  - dst_dir = `<getDefaultProfileDir(id)>/BrowserData/Default`
  - dst = `<dst_dir>/Cookies`
  - Если src существует и dst не существует: создать dst_dir, переместить файл (atomic rename), при ошибке — лог warning и continue (не падать).
- Пометить в `system_config` ключ `cookies_path_unified_v1 = '1'`.

1.4. Тест схемы: `tests/unit/schema.test.js` — проверить, что колонка `profile_path` существует после миграции; ключ `cookies_path_unified_v1` установлен; повторный запуск миграции не дублирует.

**Проверка:** `npm test` (юнит-тесты схемы).

---

### Шаг 2. Helper пользовательского пути

**Файлы:** `src/core/profile-path.js` (новый), `tests/unit/profile-path.test.js` (новый)

2.1. Создать `src/core/profile-path.js`:
- `getDefaultProfileDir(profileId)` — детерминированный путь (логика из `cookie/inject.js:getProfileDir`, без `BrowserData`): `%APPDATA%\CloakManager\profiles\<id>`.
- `getBrowserDataDir(profile)` — объект профиля из БД:
  - Если `profile.profile_path` задан и не пустой: `path.resolve(profile.profile_path)` (нормализация).
  - Иначе: `path.join(getDefaultProfileDir(profile.id), 'BrowserData')`.
- `validateProfilePath(p)` — валидация:
  - `path.isAbsolute(p)` → иначе throw `new Error('profile_path must be absolute')`.
  - Не содержит `..` сегментов после `path.normalize` → иначе throw.
  - Длина ≤ 1024.
- `getDefaultCookiesFile(profile)` → `path.join(getBrowserDataDir(profile), 'Default', 'Cookies')`.
- `getDefaultProfileDir` экспортируем для legacy-кодов (tests, migration).

2.2. Тесты `tests/unit/profile-path.test.js`:
- `getBrowserDataDir` default → `%APPDATA%\CloakManager\profiles\<id>\BrowserData`.
- `getBrowserDataDir` external → равно `path.resolve(profile_path)`.
- `validateProfilePath` принимает абсолютный, rejects относительный и `..`.
- `getDefaultCookiesFile` → правильный путь для обоих режимов.

**Проверка:** `npm test`.

---

### Шаг 3. Унификация cookie-инжекта

**Файлы:** `src/cookie/inject.js`, `tests/unit/inject.test.js` (новый или расширить)

3.1. Переписать `injectCookies(profileId)`:
- Получать профиль из БД (`createProfileQueries(getDatabase()).getById(profileId)`).
- Использовать `getBrowserDataDir(profile)` из `src/core/profile-path.js` для каталога профиля.
- Cookies пишем в `<user_data_dir>/Default/Cookies`.
- `ensureDir` для `<user_data_dir>/Default`.

3.2. Переписать `exportCookies(profileId)` — читать из того же пути из `getBrowserDataDir`.

3.3. `getProfileDir` оставить как thin wrapper для legacy (используется в `browser.js` в чистках — заменится в шаге 4).

3.4. Тесты `tests/unit/inject.test.js`:
- Mock БД с профилем без `profile_path` → cookies пишутся в `<MMdir>/<id>/BrowserData/Default/Cookies`.
- Mock БД с профилем с `profile_path` → cookies пишутся по внешнему пути.
- Export читает из того же пути.

**Проверка:** `npm test`.

---

### Шаг 4. browser.js использует helper

**Файлы:** `src/api/browser.js`

4.1. Импортировать `getBrowserDataDir` из `src/core/profile-path.js` (вместо `getProfileDir`).

4.2. `POST /:id/start` (~строка 314):
- `const profileDir = getProfileDir(req.params.id)` → `const userDataDir = getBrowserDataDir(profile)` (профиль уже получен выше ~234).
- `user_data_dir = path.join(profileDir, 'BrowserData')` → `user_data_dir = userDataDir`.
- Парс расширений через тот же `user_data_dir`.

4.3. `POST /:id/clean` (~553):
- `profileDir = getBrowserDataDir(profile)`.
- `cacheDirs = ['Cache', 'Code Cache', 'GPUCache']` (без `BrowserData/` префикса, т.к. уже в user-data-dir).

4.4. `POST /:id/zerion-login` и secure prefs (~784):
- `securePrefsPath = path.join(getBrowserDataDir(profile), 'Default', 'Secure Preferences')`.

4.5. Если где-то ещё `getProfileDir` — заменить.

4.6. Расширения по CDP (`loadExtensionsViaCDP`) — не зависит от пути профиля, не трогаем.

**Проверка:** `npm test`;手动 — запуск профиля без `profile_path` и с `profile_path` через curl.

---

### Шаг 5. API: валидация и queries

**Файлы:** `src/api/validate.js`, `src/db/queries.js`, `tests/unit/validate.test.js`

5.1. `validate.js`:
- `profileCreateSchema`: добавить `profile_path: z.string().max(1024).nullable().optional().refine(v => !v || path.isAbsolute(v), 'profile_path must be absolute')`.
- `profileUpdateSchema`: то же.
- `profileBatchSchema.accounts[]`: то же.
- Импорт `path` в `validate.js`.

5.2. `src/db/queries.js`: `createProfileQueries`:
- `insert` prepare — добавить `profile_path` в список колонок + `?` placeholder.
- `create(data)` — передать `enc.profile_path || null`.
- `update` prepare — добавить `profile_path = COALESCE(?, profile_path)` (NULL сохраняет старое значение; для обнуления используем отдельный путь через PUT с явным null + тест) — решение: вUPDATE используем `profile_path = ?` (прямое присваивание с nullable), не COALESCE.

5.3. Batch create (`src/api/profiles.js:33`) — проксирует поля через схему, данные попадают в queries.

5.4. Тесты `tests/unit/validate.test.js`:
- create с относительным `profile_path` → ошибка валидации.
- create с абсолютным → ok.
- update с NULL → ok (сбрасывает).

**Проверка:** `npm test`.

---

### Шаг 6. GUI: форма профиля

**Файлы:** `gui/src/renderer/views/ProfileModal.vue`, i18n-файлы (`gui/src/renderer/locales/*.js` или `*.json`)

6.1. В `ProfileModal.vue`:
- В `model` добавить `profile_path: ''`.
- В `loadProfile(p)` добавить `profile_path: p.profile_path || ''`.
- В `resetForm` добавить `profile_path: ''`.
- В шаблон добавить `a-input` с label «Путь к профилю браузера (внешний)» и placeholder «пусто = стандартное место MultiManager».
- Подсказка: «Абсолютный путь к user-data-dir. Для импортированных из stAuto0 профилей.».

6.2. i18n: добавить ключи `profile.profilePath`, `profile.profilePathPlaceholder`, `profile.profilePathHint` в русскую и английскую локали.

6.3. (Опц.) тэг «внешний» в таблице профилей при `profile_path`.

**Проверка:** `cd gui && npm run lint` (если есть); ручная — форма сохраняет и отдаёт путь.

---

### Шаг 7. stAuto0 migrate_to_sqlite.py

**Файлы:** `stAuto0/scripts/migrate_to_sqlite.py`

7.1. В payload (цикл `for account in filtered`) добавить:
```python
"profile_path": str(Path(BASE_DIR) / "config" / "chrome_accounts" / account["profile_directory"]),
```
(с `from pathlib import Path` и `BASE_DIR` уже есть).

7.2. Добавить `--no-copy` флаг (по умолчанию True) — лог-сообщение: «Профили не копируются — MM использует внешние пути».

7.3. Обновить помощь: «Теперь migrate_profile_dirs.py не требуется».

7.4. Не менять `migrate_profile_dirs.py` (оставить как есть, но в логе предупредить о ненужности).

**Проверка:** ручная — запуск миграции, проверить в БД MM `profile_path` заполнен.

---

### Шаг 8. Тесты (итог)

8.1. `npm test` — все unit тесты проходят.

8.2. Покрытие:
- Миграция схемы (шаг 1.4).
- Helper путей (шаг 2.2).
- Cookie inject/export (шаг 3.4).
- Валидация API profile_path (шаг 5.4).
- (интеграционные — по желанию, требуют запущенный бэкенд).

---

### Шаг 8.1. Сборка

8.3. `npm test` зелёный → `npm run lint` → `npm run bump` ТОЛЬКО по явному запросу пользователя.

8.4. `cd gui && npm run build` — сборка GUI.

8.5. `npm run build:native` (hooks.node) — если задели native hooks (не должны).

8.6. Portable + installer — через существующий build-скрипт (см. `docs/DEPLOY.md`).

---

### Шаг 9. Гейт №3 — проверка пользователем

Пользователь проверяет:
- Импорт аккаунтов stAuto0 → в MM видны профили с заполненным `profile_path`.
- Запуск браузера по внешнему профилю — стартует на данных stAuto0 (куки/сессии сохранены).
- Запуск стандартного MM-профиля (без `profile_path`) — работает как раньше.
- Cookie inject/export — работает для обоих режимов.
- Чистка кэша — работает для обоих.
- Форма GUI — сохраняет `profile_path`.

---

### Шаг 10. Финализация

10.1. `docs/API.md` — добавить `profile_path` в поля профилей (create/update/batch).

10.2. `docs/DATABASE.md` — колонка `profiles.profile_path`, миграция `cookies_path_unified_v1`.

10.3. `README.md` — раздел «Что нового» (внешние пути профилей).

10.4. `CHANGELOG.md` — запись.

10.5. `TS.md` — если меняет архитектуру (внешний путь = новая возможность запуска).

10.6. Коммит: `feat(api): support external browser profile paths for stAuto0 import`.

---

## Гейты

- **Гейт №1 (Шаг 4):** согласование решения — пройдено («дальше»).
- **Гейт №2 (Шаг 6):** согласование плана — ТЕКУЩИЙ. Ждём «продолжай флоу».
- **Гейт №3 (Шаг 9):** проверка сборки пользователем.