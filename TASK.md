# TASK — Динамический ID расширения Zerion для init_wallet4browser

## Цель

Изменить запуск `stAuto0/scripts/init_wallet4browser.py`, чтобы URL страницы импорта кошелька строился с актуальным runtime ID расширения Zerion, полученным из MultiManager для конкретного профиля.

Если endpoint MultiManager недоступен, запрос завершился ошибкой или ответ не содержит валидный ID расширения, скрипт должен использовать встроенный fallback ID:

```text
klghhnkeealcohjjanjjdaeeggmfmlpl
```

Текущий fallback сохраняется для совместимости с автономным/старым окружением.

## Наблюдаемая проблема

`stAuto0/scripts/init_wallet4browser.py` импортирует `ZERION_ID` из `Core.browser` и формирует `WALLET_URL` на уровне модуля. `Core.browser` использует устаревший ID как fallback.

MultiManager уже умеет вычислять настоящий runtime ID через `resolveRuntimeId()` с учетом `Secure Preferences` конкретного профиля и `manifest.key`. Это значение уже используется в автоматическом executor-потоке и в endpoint `zerion-login`, но ручной скрипт инициализации кошелька его не запрашивают.

## Архитектурное решение

Добавить в authenticated internal API MultiManager endpoint:

```text
GET /api/internal/profiles/:id/zerion-extension
```

Успешный ответ:

```json
{
  "id": "abcdefghijklmnopabcdefghijklmnop"
}
```

В текущей конфигурации MultiManager профилю назначается ровно одно расширение — Zerion. Endpoint должен использовать существующую простую схему `profile.extensions[0]`, как текущие `POST /api/browser/:id/zerion-login` и executor. Поиск по manifest/name, i18n-разрешение, перебор нескольких каталогов и новый helper не нужны.

1. Найти профиль по UUID.
2. Найти первое назначенное расширение. Поле `profile.extensions` хранится как JSON-строка с массивом имен каталогов. Не импортировать локальный `tryParseJson()` из `src/api/browser.js`: он не экспортируется. Использовать `JSON.parse(profile.extensions || '[]')` внутри `try-catch` и взять только `extIds[0]`.
3. Если JSON невалиден, список пуст, первый элемент отсутствует или не является строкой, вернуть `badRequest(...)`.
4. Построить `extPath = path.join(getExtensionsDir(), extIds[0])` без чтения manifest и дополнительных проверок имени расширения. `extIds[0]` — только имя каталога, его нельзя возвращать как runtime ID.
5. Определить профильный browser data directory.
6. Вызвать `resolveRuntimeId(extPath, profileDir)`.
7. Проверить, что результат соответствует Chrome extension ID: ровно 32 строчных символа `a-z`.
8. Вернуть `{ id }`.

Критически важно сохранить существующий `resolveRuntimeId()` без изменений: он сначала ищет ID по точному пути расширения в `Default/Secure Preferences`, затем вычисляет runtime ID из `manifest.key`. Для текущего расширения имя каталога `klghhnkeealcohjjanjjdaeeggmfmlpl` не является runtime ID; endpoint должен вернуть результат resolver (текущий ожидаемый runtime ID — `lfoeajgcchlidpicbabpmckkejpckcfb`), а не имя каталога.

Существующий алгоритм `resolveRuntimeId()` не дублировать и не заменять.

В `stAuto0` клиент должен запрашивать ID для каждого конкретного профиля после получения списка профилей и до открытия страницы кошелька. `profile_id` уже сохраняется в нормализованном аккаунте через `MultiManagerClient.normalize_account()` и доступен как `account["profile_id"]`. URL не должен оставаться глобальной константой, зависящей от значения, полученного при импорте модуля.

Логика выбора ID:

1. Начать с встроенного fallback ID.
2. Запросить новый endpoint с коротким timeout.
3. При успешном ответе и валидном `id` использовать полученное значение.
4. При недоступности MM, timeout, сетевой ошибке, HTTP-ошибке или невалидном ответе записать предупреждение без секретов и использовать fallback.
5. Сформировать URL импорта кошелька только после выбора ID.

Fallback не должен менять существующий API и не должен мешать автономному запуску stAuto0.

## Затрагиваемые файлы

### MultiManager

- `src/api/internal.js`
  - добавить endpoint для runtime ID конкретного профиля;
  - использовать `extIds[0]` как единственное назначенное расширение;
  - явно импортировать `getExtensionsDir` и `resolveRuntimeId` из `./extensions`;
  - импортировать `getBrowserDataDir` из общего модуля `../core/profile-path` (не импортировать его из `./browser`, чтобы не создавать зависимость internal API от browser router);
  - импортировать `asyncHandler` и фабрики `notFound`, `badRequest`, `serverError` из `./errors`;
  - обернуть async handler в `asyncHandler`, чтобы ошибки `resolveRuntimeId()` корректно передавались в общий обработчик ошибок;
  - использовать существующие profile queries, `getExtensionsDir()`, `getBrowserDataDir()` и `resolveRuntimeId()`;
  - возвращать точные HTTP-статусы:
    - `notFound('Профиль')` / `404` — профиль не найден;
    - `badRequest(...)` / `400` — расширение не назначено профилю;
    - `badRequest(...)` / `400` — runtime ID не определяется;
    - `badRequest(...)` / `400` — runtime ID не прошел проверку формата;
  - после `resolveRuntimeId()` валидировать ID на сервере регулярным выражением `/^[a-z]{32}$/`; `resolveRuntimeId()` сам формат не валидирует;
  - обернуть вызов `resolveRuntimeId()` в `try-catch`: ошибки входных данных возвращать как `badRequest(...)` / `400`, неожиданные filesystem/runtime ошибки — как `serverError(...)` / `500` без stack trace и секретов;
  - не логировать токены, wallet password или proxy credentials.

- `src/api/browser.js` и `src/executor/index.js`
  - не менять существующее использование `extIds[0]`;
  - сохранить текущий API, security-поведение и передачу `ZERION_ID` в executor.

- `tests/unit/internal-profiles.test.js` или отдельный unit-тест internal API
 - успешное разрешение ID;
  - профиль не найден;
  - расширение не назначено;
  - невалидный JSON в `profile.extensions`;
  - пустой массив `profile.extensions`;
  - первый элемент `profile.extensions` не является строкой;
  - runtime ID не определяется;
  - регрессия: при каталоге `klghhnkeealcohjjanjjdaeeggmfmlpl` ответом является runtime ID из `Secure Preferences`/`manifest.key`, а не имя каталога;
  - исключение `resolveRuntimeId()` и unexpected filesystem error;
  - проверка формата ответа;
  - мокать `profileQueries.getById()`;
  - мокать `getExtensionsDir()`;
  - мокать `getBrowserDataDir()`;
  - мокать `resolveRuntimeId()`.

- `tests/unit/browser-start-await.test.js` и `tests/unit/executor.test.js`
  - убедиться, что существующие потребители продолжают использовать первое назначенное расширение и не требуют нового helper.

- `docs/API.md`
  - описать новый endpoint, параметры, ответ и основные ошибки.

- `docs/API.en.md` и `docs/API.zh.md`
  - также описать новый endpoint, чтобы документация API была синхронизирована во всех существующих языковых версиях.

### stAuto0

`stAuto0` — внешний проект в `C:\Users\stalcker\AI\stAuto0`, отдельный git-репозиторий и не часть рабочего дерева MultiManager. Изменения в перечисленных ниже файлах выполняются разработчиком отдельно в этом репозитории; в MultiManager PR/ревью проверяется только API-контракт и серверная часть, а проверка Python-клиента требует доступа к внешнему репозиторию.

- `C:\Users\stalcker\AI\stAuto0\Core\multimanager.py`
  - добавить метод `get_zerion_extension_id(profile_id)` с Bearer-auth и `aiohttp.ClientTimeout(total=3)`;
  - проверять HTTP-статус и формат JSON;
  - не логировать token или содержимое учетных данных.

- `C:\Users\stalcker\AI\stAuto0\scripts\init_wallet4browser.py`
  - убрать формирование `WALLET_URL` на уровне модуля из статического `ZERION_ID`;
  - получить runtime ID через `MultiManagerClient` для текущего `profile_id`;
  - применить fallback при недоступности endpoint или невалидном ответе;
  - формировать URL внутри `init_wallet()` перед `page.goto()`;
  - сохранить текущую последовательность импорта mnemonic и закрытия браузера.

- `C:\Users\stalcker\AI\stAuto0\tests\test_multimanager.py`
  - тест успешного запроса ID;
  - тест HTTP-ошибки/невалидного ответа.

- тесты `C:\Users\stalcker\AI\stAuto0\scripts\init_wallet4browser.py` не обязательны: добавлять их только если запуск скрипта можно изолировать моками без реального браузера и MultiManager; при чрезмерно сложном мокировании достаточно unit-тестов `MultiManagerClient` и ручной проверки URL/fallback
  - проверка использования ответа MM;
  - проверка fallback при недоступности endpoint;
  - проверка построенного URL.

## Совместимость и ограничения

- Endpoint добавляется аддитивно; существующие API-контракты не изменяются.
- Bearer-auth остается обязательной: internal API уже защищен общим middleware приложения.
- ID расширения не является секретом, но его не нужно включать в избыточные логи или смешивать с учетными данными.
- Не менять схему БД: необходимые данные уже находятся в профиле, каталоге расширений и browser data directory.
- Не менять версию проекта, `CHANGELOG.md` и release-файлы.
- Не менять контракт и реализацию `POST /api/browser/:id/zerion-login` и автоматического executor-потока в рамках этой задачи: они уже используют первое назначенное расширение и должны сохранить это поведение.
- Не удалять fallback из `Core/browser.py` в рамках этой задачи: он нужен для автономного режима и является согласованным резервным значением.
- Не добавлять новую зависимость.

## Тесты

### Unit

MultiManager:

```text
npm test
npm run lint
```

Проверить новый endpoint с моками profile queries и `resolveRuntimeId()`.

stAuto0:

```text
pytest
```

Проверить `MultiManagerClient` с моками HTTP-сессии: success, timeout/connection error, non-2xx и invalid JSON/ID.

### Ручная проверка

1. Запустить MultiManager и Zerion-профиль с назначенным расширением.
2. Вызвать `GET /api/internal/profiles/<profile_id>/zerion-extension` с Bearer token и проверить runtime ID.
3. Запустить `python scripts/init_wallet4browser.py <account>` и убедиться, что переход выполняется на `chrome-extension://<полученный-id>/popup.8e8f209b.html?...`.
4. Проверить запуск диапазона аккаунтов: для каждого профиля должен использоваться ID, полученный для этого профиля.
5. Остановить MultiManager или заблокировать endpoint и убедиться, что скрипт не падает из-за запроса и использует встроенный fallback ID.
6. Проверить, что в логах отсутствуют MM token, mnemonic, wallet password и proxy credentials.
7. Убедиться, что существующий автоматический запуск и `zerion-login` продолжают работать.

## Критерии готовности

- Для доступного MultiManager `init_wallet4browser.py` использует ID, возвращенный endpoint конкретного профиля.
- При недоступном endpoint используется `klghhnkeealcohjjanjjdaeeggmfmlpl`, и сценарий продолжает работу.
- Неверный ответ endpoint не приводит к открытию URL с `None`, пустым значением или произвольной строкой.
- Сервер валидирует runtime ID до отправки ответа клиенту регулярным выражением `/^[a-z]{32}$/`; клиент также проверяет формат перед использованием и применяет fallback при невалидном значении.
- Новый endpoint требует Bearer-auth и не раскрывает секретные поля.
- Unit-тесты и lint проходят в MultiManager, тесты stAuto0 проходят.
- Изменения ограничены перечисленными файлами и не требуют миграции БД.
