# TASK — Исправление дублирования и ошибочной рассылки ввода

## Цель

Исправить два связанных дефекта Multi-Control:

1. При вводе printable-символа в master символ появляется в slave ровно один
   раз, а не два.
2. При вводе или редактировании в любом slave событие не рассылается в другие
   окна и не повторяется в самом slave.

Пример приёмки: после ввода `1` в master во всех slave появляется один `1`;
после ввода `2` в одном slave только этот slave получает локальный `2`, остальные
окна не изменяются.

## Установленная причина

### Дублирование printable-ввода

Native keyboard hook отправляет для printable-клавиши два события:

- `keyDown` через `/api/multi-control/os-keyboard`;
- `charInput` через тот же endpoint.

`MultiController.onKeyDown()` отправляет в slave `Input.dispatchKeyEvent`, а
`MultiController.onCharInput()` затем отправляет `Input.insertText`. Браузер может
вставить символ уже на `keyDown`, после чего `insertText` вставляет его повторно.
В master при этом работает обычная нативная обработка клавиатуры, поэтому
симптом наблюдается прежде всего в slave.

### Рассылка ввода из slave

Native low-level hook видит клавиатуру глобально, но текущий payload не содержит
PID/идентификатор окна-источника. Backend считает любое событие вводом master и
передаёт его всем slave, включая окно, в котором пользователь фактически печатает.

`src/os-input/window-tracker.js` содержит заготовку для определения foreground
окна, но окна в multi-control через него не регистрируются. Подключать этот
неиспользуемый путь только ради данной задачи не следует.

## Согласованное решение

### 1. Передавать PID foreground-окна

В native hook на момент обработки каждого keyboard event получить PID
foreground window через уже используемый Windows API `GetForegroundWindow()` и
`GetWindowThreadProcessId()`.

- Добавить в `KeyEvent` поле `DWORD sourcePid`.
- Получать foreground window/PID один раз в `KeyboardProc` для каждого события,
  включая `keyUp`, и записывать PID в `KeyEvent`. Не вызывать эти API повторно
  только ради определения источника.
- Передать в `ComputeTextForKey()` уже полученные foreground window/thread data
  для выбора keyboard layout, чтобы сохранить текущую логику `ToUnicodeEx` без
  дополнительного вызова `GetForegroundWindow()`/`GetWindowThreadProcessId()`.
- Не оставлять PID только внутри `ComputeTextForKey()`: она вызывается лишь для
  `keyDown`, тогда как `keyUp` также обязан иметь source PID.
- Сохранить его в payload `buildKeyEvent()` для `keyDown` и `keyUp`.
- Добавить тот же PID в `charInput`, эмитимый из `native-hooks/index.js`, чтобы
  все три типа событий использовали один источник идентификации.
- Не логировать текст, токены или иные чувствительные данные.
- Не менять внешний REST endpoint и не добавлять новый endpoint.

### 2. Отсекать события, пришедшие не из master

В `/api/multi-control/os-keyboard` перед маршрутизацией keyboard event определить
PID master-профиля из существующей БД и сравнить его с PID источника.

- События с PID master направлять в `onKeyDown`, `onKeyUp` и `onCharInput`.
- События с PID slave считать локальным вводом и не вызывать controller.
- При неизвестном или отсутствующем PID не считать событие вводом master.
- Для внутренних unit-тестов явно передавать корректный master PID, а не вводить
  небезопасный fallback.
- Учитывать, что проверка выполняется как для `keyDown`, так и для `keyUp` и
  `charInput`, иначе состояние клавиш может рассинхронизироваться.

Проверка должна опираться на PID текущего master из профиля, а не на имя окна,
заголовок или координаты.

### 3. Разделить управляющие клавиши и printable-текст

Сохранить два существующих канала, но не использовать их одновременно для
одного printable-символа.

- Printable key event с непустым `text`, без `Ctrl`/`Meta`/обычного `Alt`
  (AltGr остаётся текстовым вводом) не отправлять в slave через
  `Input.dispatchKeyEvent`.
- Такой символ отправлять только через существующий `charInput` и
  `Input.insertText`.
- Управляющие клавиши, навигацию, Enter, Backspace, Delete, Tab, модификаторы и
  browser shortcuts продолжать передавать через key event по существующей
  логике.
- Не ломать комбинации с Shift и AltGr: modifier events должны сохраняться, а
  сформированный символ должен идти единственным текстовым каналом.
- Не использовать ненадёжный вариант с `keyDown` и принудительно пустым `text`:
  браузер всё равно может выполнить default text insertion.

`buildKeyEvent()` должен включать `text` из native event в payload `keyDown`,
чтобы backend определял printable event из единого keyboard payload без
дополнительного события или скрытого состояния. Не создавать новый сервис или
отдельный менеджер.

## Затрагиваемые файлы

### Реализация

- `src/os-input/native-hooks/hooks.cc` — получить foreground PID в момент
  keyboard event и передать его в JS payload.
- `src/os-input/native-hooks/index.js` — прокинуть PID и текст в нормализованные
  `keyDown`/`keyUp`/`charInput` события.
- `gui/src/main/keyboard-hooks-payload.js` — включить source PID и текст в
  формируемый keyboard payload, сохранив правила `shouldSendCharInput()`.
- `gui/src/main/keyboard-hooks.js` — отправлять обновлённый payload без
  дублирования дополнительных запросов и без логирования содержимого текста.
- `src/api/multi-control.js` — проверить source PID относительно PID master до
  вызова controller; пропускать события из slave.
- `src/multi-control/index.js` — не dispatch-ить printable `keyDown`, если его
  текст будет передан через `onCharInput`; сохранить forwarding управляющих
  клавиш и keyUp.

### Тесты

- `tests/unit/os-input.test.js` — проверить передачу source PID, text и
  сохранение `charInput` только для обычного текста, включая Shift/AltGr и
  исключения Ctrl/Meta/обычного Alt.
- `tests/unit/multi-control.test.js` — проверить, что printable input вызывает
  только один путь вставки в slave, а управляющие клавиши по-прежнему
  dispatch-ятся; проверить AltGr и modifier combinations.
- `tests/unit/multi-control-api.test.js` — получать PID master тем же паттерном,
  что и `focusWindowByPid()` (`pq.getById(masterId)?.pid`), проверить
  маршрутизацию событий с master PID и единообразное игнорирование
  `keyDown`/`keyUp`/`charInput` с slave или неизвестным PID.
- `tests/unit/keyboard-hooks-payload.test.js` — обновить ожидания payload и
  проверить отсутствие потери source PID/text.

Новые файлы не добавлять без необходимости. `window-tracker.js`, API-документы и
схему БД не менять: REST endpoint и структура БД не изменяются.

## Порядок реализации

1. Проверить существующие тестовые mock-профили и способ получения PID master в
   `multi-control-api.test.js`; добавить PID в mock-профили и payload fixtures в
   `multi-control-api.test.js`, `multi-control.test.js` и
   `keyboard-hooks-payload.test.js`.
2. Добавить source PID в native event и JS payload.
3. Добавить строгую фильтрацию источника в `/os-keyboard`.
4. Изменить forwarding printable keyboard events так, чтобы символ имел ровно
   один канал вставки.
5. Добавить/обновить unit-тесты на оба дефекта и на управляющие клавиши.
6. Запустить целевые тесты, затем полный unit-набор.
7. Выполнить ручную проверку на Windows с четырьмя профилями.

## Проверка результата

Запустить:

```bash
npm test -- --run tests/unit/os-input.test.js tests/unit/keyboard-hooks-payload.test.js tests/unit/multi-control.test.js tests/unit/multi-control-api.test.js
npm test
npm run lint
```

Если native addon требует пересборки после изменения `hooks.cc`, выполнить:

```bash
npm run build:native
```

Ручной сценарий на Windows:

1. Запустить четыре профиля, выровнять окна и включить синхронизацию.
2. Ввести `1` в поле master: в каждом slave должен появиться ровно один `1`.
3. Ввести `2` в поле одного slave: только этот slave должен получить один `2`;
   master и остальные slave не должны измениться.
4. Проверить последовательности `Backspace`, `Delete`, `Enter`, стрелки, `Tab`,
   `Ctrl+A`, `Ctrl+C`, `Ctrl+V`, Shift и AltGr.
5. Проверить ввод в нескольких slave по очереди.
6. Остановить и повторно запустить синхронизацию; убедиться, что старые
   listeners не создают повторную рассылку.

## Критерии приёмки

- Printable-символ из master появляется в каждом slave ровно один раз.
- Printable-символ из slave не появляется в master или других slave.
- Ввод в slave не дублируется самим multi-control.
- Управляющие клавиши и browser shortcuts сохраняют существующее поведение.
- AltGr и Shift не теряют символы и не создают повторные вставки.
- События с неизвестным source PID не рассылаются.
- После stop/start не возникает накопленных keyboard listeners.
- `npm test`, целевые тесты и lint проходят; native addon пересобран и проверен,
  если изменён `hooks.cc`.

## Риски и ограничения

- PID foreground-окна может быть недоступен в редком переходном состоянии; такие
  события безопасно отбрасываются, чтобы не рассылать ввод из slave.
- Изменение native payload требует пересборки `hooks.node` на Windows.
- Неправильная классификация printable event может сломать раскладки, dead keys
  или AltGr; обязательны тесты на эти случаи и ручная проверка.
- Key event без текста нельзя считать безопасным способом отключить вставку:
  именно поэтому printable keyDown должен быть исключён из CDP forwarding, а не
  только изменён.
- Тесты не заменяют ручную проверку реального foreground PID и поведения
  браузера на Windows.

## Что не входит в задачу

- Миграции БД и изменение схемы профилей.
- Изменение REST API contract или добавление новых endpoint.
- Подключение `windowTracker` и регистрация окон через новый lifecycle.
- Изменение синхронизации мыши, scroll, вкладок или раскладки окон.
- Изменение версии проекта, `package.json` или lock-файлов.
