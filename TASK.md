# TASK — Проверка `--fingerprint-storage-quota`

## Цель текущей итерации

Проверить гипотезу, что BrowserScan показывает:

```text
Скрытый режим: Да
штраф -10%
```

из-за нормализованного CloakBrowser storage quota.

В актуальной документации CloakBrowser указано, что `--fingerprint-storage-quota=<MB>` изменяет значения Storage API и предназначен для detector-ов, которые определяют incognito/private mode по quota. BrowserScan прямо указан в документации CloakBrowser как пример такого detector-а.

Это изолированный A/B-эксперимент, а не окончательное решение всей fingerprint-модели.

## Сделать сейчас

### 1. Изменить launch args MM

Затрагиваемый файл:

- `src/api/browser.js`

В массив `args` добавить ровно один аргумент:

```js
'--fingerprint-storage-quota=10240',
```

Рекомендуемое место — после:

```js
`--fingerprint-timezone=${timezone}`,
```

Итоговый фрагмент должен содержать:

```js
const args = [
  '--remote-debugging-port=0',
  '--fingerprint=' + profile.fingerprint_seed,
  '--resolution=' + profile.screen_resolution,
  '--cores=' + profile.hardware_cores,
  '--memory=' + profile.hardware_memory,
  `--user-data-dir=${userDataDir}`,
  '--lang=en-US',
  '--no-first-run',
  '--no-default-browser-check',
  `--fingerprint-timezone=${timezone}`,
  '--fingerprint-storage-quota=10240',
];
```

### 2. Удалить предыдущий экспериментальный флаг

Если в рабочем коде или незакоммиченных изменениях присутствует:

```text
--unlimited-storage
```

его необходимо удалить. Одновременно использовать `--unlimited-storage` и `--fingerprint-storage-quota=10240` нельзя: эксперимент должен проверять только один новый фактор.

### 3. Сохранить без изменений

Следующие текущие аргументы и значения не менять:

- `--fingerprint=<profile.fingerprint_seed>`;
- `--resolution=<profile.screen_resolution>`;
- `--cores=<profile.hardware_cores>`;
- `--memory=<profile.hardware_memory>`;
- `--user-data-dir=<userDataDir>`;
- `--lang=en-US`;
- `--no-first-run`;
- `--no-default-browser-check`;
- `--fingerprint-timezone=<timezone>`;
- proxy args;
- extensions;
- remote debugging;
- persistent profile logic;
- cookie injection.

Seed профиля не менять, не регенерировать и не преобразовывать. Профиль должен запускаться с тем же fingerprint, чтобы сравнение с предыдущим BrowserScan было корректным.

## Тесты

Затрагиваемый файл:

- `tests/unit/browser-start-await.test.js`

Добавить или обновить проверку, что launch args содержат:

```text
--fingerprint-storage-quota=10240
```

Проверить также:

- есть `--fingerprint=`;
- нет `--fingerprint-seed=`;
- нет ручного `--user-agent`;
- нет `--unlimited-storage`.

Не добавлять тесты, которые требуют запуска реального BrowserScan или внешнего прокси.

## Ручная проверка

Проверять на том же MM-профиле и по возможности с тем же прокси, на котором был результат `80%`.

1. Полностью остановить старый процесс CloakBrowser.
2. Запустить профиль MM заново, чтобы новый аргумент попал в командную строку процесса.
3. Открыть `chrome://version`.
4. Убедиться, что в `Command Line` присутствует:

```text
--fingerprint-storage-quota=10240
```

5. Проверить через DevTools Console:

```js
await navigator.storage.estimate();
```

6. Зафиксировать `quota` и `usage`.
7. Повторно открыть `https://www.browserscan.net/ru`.
8. Зафиксировать:

- общий процент подлинности;
- наличие или отсутствие `Скрытый режим -10%`;
- WebGL penalty;
- Audio penalty;
- значение Audio;
- WebGL vendor/renderer;
- quota из `navigator.storage.estimate()`.

Нельзя сравнивать результат с новым профилем или новым seed: это нарушит A/B-сравнение.

## Проверка результата разработчиком

Выполнить:

```text
npm test
npm run lint
```

Также проверить, что изменены только необходимые файлы текущей задачи:

- `src/api/browser.js`;
- `tests/unit/browser-start-await.test.js`;
- при необходимости только связанные с тестом файлы.

Не изменять версию проекта и release-файлы.

## Не делать сейчас

- Не изменять `stAuto0` и legacy-режим.
- Не сравнивать бинарники и wrapper-версии.
- Не добавлять `--unlimited-storage`.
- Не добавлять `--fingerprint-storage-quota` с другим значением параллельно.
- Не добавлять `--fingerprint-gpu-vendor`.
- Не добавлять `--fingerprint-gpu-renderer`.
- Не добавлять `--fingerprint-hardware-concurrency`.
- Не добавлять `--fingerprint-device-memory`.
- Не добавлять `--fingerprint-screen-width` и `--fingerprint-screen-height`.
- Не добавлять `--fingerprint-brand` и `--fingerprint-brand-version`.
- Не добавлять `--fingerprint-platform`.
- Не добавлять `--fingerprint-webrtc-ip`.
- Не добавлять `--fingerprint-noise=false`.
- Не использовать `--fingerprint=off`.
- Не менять старые `--resolution`, `--cores`, `--memory`.
- Не менять WebGL, Audio, Canvas, Renderer, GPU или Client Hints вручную.
- Не вызывать `navigator.storage.persist()` как исправление.
- Не менять БД, API, seed профиля или persistent profile logic.

## Интерпретация результата

### Если штраф `Скрытый режим -10%` исчез

Считать гипотезу storage quota подтвержденной. В отчете указать:

- старый и новый `quota`;
- старый и новый BrowserScan result;
- изменились ли WebGL и Audio.

Окончательное решение о постоянном использовании `10240` принимать отдельной задачей после проверки влияния на остальные сигналы.

### Если quota изменилась, но штраф остался

Считать, что BrowserScan использует дополнительный incognito-сигнал. Не добавлять другие флаги. Следующий этап должен быть отдельной диагностикой persistent storage и BrowserScan-specific checks.

### Если quota не изменилась

Проверить фактическую командную строку и версию бинарника. Если аргумент присутствует, но не работает, зафиксировать, что установленный Chromium/CloakBrowser не поддерживает этот флаг в текущей версии.

### Если изменились WebGL или Audio

Зафиксировать значения и не вносить дополнительные fingerprint-изменения. Это означает, что storage-флаг влияет на общий fingerprint-профиль или detector оценивает связанные параметры.

## Критерии готовности

- В MM добавлен только `--fingerprint-storage-quota=10240`.
- `--unlimited-storage` отсутствует.
- Seed и все остальные параметры запуска сохранены.
- Добавлена unit-проверка аргумента.
- `npm test` проходит.
- `npm run lint` проходит.
- BrowserScan повторно проверен на том же профиле.
- Зафиксированы quota, общий процент и все три результата: Hidden Mode, WebGL, Audio.
- `stAuto0`, БД, API, версия проекта и остальные fingerprint-механизмы не изменены.
