# TASK — Надёжная синхронизация popup Zerion в Multi-Control

## Цель

Устранить появление обычных вкладок вместо нативных popup-окон Zerion при
задержке открытия popup в слейве.

Сохранить текущую синхронизацию мыши и существующее поведение для обычных
`http(s)`-вкладок, включая `_blank` и `window.open`.

## Причина дефекта

Новые нативные target'ы антидетект-браузера не всегда приходят через CDP
WebSocket. Поэтому master обнаруживается через HTTP `/json` polling каждые
300 мс, после чего `syncNewMasterTab()` ищет соответствующий target в каждом
slave.

Текущая `_findNativeSlaveTab()` выполняет только две попытки с паузой 150 мс и
выбирает любую немапленную page-вкладку. Если popup Zerion в slave открывается
позже, `syncNewMasterTab()` вызывает `Target.createTarget` через `createTab`.
CDP создаёт обычную вкладку, а не native popup расширения, поэтому в slave
появляется вкладка с `chrome-extension://...` вместо плавающего окна.

Дополнительно поздний native target может быть обработан `onNewTab` или
`onTabAttached` по порядковому `tabIndex`, что приводит к неверному mapping и
дубликату.

## Согласованное решение

### 1. Распознавание popup Zerion

- Добавить локальные helper-функции в `src/api/multi-control.js`, не создавая
  новый сервис или менеджер.
- Распознавать только URL вида `chrome-extension://...`.
- Runtime ID Zerion получать из `profile.extensions` через уже существующий
  `resolveRuntimeId`, используя данные конкретного профиля.
- Для классификации использовать runtime ID master-профиля. Для поиска popup в
  каждом slave использовать runtime ID именно этого slave и pathname,
  извлечённый из URL master-popup. ID unpacked-расширения между профилями не
  считать одинаковыми автоматически.
- Сопоставлять extension ID и pathname popup. Query string и hash не должны
  мешать сопоставлению.
- Не считать любой `chrome-extension://` target Zerion-popup без проверки
  ожидаемого ID и пути.
- Ошибки чтения профиля, JSON или разрешения runtime ID обрабатывать безопасно:
  не классифицировать URL как Zerion-popup и логировать только техническую
  информацию без секретов.

### 2. Ожидание native popup

Изменить `_findNativeSlaveTab(slaveId, expectedUrl)`:

- Для Zerion-popup выполнять polling примерно 2–3 секунды.
- Между попытками использовать шаг 150–250 мс.
- В каждой попытке получать актуальный список через `getHttpTabs(slaveId)`.
- Исключать target'ы, уже присутствующие в `tabMapping` для этого slave.
- Принимать только page-target, чей URL совпадает с ожидаемым Zerion extension
  ID конкретного slave и pathname из master URL.
- Не принимать случайную немапленную вкладку, открытую под нагрузкой.
- Для обычных `http(s)`-страниц сохранить текущую логику поиска нативного
  немапленного target и её короткое ожидание, достаточное для `_blank`.

Ожидание для разных slave должно выполняться параллельно, а не последовательно:
один медленный профиль не должен добавлять полный timeout каждому следующему
slave.

### 3. Запрет CDP fallback для popup

В `syncNewMasterTab()`:

- Если URL нового master-target является Zerion-popup, ждать native popup в
  каждом slave и не вызывать `cdpManager.createTab()` ни при каких условиях.
- После нахождения popup выполнять `attachToExistingTarget`, `mapTab` и
  существующую логику фокусировки.
- Если popup не появился до окончания таймаута, не создавать заменяющую вкладку;
  записать предупреждение и завершить синхронизацию этого slave.
- Для обычных `http(s)` URL сохранить текущий fallback:
  `createTab` → `attachToExistingTarget` → `mapTab`.
- Использовать трёхветочную классификацию URL:
  - подтверждённый Zerion-popup — длительное ожидание и reconciliation;
  - любой `chrome-extension://` URL, который не удалось безопасно подтвердить
    как Zerion, — также не передавать в `createTab`, только предупреждение,
    ожидание/завершение без искусственной вкладки;
  - `http(s)` URL — текущая логика с разрешённым fallback.
- Не менять правила активации фоновых `_blank`-вкладок: фокус должен по-прежнему
  следовать фактической активации master.
- Долгое ожидание popup не должно блокировать `discoverActiveTab()` и путь
  `/os-keyboard` для Enter. `discoverActiveTab()` должен быстро завершать
  обнаружение master-target, а длительный popup-wait запускать асинхронно либо
  передавать его в отдельный state reconciliation без ожидания из Enter-пути.
- Ожидание slave-popup запускать для всех slave параллельно через эквивалент
  `Promise.all`, не удерживая последовательный цикл на несколько timeout'ов.

### 4. Защита от гонок и cleanup

- Учитывать, что для native target антидетект может не прислать
  `Target.targetCreated`/`Target.attachedToTarget`. Поэтому одного
  `onNewTab`/`onTabAttached` недостаточно.
- Добавить явный reconciliation-механизм через HTTP `/json` для slave:
  - хранить незавершённые popup-sync записи с master target, pathname и
    ожидаемым профилем slave;
  - проверять их на существующем discovery-интервале 300 мс либо отдельным
    короткоживущим timer'ом;
  - продолжать проверку после первоначального timeout ещё заданное время,
    чтобы обнаруживать popup, открывшийся через 5 и более секунд под нагрузкой;
  - выполнять attach, in-place remap и cleanup идемпотентно;
  - удалять запись после успешного mapping, окончательного timeout или stop.
- Не маппить native extension target в `onNewTab` по `tabIndex` как обычную
  вкладку.
- При позднем появлении native Zerion-popup искать существующий mapping на
  target с тем же extension ID и pathname.
- Если такой target был создан через CDP как ошибочный fallback:
  - закрыть его через существующий `cdpManager.closeTarget()`;
  - заменить mapping master/slave на native target;
  - не закрывать native target;
  - не оставлять старый target в `tabMapping` или `tabIndex`.
- При remap заменять значение непосредственно в существующей записи:
  `tabMapping.get(masterTargetId).set(slaveId, newTargetId)`. Не использовать
  пару `unmapTab` + `mapTab`, поскольку при единственном slave это удалит
  `masterTargetId` из `tabIndex` и добавит его в конец.
- Вести минимальное runtime-состояние созданных popup-target'ов, чтобы cleanup
  не мог закрыть обычную `_blank`-вкладку или настоящий native popup.
- Очищать реестр созданных fallback-target'ов и pending reconciliation в
  `/stop` и `/slave/remove` вместе с уже существующими `pendingSync` и
  `attachedMasterTabs`.
- Учесть порядок событий: target может сначала попасть в `targetSessions`, а
  mapping появиться позднее. Операции должны быть идемпотентными при повторном
  `onNewTab`, `onTabAttached` или polling.
- При закрытии target существующая очистка `tabMapping` и `tabIndex` должна
  продолжать работать.

### 5. Регрессия обычных вкладок

- `_blank`, `window.open` и другие обычные `http(s)`-ссылки должны сохранить
  текущий путь синхронизации.
- Для них при отсутствии native slave-tab `createTab` по-прежнему разрешён.
- Не менять поведение навигации, активации, мыши и scroll для уже замапленных
  обычных вкладок.
- Для обычных табов сохранить текущую логику `tabIndex` по порядку создания.
  Extension-target'ы нужно исключить из index-based mapping, но образовавшиеся
  из-за них index gaps в рамках этой задачи не исправлять.

## Затрагиваемые файлы

### Реализация

- `src/api/multi-control.js` — распознавание Zerion URL, получение runtime ID,
  расширенное polling-ожидание, запрет popup fallback, reconciliation в
  `onNewTab`/`onTabAttached` и cleanup ошибочного target.

### Тесты

- `tests/unit/multi-control-api.test.js` — обновить mocks и тестовые копии
  логики multi-control для delayed popup, точного URL matching, отсутствия
  `createTab`, cleanup и обычного `http(s)` fallback.

### Документация

- `docs/MULTI-CONTROL.md` — обновить разделы про `_blank`, native target
  discovery и `syncNewMasterTab`: указать отдельное поведение extension-popup,
  расширенный timeout и запрет `createTarget` для Zerion.

`src/multi-control/cdp-manager.js` менять не следует: `getHttpTabs`,
`attachToExistingTarget` и `closeTarget` уже предоставляют необходимые
операции.

Не менять схему БД, REST API, security-модель, версии проекта, `package.json` и
lock-файлы.

## Порядок реализации

1. Проверить текущие mocks, lifecycle `start/stop` и очистку listener/state в
   `multi-control-api.test.js`.
2. Реализовать получение runtime ID Zerion для профилей и helper точного
   сопоставления extension ID + pathname.
3. Разделить в `_findNativeSlaveTab` режимы extension-popup и обычного URL.
4. Изменить `syncNewMasterTab`, исключив `createTab` только для Zerion-popup.
5. Добавить идемпотентный cleanup/re-mapping позднего native popup.
6. Добавить регрессионные и race-condition unit-тесты.
7. Обновить `docs/MULTI-CONTROL.md`.
8. Запустить целевые тесты, полный тестовый набор и lint.
9. При необходимости выполнить ручную проверку на Windows с master и несколькими
   slave под искусственной задержкой открытия popup.

## Проверка результата

Запустить:

```bash
npm test -- --run tests/unit/multi-control-api.test.js
npm test
npm run lint
```

Обязательные тестовые сценарии:

1. Master открывает Zerion-popup, slave открывает его позже чем через 300 мс:
   `createTab` не вызывается, native target находится, attach и mapping
   выполняются.
2. При активном длительном popup-wait вызов `/os-keyboard` с Enter не ожидает
   этот wait и завершается без многосекундной задержки.
3. В списке slave между попытками появляется обычный немапленный `http(s)`-tab:
   он не принимается за Zerion-popup.
4. Zerion-popup не появляется до истечения таймаута: искусственная вкладка не
   создаётся, ошибка не приводит к необработанному rejection.
5. Нераспознанный `chrome-extension://` URL после ошибки `resolveRuntimeId` не
   приводит к вызову `createTab`.
6. Обычный `_blank` не имеет native target вовремя: `createTab` вызывается и
   tab маппится как раньше.
7. Поздний native popup обнаруживается reconciliation-поллером после
   первоначального timeout.
8. Поздний native popup появляется после ошибочно созданного popup-target:
   ошибочный target закрывается, mapping указывает на native target.
9. Повторная обработка того же native target не создаёт дубликат и не закрывает
   правильный target.
10. Extension target с другим ID или pathname не маппится как Zerion-popup.
11. Remap выполняется in-place и не меняет порядок `tabIndex`; повторный polling
    не создаёт дублей и не переставляет master-target.

Ручная проверка:

1. Запустить master и минимум два slave, включить Multi-Control.
2. Нажать на кнопку подключения или подписания в Zerion.
3. Проверить, что во всех профилях открываются именно popup-окна, а не вкладки.
4. Повторить сценарий при высокой нагрузке или задержке ответа сайта.
5. Проверить синхронизацию мыши внутри popup и отсутствие вкладки-дубликата.
6. Проверить обычную ссылку с `_blank` и убедиться, что её поведение не
   изменилось.

## Критерии приёмки

- Zerion-popup определяется по runtime ID профиля и pathname, а не по одному
  префиксу `chrome-extension://`.
- Для Zerion-popup `Target.createTarget`/`createTab` не вызывается.
- Native popup ожидается до 2–3 секунд с повторным polling.
- Popup-wait для slave выполняется параллельно и не блокирует Enter через
  `discoverActiveTab()`.
- Случайные немапленные страницы не принимаются за wallet-popup.
- Нераспознанные `chrome-extension://` URL никогда не передаются в `createTab`.
- Поздний native popup заменяет ошибочный созданный target, а ошибочный target
  закрывается.
- Reconciliation обнаруживает native popup даже если WS-события не пришли.
- Remap сохраняет существующий порядок `tabIndex`.
- Обычные `http(s)` `_blank` и `window.open` сохраняют fallback через
  `createTab`.
- В popup синхронизируются мышь и остальные существующие события.
- Целевые тесты, `npm test` и `npm run lint` проходят.

## Риски и ограничения

- Runtime ID может разрешаться отдельно для разных профилей; нельзя полагаться
  только на имя директории расширения.
- Если ошибочный target был создан старой версией до появления runtime-реестра,
  его происхождение может быть невозможно доказать. Cleanup должен закрывать
  только target, явно зарегистрированный как созданный popup fallback.
- Если native popup не открылся вообще, slave останется без соответствующего
  popup-target. Это предпочтительнее создания обычной вкладки-дубликата.
- Изменение timeout увеличивает время ожидания обработки одного master-popup и
  требует сохранения защиты от параллельных `pendingSync`.
- Проверка должна гарантировать, что popup-target одного slave не будет ошибочно
  сопоставлен с другим master-target через `tabIndex`.
