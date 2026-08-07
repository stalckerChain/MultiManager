# TASK — Согласовать fingerprint MultiManager с CloakBrowser

## Цель

Исправить запуск браузера через MultiManager так, чтобы отпечаток формировался преимущественно самим CloakBrowser и не содержал явного конфликта Firefox/Chromium. Legacy-режим и исходный код `stAuto0` не изменять.

## Граница первой итерации для девелопера

Девелопер в этой итерации выполняет только раздел «Сделать сейчас». Раздел «Отложено» является последующим TODO и не должен реализовываться, частично начинаться или подменяться предположениями. Если для первого этапа потребуется изменение API, схемы БД, формата существующих seed или логики stAuto0, работу остановить и запросить отдельное согласование.

### Сделать сейчас

- [x] 1. В `src/fingerprint/index.js` оставить только Chrome UA-шаблоны для поддерживаемых платформ; Firefox и Safari не должны выбираться генератором.
- [x] 2. В `tests/unit/fingerprint.test.js` и `tests/unit/fingerprint-edge.test.js` добавить/обновить проверки Chrome UA и отсутствия Firefox/Safari.
- [x] 3. В `src/api/browser.js` заменить аргумент `--fingerprint-seed=...` на документированный `--fingerprint=...`.
- [x] 4. В `src/api/browser.js` прекратить передачу сохраненного `profile.user_agent` через `--user-agent`.
- [x] 5. Не добавлять ручные флаги WebGL, GPU, Audio, Canvas, Renderer, brand или Client Hints.
- [x] 6. Сохранить текущую работу с профилем, proxy, timezone, extensions, CDP и обработкой ошибок запуска.
- [x] 7. В существующих unit-тестах запуска проверить наличие `--fingerprint=`, отсутствие `--fingerprint-seed=` и отсутствие ручного `--user-agent`.
- [x] 8. Проверить создание нового профиля, regeneration и запуск профиля без изменения схемы БД и API-контрактов.
- [x] 9. Запустить `npm test` и `npm run lint`.

### Не менять в первой итерации

- любые файлы `stAuto0`;
- legacy-режим stAuto0;
- схему БД и миграции;
- REST API и формат ответа профиля;
- формат или содержимое уже сохраненных fingerprint seed без отдельного решения;
- timezone, proxy, extensions и persistent profile;
- WebGL, Audio, Canvas, GPU vendor/renderer и screen overrides;
- `--fingerprint-platform`, `--fingerprint-brand`, `--fingerprint-brand-version`;
- детектор или обработку BrowserScan;
- поведение «Скрытый режим»;
- обновление wrapper или бинарника CloakBrowser;
- версию проекта и release-файлы.

### Отложено после первой итерации

Следующие действия выполняются только после принятия результатов первой итерации и отдельного поручения:

1. Сравнить фактические бинарники CloakBrowser MM и stAuto0.
2. Сравнить версии Node/Python wrapper и полный command line процесса.
3. Проверить фактическую совместимость формата seed с `--fingerprint` на установленном бинарнике.
4. Снять и сравнить `navigator.userAgent`, UA-CH, `Sec-CH-UA`, platform, WebGL, Audio, Canvas, hardware, screen, timezone, locale, WebRTC и `navigator.webdriver`.
5. Разобраться с BrowserScan «Скрытый режим» по подтвержденному сигналу.
6. Рассматривать дополнительные fingerprint-флаги только после анализа расхождений и отдельного согласования.

### Запрещенные поспешные исправления

- Не возвращать ручной `--user-agent`, чтобы «быстро получить Chrome».
- Не заменять `--fingerprint` на собственный новый формат seed.
- Не конвертировать UUID в число без отдельного доказательства необходимости и согласования.
- Не подставлять значения Renderer/Audio/Canvas из результатов stAuto0.
- Не считать успешный результат одного BrowserScan доказательством исправности всего fingerprint.
- Не менять одновременно несколько независимых fingerprint-механизмов, если это не требуется тестом первой итерации.

## Согласованные решения

1. Сначала исправить подтвержденные проблемы в MultiManager.
2. Полностью убрать Firefox и Safari User-Agent-шаблоны из генерации профилей.
3. Не считать ручной User-Agent приоритетным решением; после исправления не передавать `--user-agent` в запуск CloakBrowser, если это не требуется подтвержденным тестом.
4. Заменить неподтвержденный `--fingerprint-seed` на документированный CloakBrowser-флаг `--fingerprint`.
5. Использовать стабильный seed профиля, чтобы один профиль сохранял согласованный отпечаток между запусками.
6. Не подменять вручную WebGL, Audio, Canvas, Renderer и другие отдельные значения на первом этапе.
7. После первого исправления отдельно сравнить фактические бинарники и значения fingerprint в MM и legacy stAuto0.
8. Не менять `stAuto0`, его legacy-запуск, API-контракт, схему БД, security-модель и версию проекта.

## Подтвержденные причины

- `src/fingerprint/index.js` содержит Chrome, Firefox и Safari-шаблоны; Windows-профиль может случайно получить Firefox 134 UA.
- `src/api/browser.js` без проверки передает сохраненный UA через `--user-agent`.
- BrowserScan видит Firefox в UA и Chromium 146 в реальном движке, что вызывает прямое несоответствие.
- В stAuto0 используется документированный `--fingerprint=<seed>`.
- В MultiManager используется `--fingerprint-seed=<uuid>`; этот аргумент не найден в документации, Python wrapper или Node wrapper CloakBrowser и не преобразуется wrapper-ом.
- Документация CloakBrowser описывает `--fingerprint` как master seed для WebGL, GPU, Audio, Canvas, fonts, hardware и screen-параметров.
- stAuto0 legacy запускает CloakBrowser через wrapper с default stealth args, а MM запускает бинарник напрямую; после замены seed нужно отдельно проверить различия wrapper/default args.

## План реализации

### 1. Сделать генерацию Chrome-only

Затрагиваемые файлы:

- `src/fingerprint/index.js`
- `tests/unit/fingerprint.test.js`
- `tests/unit/fingerprint-edge.test.js`

1. Оставить только Chrome-шаблоны для поддерживаемых платформ.
2. Удалить Firefox и Safari варианты из генерации новых fingerprint-профилей.
3. Сохранить платформенную согласованность OS-части UA с профилем.
4. Обновить тесты так, чтобы они проверяли Chrome UA и отсутствие Firefox/Safari.
5. Не менять уже сохраненные профили автоматически в рамках этой задачи; изменение существующего профиля должно происходить явно через regeneration или предусмотренный механизм обновления.

### 2. Перевести запуск на документированный fingerprint seed

Затрагиваемый файл:

- `src/api/browser.js`

1. Передавать CloakBrowser `--fingerprint=<seed>`, а не `--fingerprint-seed=<uuid>`.
2. Сохранить seed профиля между запусками.
3. Проверить, совместим ли текущий формат UUID из БД с реальным CloakBrowser. Если документация и бинарная проверка подтверждают только числовой формат, определить минимальное детерминированное преобразование seed без добавления нового источника случайности и без изменения security-смысла fingerprint seed.
4. Не добавлять ручные GPU/WebGL/Audio/Canvas-флаги.
5. Не добавлять ручной `--user-agent` в новый запуск, если отсутствие этого флага не ломает согласованность профилей или существующий контракт API.
6. Не добавлять одновременно независимые ручные overrides для resolution, cores и memory без отдельного подтверждения их совместимости с `--fingerprint`.
7. Сохранить timezone, proxy, extensions, persistent profile и текущую обработку ошибок запуска.

### 3. Обработать существующие профили

Затрагиваемые файлы при необходимости:

- `src/api/profiles.js`
- `src/db/queries.js`
- `src/db/schema.js` только если проверка докажет необходимость миграции
- `docs/API.md` только если изменяется описанный API

1. Не выполнять массовую незапрошенную миграцию профилей.
2. Проверить сценарии создания нового профиля, regeneration и запуска старого профиля.
3. Если старый профиль содержит Firefox UA, запуск не должен снова навязывать его CloakBrowser.
4. Решение о regeneration старых fingerprint-полей оформить явно в реализации и тестах.

### 4. Добавить проверку аргументов запуска

Затрагиваемые файлы:

- существующие тесты `tests/unit/browser-start-await.test.js`
- тесты fingerprint из раздела выше

1. Проверить наличие `--fingerprint=`.
2. Проверить отсутствие `--fingerprint-seed=`.
3. Проверить отсутствие принудительного Firefox/Safari UA в launch args.
4. Проверить, что новые профили получают Chrome UA.
5. Не считать статическую проверку достаточной для UA-CH, WebGL или Audio.

### 5. Сравнить бинарники после первого исправления

Изменений в stAuto0 не выполнять.

Сравнить:

- фактический путь бинарника CloakBrowser;
- версию из `chrome://version` или CDP `/json/version`;
- версию Python wrapper в stAuto0;
- версию Node wrapper в MM;
- фактический набор командной строки процесса;
- наличие `--fingerprint`, `--fingerprint-platform`, timezone и locale-флагов;
- Playwright wrapper default args в stAuto0 и прямой spawn в MM.

Учитывать обнаруженные версии:

- MM Node package: `cloakbrowser 0.5.4`;
- stAuto0 Python package: `cloakbrowser 0.5.1`;
- локальный Chromium cache содержит варианты `146.0.7680.177.4` и `146.0.7680.177.5`.

### 6. Сравнить реальные значения fingerprint

Для MM и legacy stAuto0 использовать один и тот же бинарник, одинаковый профиль или его проверенную копию, одинаковый прокси и одинаковый режим headed/headless. Не запускать одновременно один persistent profile в двух процессах.

Зафиксировать:

- `navigator.userAgent`;
- `navigator.userAgentData` и `navigator.userAgentData.brands`;
- `Sec-CH-UA`, `Sec-CH-UA-Platform`, `Sec-CH-UA-Full-Version-List` через тестовый endpoint/Network capture;
- `navigator.platform`;
- `navigator.webdriver`;
- `window.chrome`;
- WebGL vendor и renderer;
- Audio fingerprint;
- Canvas fingerprint;
- `navigator.hardwareConcurrency`;
- `navigator.deviceMemory`;
- screen/viewport/outer dimensions;
- timezone и locale;
- WebRTC ICE candidates;
- BrowserScan результат.

Цель сравнения — найти расхождения между MM и stAuto, а не подобрать отдельные значения под BrowserScan.

### 7. Исследовать «Скрытый режим» после согласованности

Не менять stealth-поведение до завершения предыдущих сравнений. После получения baseline определить, какой именно сигнал BrowserScan помечает как hidden/incognito, и исправлять только подтвержденную причину. Не маскировать результат отдельными JS-подменами.

## Риски и ограничения

- Удаление `--user-agent` может изменить сохраненные профили, поэтому обязательны проверки создания, regeneration и запуска существующего профиля.
- Документация подтверждает `--fingerprint`, но не доказывает поведение конкретного локального бинарника; фактический процесс и CDP-проверка обязательны.
- UUID seed может не соответствовать ожидаемому формату CloakBrowser; нельзя молча считать его эквивалентным числовому seed.
- Разные wrapper-версии stAuto0 и MM могут добавлять разные аргументы даже при одинаковом Chromium.
- BrowserScan не является единственным критерием корректности; оптимизация под один detector может ухудшить общую согласованность.
- WebGL, Audio, Canvas и Renderer не менять вручную без подтвержденного расхождения и понимания влияния на остальные сигналы.
- Не логировать proxy credentials, cookies, tokens, seed в открытом виде и другие секреты.
- Обнаруженные в конфигурации stAuto0 credentials необходимо ротировать отдельно; в рамках этой задачи файлы stAuto0 не изменять.

## Проверка результата

1. Запустить `npm test`.
2. Запустить `npm run lint`.
3. Проверить unit-тестами Chrome-only генерацию и launch args.
4. Создать новый MM-профиль и убедиться, что его UA содержит Chrome и не содержит Firefox/Safari.
5. Запустить профиль через MM и проверить BrowserScan: отсутствие конфликта Firefox/Chromium.
6. Проверить regeneration и повторный запуск профиля с постоянным seed.
7. Убедиться, что legacy stAuto0 не изменился и продолжает запускаться отдельно.
8. Сравнить фактический бинарник и командную строку MM/stAuto0.
9. Снять перечисленные JS/HTTP fingerprint-значения на одинаковом тестовом сценарии.
10. Только после этого отдельно оценить «Скрытый режим».

## Критерии готовности

- Новые MM-профили используют только Chrome UA.
- MM не передает `--fingerprint-seed`.
- MM использует документированный `--fingerprint` со стабильным seed.
- MM не требует ручной подмены WebGL, Audio, Canvas или Renderer.
- BrowserScan больше не сообщает конфликт Firefox 134 против Chromium 146.
- Существующие API, БД, security-модель, версия проекта и stAuto0 legacy не изменены без отдельного согласования.
- `npm test` и `npm run lint` проходят.
- Сравнение бинарников и фактических fingerprint-значений выполнено после первичного исправления.
