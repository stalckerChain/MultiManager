# TASK — Полное удаление master-key шифрования

## Цель

Полностью удалить из приложения шифрование полей master key, master password,
keytar и связанный runtime-gate. Секретные поля профилей и прокси должны
сохраняться и читаться как обычные значения, чтобы перезапуск или
переустановка приложения не блокировали редактирование.

Существующие данные в БД не мигрировать, не расшифровывать и не удалять.
Значения, уже сохранённые в формате `aes-256-gcm:...`, остаются без изменений;
их восстановление пользователь выполняет отдельным внешним скриптом.

## Согласованные ограничения

- Не реализовывать восстановление или миграцию старых зашифрованных данных.
- Не добавлять новый механизм хранения ключей или паролей.
- Не сохранять master key, salt, hash или recovery key в БД.
- Не менять схему SQLite: существующие колонки остаются, меняется только способ
  записи и чтения значений.
- При реализации изменить версию приложения на `1.5.0` в `package.json` и
  связанных version-файлах проекта; автоматический bump не использовать.
- Не логировать значения секретных полей.
- Удалить crypto-flow из production-кода, тестов, интерфейса, API-документации
  и ТЗ.
- Исторические записи в `CHANGELOG.md` не переписывать; при необходимости
  добавить отдельную запись о новом поведении, не искажая историю релизов.

## Текущее поведение и причина изменения

- `src/index.js` асинхронно инициализирует master key при запуске.
- `src/core/app.js` блокирует mutating-запросы без активного master key.
- `src/db/queries.js` шифрует и расшифровывает секреты профилей и прокси.
- `src/api/settings.js` хранит настройки master password, salt/hash и recovery
  key и предоставляет crypto endpoints.
- `gui/src/renderer/views/Settings.vue` показывает crypto status и формы
  установки/смены пароля.
- После перезапуска password-mode ключ отсутствует в RAM, endpoint разблокировки
  отсутствует, а записи блокируются; это и есть устраняемая причина проблемы.

## План реализации

### 1. Удалить crypto runtime

- Удалить `src/crypto/index.js`, если после удаления всех импортов он больше не
  используется.
- Удалить вызов `initMasterKey()` и проверки `hasMasterKey()` из
  `src/index.js`.
- Удалить `requireMasterKey` и его подключение к routers из
  `src/core/app.js`.
- Удалить crypto-импорт из `src/api/browser.js`, если он не используется после
  изменения контракта.
- Удалить `keytar` из `package.json` и корневого `package-lock.json`.

### 2. Перевести DB queries на plaintext

В `src/db/queries.js`:

- удалить импорты `encrypt`, `decrypt`, `decryptRow`, `decryptRows`,
  `SECRET_FIELDS`, `hasMasterKey` и `getMasterKey`;
- убрать `encryptProfileFields`, `decryptRowSafe` и связанные crypto-ветки;
- записывать поля профилей напрямую в существующие колонки;
- возвращать поля профиля напрямую без расшифровки;
- убрать `encryptProxyFields`, `decryptProxyRow` и `decryptProxyRows`;
- записывать и возвращать `proxies.username` и `proxies.password` напрямую;
- сохранить текущие query API, связи профилей с прокси, update/delete поведение
  и SQL-структуру.

Старые ciphertext-строки при этом не преобразовывать: query-слой будет отдавать
их как обычные строки до внешнего восстановления.

### 3. Удалить crypto endpoints и настройки

В `src/api/settings.js`:

- убрать crypto-импорты;
- удалить `GET /api/settings/crypto-status`;
- удалить `POST /api/settings/recovery-key`;
- удалить `POST /api/settings/set-master-password`;
- удалить `POST /api/settings/change-master-password`;
- не добавлять заменяющий endpoint;
- не удалять произвольные ключи из `system_config` автоматически, чтобы не
  затронуть данные пользователя.

Проверить все callers этих endpoint в GUI и тестах до удаления.

### 4. Удалить crypto UI

В `gui/src/renderer/views/Settings.vue`:

- удалить security card, статус keytar/master password и recovery key;
- удалить модальные окна установки и смены пароля;
- удалить состояние, функции запросов и обработчики crypto status/recovery;
- удалить связанные i18n-ключи из `en.json`, `ru.json`, `zh.json`;
- не оставлять хардкодированных упоминаний шифрования или master password.

Остальные настройки и разделы Settings не менять.

### 5. Обновить тесты

- Удалить `tests/unit/crypto.test.js` как тест устранённого модуля.
- Удалить `tests/unit/keytar-service.test.js`.
- Обновить `tests/integration/api-real.test.js`: убрать ручную установку
  master key и ожидания crypto gate.
- Обновить `tests/unit/settings-token.test.js`: удалить проверки
  `/api/settings/crypto-status`.
- Найти и обновить все оставшиеся импорты и ожидания `hasMasterKey`, `setMasterKey`,
  `encrypt`, `decrypt`, `rotateKey`, keytar и master password.
- Добавить или обновить проверки, что создание, чтение и изменение профиля и
  прокси не требуют runtime master key и передают username/password без
  преобразования.
- Не добавлять тесты миграции старых ciphertext: миграция явно исключена из
  задачи.

### 6. Обновить документацию и ТЗ

Убрать описание crypto-flow, master password, keytar, recovery key,
зашифрованных полей и master-key gate из актуальных разделов:

- `docs/API.md`
- `docs/API.en.md`
- `docs/API.zh.md`
- `docs/DATABASE.md`
- `docs/DATABASE.en.md`
- `docs/DATABASE.zh.md`
- `docs/DEPLOY.md`
- `docs/AGENTS_COMMON.md`
- `TS.md`
- `TS_INTEGRATION.md` (включая crypto-flow, например раздел со строки 478)

Отдельно удалить ошибочный legacy-default `asdfj*KK` для `wallet_password` из
документации и ТЗ, как минимум из:

- `docs/DATABASE.md`
- `docs/DATABASE.en.md`
- `docs/DATABASE.zh.md`
- `TS.md`
- `TS_INTEGRATION.md`

После правок выполнить поиск по всему репозиторию и убедиться, что строка
`asdfj*KK` нигде не осталась. Для незаполненного `wallet_password` указывать
пустое значение/`NULL`; новый пароль по умолчанию не добавлять.

Обновить описание полей профилей и прокси как обычных `TEXT`-значений и явно
зафиксировать отсутствие миграции старых зашифрованных значений.

Исторические crypto-записи в `CHANGELOG.md` не удалять и не переписывать.

## Затрагиваемые файлы

### Backend и зависимости

```text
src/crypto/index.js
src/index.js
src/core/app.js
src/api/settings.js
src/api/browser.js
src/db/queries.js
package.json
package-lock.json
```

### GUI

```text
gui/src/renderer/views/Settings.vue
```

### Тесты

```text
tests/unit/crypto.test.js
tests/unit/keytar-service.test.js
tests/unit/settings-token.test.js
tests/integration/api-real.test.js
```

Дополнительные файлы добавлять только если поиск callers покажет фактическую
зависимость.

### Документация и ТЗ

```text
docs/DATABASE.md
docs/DATABASE.en.md
docs/DATABASE.zh.md
docs/API.md
docs/API.en.md
docs/API.zh.md
docs/DEPLOY.md
docs/AGENTS_COMMON.md
TS.md
TS_INTEGRATION.md
```

## Риски

- Любой процесс, имеющий доступ к файлу БД, сможет прочитать секреты.
- API больше не будет требовать master-key gate; доступ по-прежнему должен
  контролироваться существующей локальной auth-моделью и API token.
- Уже зашифрованные значения не станут plaintext автоматически и будут
  выглядеть как обычные ciphertext-строки до внешнего восстановления.
- Удаление `keytar` из зависимостей может требовать обновления lock-файла без
  ручного изменения версий проекта.
- Удаление crypto-модуля затрагивает security-модель, поэтому после реализации
  нужно проверить отсутствие оставшихся импортов и документации о старом
  поведении.

## Проверка

Из корня проекта:

```text
npm test
npm run lint
```

Сборка GUI:

```text
cd gui && npm run build
```

Обязательные проверки:

1. Поиск по репозиторию не находит production-использований `hasMasterKey`,
   `initMasterKey`, `setMasterKey`, `rotateKey`, `encrypt`, `decrypt`, keytar,
   master password и recovery key, кроме явно исторических записей changelog.
2. Поиск по репозиторию не находит `asdfj*KK`.
3. Backend стартует без keytar и без crypto initialization.
4. GET/POST/PUT/DELETE операции профилей и прокси не получают ошибку
   `MASTER_KEY_NOT_READY`.
5. Новые значения секретных полей профиля сохраняются в БД без AES-префикса.
6. Новые `username` и `password` прокси сохраняются без AES-префикса и
   возвращаются без расшифровки.
7. После полного перезапуска backend редактирование профилей и прокси работает
   без ввода master password.
8. Settings не содержит элементов master password, keytar, recovery key или
   crypto status.
9. Существующие ciphertext-значения не изменяются автоматически.
10. Версия приложения установлена в `1.5.0`.
11. Не затронуты API token, WebSocket token, локальный bind `127.0.0.1`, связи
   профилей с прокси и схема БД.

## Критерии готовности

- Master-key encryption полностью удалено из runtime-кода.
- Master password, keytar и recovery key удалены из GUI и актуальной
  документации/ТЗ.
- Mutating API профилей, прокси и cookies не зависит от master key.
- Новые секретные значения профилей и прокси сохраняются plaintext.
- Существующая БД не мигрируется и не изменяется автоматически.
- Тесты и GUI build проходят.
- После перезапуска приложение позволяет редактировать профили и прокси без
  повторной установки пароля.
