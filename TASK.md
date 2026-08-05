# TASK — Устранение уязвимостей библиотек и связанных входных данных

## Цель

Устранить подтверждённые уязвимости dependency-графов backend и GUI/Electron, обновить lock-файлы, закрыть реальные опасные сценарии использования архивов и proxy URL, затем подтвердить результат тестами и сборкой.

Разработчик выполняет этот план. Повторный аудит как отдельную задачу создавать не нужно: после каждого этапа достаточно проверять результат командами из раздела «Проверка».

Версию проекта не изменять. `package.json`/`gui/package.json` можно менять только для обновления зависимостей и scripts аудита.

## Зафиксированные результаты аудита

Аудит выполнен 2026-08-05 по двум lock-файлам.

### Backend

`npm audit --omit=dev`: 3 production-находки:

- `adm-zip` в корневом `package-lock.json`: установлен диапазон `0.5.x`; high, `GHSA-xcpc-8h2w-3j85`, crafted ZIP вызывает чрезмерное выделение памяти.
- `ip-address` через `socks`/`express-rate-limit`: установлен `10.2.0`; high/moderate advisories `GHSA-mwp4-54f8-5fhr`, `GHSA-4xrf-jv44-h6hh`, `GHSA-22jq-vg5j-6vgg`; возможен обход SSRF/trust-boundary проверок.
- `body-parser` через Express: установлен `1.20.5`; low, `GHSA-v422-hmwv-36x6`; некорректный limit может отключить ограничение тела запроса.

Полный audit backend также выявляет high `brace-expansion` и low `esbuild` в development-графе.

### GUI/Electron

`npm audit --omit=dev`: 5 production/runtime-находок:

- `tar` через production-зависимость `cloakbrowser@0.5.3`: установлен `7.5.16`; critical/high/moderate advisories до `7.5.20`, включая archive DoS, hardlink/symlink path traversal и arbitrary file overwrite/read.
- `ip-address`: установлен `10.2.0`; те же SSRF/trust-boundary advisories.
- `body-parser`: установлен `1.20.5`; low `GHSA-v422-hmwv-36x6`.
- `js-yaml`: установлен `4.2.0`; high `GHSA-52cp-r559-cp3m`, quadratic CPU при YAML merge-key chains.
- `postcss`: установлен `8.5.15`; high/moderate `GHSA-r28c-9q8g-f849`, `GHSA-fxqj-rqcc-2cmp`, arbitrary `.map` file disclosure через sourceMappingURL.

Полный GUI audit дополнительно выявляет:

- `electron@34.5.8`: high/moderate advisories; audit указывает fixed version `43.3.0`.
- `electron-builder@25.1.8` и его `app-builder-lib`, `builder-util-runtime`, `node-gyp`, `tar`, `cacache`: high, включая uncontrolled search path в AppImage и credential leak при cross-origin redirect; audit указывает fixed `electron-builder@26.15.3`.
- `concurrently@9.2.3` через `shell-quote@1.8.4`: high DoS; обновить до `concurrently@9.2.4` или более новой совместимой версии.
- многочисленные копии `brace-expansion`: обновить родительский `electron-builder`, а остаточные копии привести к безопасным версиям через новый lock-граф.

## План реализации

### 1. Обновить backend dependencies ✅

**Файлы:** `package.json`, `package-lock.json`

- Исправить рассинхрон: корневой `package.json` уже содержит `adm-zip: ^0.6.0`, а корневой lock-файл содержит `adm-zip: ^0.5.18`. Сгенерировать lock-граф с `adm-zip >=0.6.0`.
- Не заменять `adm-zip` на другую библиотеку на этом этапе: обновление закрывает advisory, а защитные проверки архива выполняются отдельно в шаге 3.
- Обновить транзитивный `ip-address` минимум до `10.4.0`.
- Обновить `body-parser` минимум до `1.20.6` через совместимое обновление lock-графа Express.
- Обновить транзитивный `brace-expansion` минимум до `1.1.18` во всех применимых ветках.
- Обновить development `esbuild` до версии вне уязвимого диапазона `0.27.3–0.28.0`, если он присутствует в lock-графе.
- Не выполнять бездумный `npm audit fix`: вручную проверить итоговый diff manifests/lock-файла и не допускать смены версии проекта.

**Проверка:** `npm ls adm-zip ip-address body-parser brace-expansion esbuild --all`; `npm audit --omit=dev`; полный `npm audit`.

### 2. Обновить GUI/Electron dependencies ✅

**Файлы:** `gui/package.json`, `gui/package-lock.json`

- Обновить `cloakbrowser` с `0.5.3` минимум до `0.5.4`; проверить, что его `tar` разрешается в версию `>7.5.20`.
- Если после обновления `cloakbrowser` или lock-графа `tar` остаётся `<=7.5.20`, добавить совместимый lock-level override либо обновить parent dependency так, чтобы все production-копии `tar` были безопасными. Не оставлять уязвимый `tar` в packaged runtime.
- Обновить `postcss` минимум до `8.5.25`.
- Обновить транзитивные `ip-address` минимум до `10.4.0` и `body-parser` минимум до `1.20.6`.
- Обновить `js-yaml` минимум до `4.3.1`.
- Обновить `concurrently` минимум до `9.2.4`, не переходить на major 10 без отдельной необходимости.
- Обновить `electron-builder` с `25.1.8` до `26.15.3` или более новой версии той же major-линейки, если она доступна и совместима. Это должно подтянуть исправленные `app-builder-lib`, `builder-util-runtime`, `node-gyp`, `cacache`, `tar` и `brace-expansion`.
- Обновить `electron` с `34.5.8` минимум до `43.3.0`, так как advisory fix для текущей major-ветки отсутствует. Проверить совместимость native-модулей и packaged backend.
- Не обновлять одновременно Vue, Tailwind, Vite, Pinia, Express major или другие не связанные пакеты.

**Проверка:** `npm ls electron electron-builder cloakbrowser tar ip-address body-parser js-yaml postcss concurrently brace-expansion --all`; `cd gui && npm audit --omit=dev`; `cd gui && npm audit`.

### 3. Безопасно обрабатывать ZIP/CRX расширений ✅

**Файлы:** `src/api/extensions.js`, `tests/unit/extensions.test.js`

Текущий риск: `/from-store` собирает весь сетевой ответ в память, а `/from-zip` и `/from-store` используют `AdmZip` без лимита размера, лимита распаковки и полной проверки destination path. Обновление `adm-zip` само по себе не закрывает эти сценарии.

- Ввести константы лимитов для входного архива, количества entries, размера одного распакованного файла и суммарного uncompressed size. Значения выбрать явно и покрыть тестами; не использовать бесконечные/неограниченные значения.
- В `downloadWithRedirects` принимать только HTTPS для Chrome Web Store, проверять каждый redirect до перехода, ограничивать размер ответа до чтения всего тела и уничтожать response/request при превышении лимита.
- Для CRX валидировать длину заголовка до `subarray`, проверять границы buffer и отклонять header, выходящий за размер ответа.
- Перед распаковкой получить entries и отклонять архив при превышении числа файлов, compressed/uncompressed лимитов или подозрительных размеров.
- Для каждого entry нормализовать путь и убедиться, что итоговый путь остаётся внутри временного/целевого каталога через `path.relative`; отклонять абсолютные пути, `..`, drive-relative пути, NUL и symlink/hardlink entries.
- Не использовать `extractAllTo` для непроверенного архива. Использовать единый безопасный helper для обоих endpoint-ов `/from-store` и `/from-zip`, чтобы ручная ветка с одним top-level directory имела те же проверки.
- Распаковывать во временный каталог, валидировать `manifest.json`, затем атомарно перемещать каталог в `extensions`. При ошибке удалять временные и частично созданные каталоги в `finally`.
- Проверять `name`/`targetName`: запретить path separators, `..`, абсолютные и drive-relative значения; не позволять запросу выбрать каталог вне `getExtensionsDir()`.
- Не раскрывать пользователю stack trace, локальные пути и внутренние ошибки библиотеки в HTTP 500; писать детали только в безопасный logger без секретов.
- Сохранить существующую проверку manifest `name`, `version`, `manifest_version` и runtime ID.

**Тесты:**

- crafted ZIP с большим заявленным размером не приводит к выделению гигабайтов памяти;
- архив с `../`, абсолютным, drive-relative и NUL-путём отклоняется;
- архив с symlink/hardlink entry отклоняется;
- превышение file-count, per-file и total-uncompressed limits отклоняется;
- CRX с повреждённым или выходящим за buffer header отклоняется;
- redirect с HTTP, localhost, private/local адресом или превышением количества redirect отклоняется;
- временный каталог удаляется после ошибки валидации или распаковки;
- обычные ZIP/CRX с валидным manifest по-прежнему устанавливаются.

### 4. Исправить proxy SSRF и TLS-проверки

**Файлы:** `src/proxy/index.js`, `src/api/proxies.js`, `tests/unit/proxy.test.js`

- Не полагаться только на уязвимый `ip-address` для SSRF-защиты. Обновить пакет до `10.4.0` и добавить собственную нормализацию/проверку адресов перед сетевым запросом.
- Для `rotateProxy` валидировать URL на каждом redirect, разрешать только `http:`/`https:`, запрещать localhost, loopback, link-local, private RFC1918, carrier-grade NAT, multicast, unspecified, IPv4-mapped IPv6, NAT64 и числовые/leading-zero формы адресов.
- Не разрешать redirect с публичного адреса на private/local адрес; проверять hostname после DNS resolution перед соединением и учитывать rebinding настолько, насколько позволяет текущий API.
- Не использовать простые проверки `startsWith('192.168.')`, `startsWith('10.')` и подобные как единственную защиту.
- Добавить максимальный размер ответа rotation endpoint и ограничение времени/количества redirects.
- В `checkHttpProxy` и `checkSocks5Proxy` сохранить поддержку пользовательских proxy, но не отключать TLS certificate validation: заменить `rejectUnauthorized: false` на безопасное значение и покрыть проверкой поведение при недействительном сертификате.
- Не логировать username/password proxy; проверить, что ошибки не содержат credentials.
- Сохранить поддержку IPv4/IPv6 proxy, если она нужна приложению, но добавить тесты на безопасные и запрещённые формы.

**Тесты:** leading-zero IPv4, CIDR suffix, IPv4-mapped/NAT64 IPv6, loopback/private/link-local, DNS redirect в private адрес, redirect chain, oversized response, invalid TLS certificate и отсутствие credentials в logs/errors.

### 5. Проверить и усилить Electron boundary после major update

**Файлы:** `gui/src/main/index.js`, `gui/src/preload/index.js`, `gui/src/main/updater.js`, `gui/src/main/core-manager.js`, `gui/package.json`, GUI build configuration

- Сохранить `contextIsolation: true` и `nodeIntegration: false`.
- Убрать или ограничить универсальный preload API `invoke(channel, ...args)`: разрешить только перечисленные IPC channels, валидировать аргументы и не передавать renderer произвольный main-process channel.
- Проверить, что `get-token` не экспортируется renderer без необходимости; если нужен только для API-клиента, передавать минимально необходимое значение и не логировать его.
- Установить навигационные ограничения: packaged окно должно загружать только локальный `index.html`; dev URL разрешать только в dev-режиме; внешние URL открывать во внешнем браузере или отклонять.
- Добавить `setWindowOpenHandler`/`will-navigate` policy, запрещающую неожиданные внешние окна и навигацию renderer.
- Проверить IPC handlers `pty:start`, `dialog:*`, `hooks:*` и browser manager: аргументы должны валидироваться, paths не должны позволять запуск произвольных файлов или команд.
- В updater включить явную проверку ошибки, HTTPS/source policy и подписи обновления; не принимать redirect на недоверенный origin. Не добавлять обход проверки подписи.
- После обновления Electron проверить, что asar integrity, native modules и `afterPack`/`copy-backend.js` работают как прежде.

**Проверка:** ручной packaged запуск, отказ внешней навигации, проверка IPC allowlist, `cd gui && npm run build`, запуск installer/portable и проверка updater без установки неподписанного/неожиданного обновления.

### 6. Ограничить YAML/PostCSS build inputs

**Файлы:** GUI build configuration, `gui/vite.config.*`, `gui/postcss.config.*`, lock-файл; фактические callers определить поиском

- После обновления `js-yaml` и `postcss` найти все места их фактического запуска.
- Не передавать в parser недоверенный YAML без ограничения размера, глубины и merge/alias поведения.
- Для PostCSS задавать явный `from`/`to`, не обрабатывать пользовательские source maps в build pipeline и не разрешать чтение `.map` файлов за пределами workspace.
- Если пакет используется только внутри доверенного build-процесса и runtime reachability отсутствует, зафиксировать это тестом/конфигурацией, но не оставлять старую уязвимую версию.

### 7. Регрессии и dependency policy

**Файлы:** `package.json`, `gui/package.json`, `tests/unit/`, при необходимости CI-конфигурация

- Добавить scripts `security:audit` в оба manifests, выполняющие `npm audit --audit-level=high` в соответствующем проекте без автоматического исправления.
- Если CI уже существует в скрытой/внешней конфигурации, не менять её без проверки; если CI отсутствует, добавить отдельный минимальный workflow только после сохранения текущих project conventions.
- Не добавлять `npm audit fix --force` и не принимать audit через blanket ignore.
- Проверить lock-файлы на повторяемую установку: чистая установка должна использовать `npm ci` в корне и `gui`.
- Добавить/обновить тесты backend для extensions и proxy. Для GUI обязательны build и packaged smoke test, поскольку отдельного GUI test command нет.

## Затрагиваемые файлы

- `package.json`
- `package-lock.json`
- `gui/package.json`
- `gui/package-lock.json`
- `src/api/extensions.js`
- `src/proxy/index.js`
- `src/api/proxies.js` только если потребуется изменение validation/route behavior
- `gui/src/main/index.js`
- `gui/src/preload/index.js`
- `gui/src/main/updater.js`
- `gui/src/main/core-manager.js` только если потребуется безопасная передача IPC/token
- GUI build configuration, если найдены фактические YAML/PostCSS/updater настройки
- `tests/unit/extensions.test.js`
- `tests/unit/proxy.test.js`
- новые unit tests только при отсутствии существующего места для покрытия

Не менять:

- версию проекта;
- схему БД и пользовательские данные;
- API master-key/token модель без отдельного согласования;
- формат профилей, cookies и automation flow;
- секреты и реальные proxy credentials в тестах/логах.

## Поэтапное выполнение и гейты

Задача имеет большой объём и должна выполняться поэтапно. После каждого этапа разработчик:

- отмечает выполненными только завершённые пункты `TASK.md`;
- проверяет рабочее дерево и diff, не включая секреты и изменение версии проекта;
- готовит отдельный промежуточный коммит с одним логическим этапом после пользовательского одобрения результата этапа.

При breaking change в major-обновлениях `electron` или `electron-builder` разработчик обязан остановиться, зафиксировать пакет, ошибку, затронутый сценарий и возможные варианты решения. Нельзя молча менять план, продолжать следующие этапы или откатывать security update без отдельного решения пользователя.

### Этап 1. Backend dependencies

Выполнить шаг 1. После обновления немедленно проверить:

```bash
npm test
npm run lint
```

При падении остановиться на этом этапе и исправить совместимость до перехода к следующему этапу.

### Этап 2. GUI/Electron dependencies

Выполнить шаг 2. После обновления немедленно проверить:

```bash
npm test
npm run lint
cd gui && npm run build
```

Перед продолжением подтвердить, что `npm audit --omit=dev` не содержит critical/high runtime-находок и что major updates не сломали native-модули или упаковку.

### Этап 3. ZIP/CRX

Выполнить шаг 3 вместе с тестами архивных атак. Не переходить к следующему этапу, пока backend tests и lint не проходят.

### Этап 4. Proxy SSRF/TLS

Выполнить шаг 4 вместе с regression tests proxy. Повторно запустить `npm test`, `npm run lint` и production audit backend.

### Этап 5. Electron boundary

Выполнить шаг 5. До продолжения к этапу 6 выполнить полный packaged smoke test:

- собрать installer и portable package;
- запустить packaged приложение;
- проверить локальную загрузку renderer, IPC allowlist, отказ внешней навигации и запуск backend;
- проверить запуск/остановку браузера, updater policy и отсутствие утечек токена в логах;
- проверить native-модули и `afterPack`/`copy-backend.js`.

При любой поломке packaged flow остановиться и зафиксировать результат, не продолжать план молча.

### Этап 6. YAML/PostCSS

Выполнить шаг 6 только после успешного packaged smoke test. Затем повторно проверить GUI build и audit.

### Этап 7. Policy и финальная проверка

Выполнить шаг 7, затем запустить полный набор тестов, lint, clean install, оба production audit и GUI build/smoke test.

Промежуточные коммиты должны разделять минимум следующие логические изменения:

1. backend dependencies;
2. GUI/Electron dependencies;
3. ZIP/CRX hardening;
4. proxy SSRF/TLS hardening;
5. Electron boundary и updater;
6. YAML/PostCSS ограничения и audit policy.

## Проверка результата

Из корня:

```bash
npm ci
npm test
npm run lint
npm audit --omit=dev
npm audit --audit-level=high
```

Из `gui/`:

```bash
npm ci
npm audit --omit=dev
npm audit --audit-level=high
npx vite build
npm run build
```

Ожидаемый результат:

- production audit backend и GUI не содержит critical/high находок;
- оставшиеся low/moderate находки явно объяснены и не относятся к уязвимому runtime-сценарию;
- все production-копии `tar`, `ip-address`, `body-parser`, `js-yaml`, `postcss` находятся вне затронутых advisory ranges;
- ZIP/CRX не может вызвать неограниченное выделение памяти, path traversal или запись вне каталога расширений;
- proxy rotation не может перейти на private/local endpoint через обход адресной проверки;
- IPC, navigation, updater и packaged Electron build проходят проверки;
- `npm test`, `npm run lint`, `npm ci`, `cd gui && npm ci`, `cd gui && npx vite build` и `cd gui && npm run build` проходят.

Если major update `electron` или `electron-builder` ломает packaged flow, не откатывать security update молча: зафиксировать конкретную несовместимость, минимальный безопасный workaround и остановиться для отдельного решения.

## Согласования

- Гейт №1: решение согласовано пользователем: выполнить аудит и remediation по его результатам.
- Разработчик реализует этот план и изменяет в `TASK.md` только статусы пунктов.
- После реализации результат передаётся на финальное ревью.
