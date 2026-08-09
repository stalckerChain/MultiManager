# TASK — Реальная унификация каталога данных MultiManager

> Переработано после верификации. Предыдущая реализация «передавать `app.getPath('userData')`»
> выполнялась формально, но `userData` Electron в dev и packaged равен `%APPDATA%\multimanager-gui`
> (имя приложения в `gui/package.json` = `multimanager-gui`), поэтому задача «всё под
> `%APPDATA%\MultiManager`» фактически не выполнялась: данные шли в `%APPDATA%\multimanager-gui`.

## Цель

Сделать единственным каталогом данных приложения канонический путь

```text
%APPDATA%\MultiManager\   (Windows)
~/Library/Application Support/MultiManager/   (macOS)
~/.config/MultiManager/   (Linux)
```

Независимо от:
- имени приложения в `package.json` (`multimanager-gui` в dev и packaged);
- способа запуска (GUI → forked core, core вручную, тесты).

Один и тот же корень для GUI и core, единая структура:

```text
<root>/app.db
<root>/logs/
<root>/logs/runs/
<root>/profiles/<profile-id>/BrowserData/
<root>/extensions/
<root>/backups/
```

## Выявленные проблемы (факты)

1. `app.getPath('userData')` сейчас = `%APPDATA%\multimanager-gui` (лог: `userData: ...\multimanager-gui`).
2. Рядных процессов стало три:
   - `%APPDATA%\multimanager-gui` — фактический рабочий корень (app.db 16:11, profiles 15:07 з 09.08);
   - `%APPDATA%\MultiManager` — fallback при ручном запуске core/тестах («Test Profile»);
   - `%APPDATA%\CloakManager` — легаси 2010; содержит старые `BrowserData` тех же 5 UUID, что и multimanager-gui.
3. Code-рефакторинг выполнен корректно: `src/core/data-dir.js`, `db`, `logger`, `profile-path`, `extensions`,
   `backup`, `crypto` (keytar `MultiManager`) — всё через единый resolver. В `src/` `CloakManager` не осталось.

## Согласованное решение

1. **Канонизация корня в GUI.** В `gui/src/main/index.js` максимально рано (до любых
   `require('./core-manager')`, `require('./tray')`, `require('./pty')`, `require('./keyboard-hooks')`,
   `require('./browser-manager')` и до `app.getPath('userData')`) выполнить:

   ```js
   const { app } = require('electron');
   const path = require('path');
   app.setPath('userData', path.join(app.getPath('appData'), 'MultiManager'));
   ```

   Все модули GUI уже читают `app.getPath('userData')` на этапе загрузки (`LOG_DIR`, env для core,
   `pty`, `tray`, keyboard-hooks) — они автоматически получат канонический корень без изменений.

2. `gui/src/main/core-manager.js` остаётся без изменений логики: он по-прежнему передаёт
   `app.getPath('userData')` в `forkEnv.MULTIMANAGER_DATA_DIR`, но теперь это канонический путь
   из шага 1. Дублирующих путей не вводить.

3. Core-резолвер `src/core/data-dir.js` менять НЕ нужно: его fallback без env уже совпадает с
   каноническим корнем (Windows: `APPDATA\MultiManager`, macOS: `~/Library/Application Support/MultiManager`,
   Linux: `~/.config/MultiManager`). При запуске через GUI env для микшированного процесса задаёт
   канонический путь — один корень в обеих ветках.

4. Легаси и перенос не выполняются (подтверждено на гейте №1):
   - `%APPDATA%\CloakManager` не переносится, не копируется, не переименовывается;
   - старые keytar-записи не ищутся;
   - старые орфанные `%APPDATA%\multimanager-gui\profiles` и `%APPDATA%\CloakManager\profiles` оставлять,
     новых данных там не создавать.

## Важное уточнение по работопу

- `app.setPath('userData', ...)` выполняется до `app.whenReady()` — это допустимо по API Electron.
- В dev и packaged вызов `app.setPath` даёт один и тот же корень, поэтому dev/продакшн и
  standalone-core (fallback) полностью совпадают по пути.

## Реализация

### Шаги

1. **`gui/src/main/app-data-dir.js`** (обязательно) — хелпер, единый источник канонического пути:
   экспортирует `canonicalUserData(app)` = `path.join(app.getPath('appData'), 'MultiManager')`.
   Имя `MultiManager` живёт в одном месте GUI; ядро использует свой `APP_NAME` в `src/core/data-dir.js`,
   чтобы два имени не расходились в будущем.

2. **`gui/src/main/index.js`** — вызвать `app.setPath('userData', canonicalUserData(app))`
   в самой верхушке файла, до подключения модулей, которые используют `app.getPath('userData')`.
   Порядок критичен: `require('./core-manager')` (и `LOG_DIR` ниже) должны выполняться после `setPath`,
   иначе `core-manager`/`tray`/`keyboard-hooks` захватят старый путь `%APPDATA%\multimanager-gui`.

3. **`gui/src/main/core-manager.js`** — без изменения. Он по-прежнему передаёт
   `app.getPath('userData')` в `forkEnv.MULTIMANAGER_DATA_DIR`; каноничность пути обеспечивается
   `setPath` до его require. Менять его возврат на `appData/MultiManager` НЕ следует.

3. **`src/core/data-dir.js`** — проверить, что fallback на Windows/macOS/Linux в точности совпадает
   с узлом `app.getPath('appData')` (т.е. путь == `%APPDATA%\MultiManager` и т.д.). Если `data-dir.js`
   считал `home`, а не `appData`, — следить, чтобы значение было идентично: на win
   `APPDATA`, на macOS `~/Library/Application Support`, на Linux `~/.config`. При несовпадении —
   приводить к общему виду (однако на остальном платформах данные соответствуют; только подтвердить).

4. **Тесты** — обновить ожидания, где они завязаны на конкретный каталог:
   - unit-тесты resolver/DB/logger/profile-path/extensions/backup — ожидания должны содержать
     `MultiManager` и не содержать `CloakManager`;
   - статический тест `gui/src/main/index.js`: прочитать файл и убедиться, что вызов
     `app.setPath('userData', canonicalUserData(app))` (или `path.join(...'MultiManager')`)
     идёт раньше `require('./core-manager')` в тексте файла, и что канонический путь строится
     через `path.join` и содержит `'MultiManager'`. Это проверка порядка, а не значения пути.
   - `tests/unit/core-manager.test.js` — проверка контракта без ложных ожиданий:
     forked core получает env `MULTIMANAGER_DATA_DIR = app.getPath('userData')` (core-manager
     передаёт userData без изменений; его эквивалентность `appData/MultiManager` проверяется
     на уровне index.js/`app-data-dir.js`, а не здесь);
   - unit-тест `gui/src/main/app-data-dir.js` (если хелпер добавлен): `canonicalUserData(app)` =
     `path.join(app.getPath('appData'), 'MultiManager')` при мокнутом `app`;
   - добавить/поддержать проверку, что `MULTIMANAGER_DATA_DIR` — абсолютный, а невалидное значение
     даёт информативный Error.

### Затрагиваемые файлы

- GUI:
  - `gui/src/main/app-data-dir.js` — новый хелпер, единый источник канонического пути (обязательно);
  - `gui/src/main/index.js` — вызов `app.setPath('userData', ...)` до require модулей, читающих userData;
  - `gui/src/main/core-manager.js` — без изменения логики (по-прежнему `app.getPath('userData')`).
- Core реализация уже выполнена и корректна: `src/core/data-dir.js`, `src/db/index.js`,
  `src/logger/index.js`, `src/core/profile-path.js`, `src/api/extensions.js`, `src/backup/index.js`,
  `src/crypto/index.js` — изменений не требует (кроме возможной сверки fallback).
- Тесты:
  - `tests/unit/data-dir.test.js`, `tests/unit/profile-path.test.js`, `tests/unit/logger.test.js`,
    `tests/unit/extensions.test.js`, `tests/unit/backup.test.js`,
    `tests/unit/keytar-service.test.js`, `tests/unit/core-manager.test.js`.

## Что не делать

- Не мигрировать, не копировать, не переименовывать, не объединять `%APPDATA%\CloakManager`.
- Не искать master key записи keytar `CloakManager`.
- Не менять схему SQLite и API-контракты.
- Не трогать внешние абсолютные `profile_path`-профили.
- Не использовать Electron API в `src/`.
- Не менять версию, changelog, release.
- Не добавлять зависимости.

## Требования к результату

1. После запуска GUI (dev и packaged) `MULTIMANAGER_DATA_DIR` и `userData` == каноническому корню
   `...\MultiManager` (Windows), без `multimanager-gui`.
2. Ни GUI, ни core не создают новых файлов в `%APPDATA%\multimanager-gui` и `%APPDATA%\CloakManager`.
3. Fallback-запуск core без env использует тот же канонический корень с именем `MultiManager`.
4. DB, logs, profiles, extensions, backups — под одним корнем.
5. Один и тот же путь в dev, packaged и standalone-режиме.

## Проверка

### Unit и статические

```text
npm test
npm run lint
```

Проверить минимум:
- resolver использует env-путь и отклоняет относительный/невалидный `MULTIMANAGER_DATA_DIR`;
- fallback содержит `MultiManager`, не содержит `CloakManager`, не содержит `multimanager-gui`;
- `profile_path` с внешним абсолютным значением не переопределяется;
- keytar использует `MultiManager`;
- core-manager передаёт канонический корень в env для forked core.

### Ручная проверка

1. Запустить GUI в dev и в packaged.
2. По логу `userData:` и строкам `CORE-MANAGER MULTIMANAGER_DATA_DIR` убедиться, что путь =
   `%APPDATA%\MultiManager` (не `multimanager-gui`).
3. Создать профиль, установить расширение, запустить браузер — убедиться, что файлы создаются
   под `%APPDATA%\MultiManager\profiles\<id>\BrowserData` и т.д.
4. Проверить, что backup и run-logs — под этим же корнем.
5. Проверить отсутствие новых файлов в `%APPDATA%\CloakManager` и `%APPDATA%\multimanager-gui`
   (обычно старые папки могут остаться от прежних запусков — но новых записей быть не должно).
6. Запустить core напрямую без GUI: fallback = `%APPDATA%\MultiManager` (Windows).

## Риски и ограничения

- Старые данные (`CloakManager`, орфанная папка `multimanager-gui\profiles`) не мигрируются — по
  решению; после перехода они перестают быть видны. Профили, чьи `BrowserData` остались в
  CloakManager, для первого запуска в новом корне создадут новые (пустые) `BrowserData` под тем же UUID.
- `app.setPath('userData')` должен стоять раньше всех, кто читает `getPath('userData')`. Пропуск этого
  порядка приведёт к частичному использованию двух корней — проверять вручную (пункт 2).
- Если не исправить — данные продолжают писаться в `multimanager-gui`, а цель `MultiManager` не достигается.

## Критерии готовности

- `gui/src/main/index.js` задаёт `app.setPath('userData', …MultiManager)` до чтения пути любым модулем.
- Во всех режимах запуска фактический корень данных — `%APPDATA%\MultiManager` (и аналоги на macOS/Linux).
- Core не создаёт новых данных ни в `CloakManager`, ни в `multimanager-gui`.
- Keytar — service `MultiManager`.
- Внешние абсолютные `profile_path` работают как раньше.
- Миграция легаси не реализована (по решению на гейте №1).
- `npm test` и `npm run lint` проходят.