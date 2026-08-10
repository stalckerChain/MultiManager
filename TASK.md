# TASK — Browser Lifecycle, Documentation and Electron Updates

## Цель

Синхронизировать документацию с текущим поведением API-токена, сделать запуск CloakBrowser корректным при асинхронных ошибках и подтверждённой готовности CDP, а также полностью убрать автоматическое обновление Electron-приложения MultiManager.

Автоматическое обновление Electron не является частью production-функциональности: приложение запускается без updater, не проверяет update-серверы, не скачивает и не устанавливает новые версии. Обновление MultiManager выполняется только вручную пользователем.

## Согласованное решение

### 1. Документация API-токена

Фактическая логика в `src/index.js` использует `resolveToken()`:

1. `--api-token=...`;
2. `API_TOKEN`;
3. сохранённый `system_config.api_token`;
4. генерация нового токена только если сохранённого значения нет.

README сделать кратким: убрать устаревшее утверждение «токен генерируется при старте», явно описать постоянное хранение и отдельно указать ручной standalone-запуск через `API_TOKEN` как override.

### 2. Browser lifecycle

Целевой переход статусов:

```text
starting → process alive → CDP ready → running
```

Профиль не должен получать `running` до обнаружения CDP-порта. При ошибке запуска, смерти процесса или таймауте CDP запуск считается неуспешным и профиль возвращается в `stopped`.

Retry на `ERR_ADDRESS_IN_USE` должен работать через фактический асинхронный `child.on('error')`, а не только через `try/catch` вокруг `spawn()`. Для каждой попытки необходимо корректно обработать завершение/ошибку child process, не оставить лишние listeners и не зарегистрировать профиль как running до успеха.

Парсер CDP должен работать по накопленному stderr-буферу, чтобы строка `DevTools listening...` корректно находилась при разбиении между несколькими data-чантами.

### 3. Проверка внешнего CloakBrowser

Добавить opt-in интеграционный тест, который при наличии установленного CloakBrowser:

1. запускает реальный бинарник;
2. получает CDP-порт;
3. подключается к CDP;
4. получает target;
5. открывает и закрывает страницу;
6. корректно останавливает браузер и проверяет отсутствие оставшегося процесса.

Без бинарника тест не должен ломать обычный `npm test`. Реальный сценарий включается только при `CLOAKBROWSER_INTEGRATION_TEST=1`; путь к бинарнику берётся из `CLOAKBROWSER_PATH`, а если переменная не задана — используется существующий resolver CloakBrowser.

### 4. Полное удаление Electron updater

Удалить весь runtime lifecycle `electron-updater`:

- не импортировать `electron-updater` и `autoUpdater`;
- не вызывать `checkForUpdates()` при старте или в любой другой момент;
- не загружать обновления;
- не устанавливать обновления при выходе (`autoInstallOnAppQuit`);
- убрать update-события из preload, если они больше не используются;
- удалить неиспользуемый `gui/src/main/updater.js`;
- удалить зависимость `electron-updater` и обновить `gui/package-lock.json`;
- проверить `gui/package.json` и electron-builder configuration на отсутствие runtime-настроек, инициирующих auto-update;
- не менять отдельный механизм установки/обновления CloakBrowser.

Публикация release-артефактов и ручная сборка не должны трактоваться как runtime auto-update. Production-проверка должна использовать сборку без публикации (`--publish never`) и подтвердить отсутствие сетевых обращений updater при старте.

## Затрагиваемые файлы

### Основная реализация

- `src/api/browser.js` — асинхронный retry, lifecycle listeners, CDP-ready transition, накопление stderr.
- `gui/src/main/index.js` — убрать импорт и вызов updater.
- `gui/src/main/updater.js` — удалить.
- `gui/src/preload/index.js` — убрать неиспользуемые `onUpdateAvailable` и `onUpdateDownloaded`.
- `gui/package.json` — удалить `electron-updater`; проверить build-конфигурацию.
- `gui/package-lock.json` — обновить lock-файл после удаления зависимости.

### Тесты

- `tests/unit/browser-start-await.test.js` — тесты async spawn error, retry и статусов.
- `tests/unit/cdp-port-capture.test.js` — тесты split stderr и фактического накопленного буфера.
- `tests/unit/browser-cleanup.test.js` — тесты очистки `runningProfiles`, `profileWindows`, `cdpPorts` и lifecycle listeners после error, exit и stop; если отдельный файл не нужен, расширить `browser-start-await.test.js`.
- новый opt-in integration test рядом с browser lifecycle integration-тестами, предпочтительно `tests/integration/profile-launch.test.js` при возможности расширения существующего сценария; отдельный файл допустим, если изоляция процесса требует этого.
- при необходимости отдельный unit-тест отсутствия updater lifecycle в `gui/src/main/index.js`/preload, без запуска Electron в обычном unit-окружении.

### Документация

- `README.md` — краткая актуальная документация без устаревшего changelog-полотна, с правильным token behavior, ручным запуском и отсутствием Electron auto-update.
- `README.en.md` — синхронизировать краткую английскую версию.
- `README.zh.md` — синхронизировать краткую китайскую версию.
- `gui/README.md` — убрать updater из структуры и описания.
- `gui/README.md:14` — удалить упоминание `gui/src/main/updater.js` из дерева файлов.
- `docs/DEPLOY.md` — заменить раздел auto-update на ручные обновления Electron и сборку без публикации; сохранить отдельно инструкции CloakBrowser.
- `docs/CICD.md` — убрать runtime auto-updater workflow, оставить ручной build/release process.
- `TS.md` — изменить пункт 10.5 с «реализовано» на отсутствие автоматического обновления Electron.

`CHANGELOG.md` и версии в `package.json` не менять без отдельного указания пользователя.

## Что не делать

- Не менять API-контракт токена и схему БД.
- Не ротировать и не удалять сохранённый API-токен.
- Не объявлять `running` до CDP-ready.
- Не реализовывать retry на основании только текста stderr без подтверждённого child error/exit сценария.
- Не менять CloakBrowser installer/update mechanism.
- Не добавлять новую зависимость.
- Не включать реальные внешние browser tests в обязательный обычный unit-прогон без явного opt-in.
- Не добавлять update provider или ручную кнопку обновления Electron.
- Не менять номер версии проекта.

## Проверка

### Unit и статические проверки

```text
npm test
npm run lint
```

Проверить поиском по репозиторию отсутствие runtime-использований:

```text
autoUpdater
checkForUpdates
autoInstallOnAppQuit
electron-updater
update-available
update-downloaded
```

Допускаются только исторические упоминания, если они явно описывают удалённый механизм; предпочтительно удалить устаревшие runtime-ссылки полностью.

### GUI build

```text
cd gui
npm run build -- --publish never
```

Убедиться, что production-приложение запускается без `updater.js` и без сетевых запросов к update-серверу. На чистой машине или в чистом профиле пользователя:

1. Запустить собранное приложение с Process Monitor (фильтр по процессу MultiManager/Electron) либо системным сетевым монитором.
2. Зафиксировать сетевые подключения и DNS/HTTP(S)-запросы за время запуска и базовой работы GUI.
3. Убедиться, что отсутствуют обращения к GitHub Releases, `latest.yml`, update provider или иному update-серверу.
4. Проверить, что приложение работает на установленной версии и не создаёт updater/update service.

Сборку выполнять с `--publish never`; механизм обновления CloakBrowser проверять отдельно и из этой проверки исключить.

### Browser lifecycle

Проверить unit-тестами:

1. асинхронный `error` от `spawn` с retry;
2. отсутствие retry для нерелевантной ошибки;
3. переход `starting` в `running` только после CDP-порта;
4. возврат в `stopped` при spawn error, exit и CDP timeout;
5. CDP marker, разделённый между stderr-чантами;
6. очистку maps и listeners после остановки.

Запустить opt-in реальный тест только в окружении с установленным CloakBrowser и убедиться, что процесс закрывается даже при падении промежуточного шага.

### Документация

Проверить, что краткие README во всех поддерживаемых языках:

- не говорят, что token генерируется при каждом старте;
- описывают сохранённый token и ручной override;
- не обещают автоматическое обновление Electron;
- отделяют ручное обновление MultiManager от обновления CloakBrowser.

## Риски

- Перенос `running` после CDP-ready может увеличить время ответа start до 15 секунд, но устраняет ложный статус.
- Событие `error` у `ChildProcess` асинхронное; необходимо не допустить двойной cleanup при последовательности `error` и `exit`.
- Внешний CloakBrowser является нестабильной интеграционной зависимостью и требует opt-in окружения.
- Удаление updater изменяет ожидаемое поведение ранее опубликованных GUI-сборок, что соответствует явно согласованной новой production-концепции.
- Сокращение README может удалить исторический контекст; актуальные эксплуатационные сведения должны сохраниться в `docs/DEPLOY.md` и `docs/CICD.md`.

## Критерии готовности

- Документация отражает persistent API token и корректный standalone override.
- `running` публикуется только после CDP-ready.
- Retry реально обрабатывает асинхронный child error и не ломает cleanup.
- CDP marker корректно ловится при split stderr chunks.
- Unit-тесты и lint проходят.
- Opt-in CloakBrowser lifecycle test проходит в окружении с бинарником.
- Electron GUI не импортирует updater, не делает update checks, не скачивает и не устанавливает обновления.
- `electron-updater` удалён из GUI runtime dependencies и lock-файла.
- Production GUI build проходит с `--publish never`.
- CloakBrowser update/install behavior не изменён.
