# TASK — Устранить двойную передачу клавиатуры и прокрутки в multi-control

## Цель

Устранить дублирование событий в режиме синхронизации master/slave:

- одна физическая клавиша должна передаваться в slave ровно один раз;
- одна прокрутка должна передаваться в slave ровно один раз;
- повторный запуск и остановка multi-control не должны накапливать обработчики;
- browser-level сочетания клавиш, включая `Ctrl+W`, `Ctrl+T`, `Ctrl+1` и другие, должны обрабатываться глобальным Windows hook;
- обычный текстовый ввод, включая `Shift`, раскладку и специальные режимы ввода, не должен ломаться после удаления CDP-перехвата клавиатуры.

## Установленная архитектура и причина проблемы

### Клавиатура

Сейчас клавиатура поступает двумя путями:

1. `SYNC_EVENT_SCRIPT` в `src/multi-control/cdp-manager.js` внедряется в master-страницу и слушает `keydown`/`keyup`. Эти события проходят через `Runtime.bindingCalled`, затем через `inputCapture.injectFromCdp()` и `MultiController`.
2. `gui/src/main/keyboard-hooks.js` запускает native Windows keyboard hook. Он отправляет события на `POST /api/multi-control/os-keyboard`, где они также передаются в `MultiController`.

Один физический key event поэтому может попасть в slave из двух источников.

### Прокрутка

В текущем multi-control прокрутка перехватывается через CDP-инъекцию:

1. `SYNC_EVENT_SCRIPT` слушает DOM-событие `wheel`.
2. Событие передаётся через CDP binding.
3. `inputCapture.injectFromCdp()` эмитит событие `scroll`.
4. `MultiController.scrollTo()` передаёт `Input.dispatchMouseEvent` типа `mouseWheel` в slave.

`hook-worker.js` умеет перехватывать `WM_MOUSEWHEEL`, но в текущий multi-control не подключён. Native addon, используемый `keyboard-hooks.js`, перехватывает только клавиатуру.

### Накопление listeners

`wireInputToController()` в `src/api/multi-control.js` добавляет listeners к singleton `inputCapture` при каждом `POST /api/multi-control/start`. При `/stop` listeners не снимаются. Поэтому после повторного запуска один CDP `scroll` или другое CDP-событие обрабатывается несколькими listeners и повторно передаётся в controller.

## Согласованное решение

1. Сделать native Windows keyboard hook единственным источником клавиатурных событий.
2. Удалить из CDP-инъекции обработчики `keydown`, `keyup`, `charInput` и `browserAction`.
3. Оставить CDP-инъекцию для mouse и wheel-событий.
4. Оставить в `inputCapture` только listeners mouse/wheel, сделать их подключение идемпотентным и обязательно снимать их при остановке.
5. Сохранить текущую поддержку текстового ввода, добавив в поток native hook отдельную передачу printable text с учетом актуальной клавиши, modifiers и раскладки.

## План реализации

### Шаг 1. Проверить состояние репозитория и существующие контракты

1. Проверить `git status --short` и `git diff`, не изменять чужие незавершенные изменения.
2. Найти все использования `inputCapture`, `wireInputToController`, `injectFromCdp`, `keyboard-hooks`, `onKeyDown`, `onKeyUp`, `onCharInput`.
3. Зафиксировать, что `InputCapture` является singleton и что listeners multi-control должны регистрироваться только для текущего активного режима.
4. Проверить существующие unit-тесты controller, CDP manager, input capture и native hook, чтобы новые проверки соответствовали текущему стилю Vitest.

### Шаг 2. Убрать CDP-источник клавиатуры

Затрагиваемый файл: `src/multi-control/cdp-manager.js`.

1. Удалить из `SYNC_EVENT_SCRIPT` DOM listeners `keydown` и `keyup`.
2. Удалить генерацию `charInput` из CDP-скрипта, так как printable text будет поступать через native hook.
3. Удалить CDP-логику `browserAction`, включая перехват `Ctrl+W`/`Ctrl+T` через `preventDefault()`.
4. Не удалять listeners `mousemove`, `mousedown`, `mouseup`, `wheel`, `click` и `visibilitychange`, если они нужны для текущей синхронизации мыши, прокрутки и вкладок.
5. Проверить, что CDP binding по-прежнему используется для оставшихся событий и что удаление клавиатурного кода не меняет mouse/wheel flow.
6. Оставить `/api/multi-control/os-keyboard` ответственным за browser-level клавиатурные сочетания.

### Шаг 3. Сделать lifecycle `inputCapture` безопасным

Затрагиваемые файлы: `src/api/multi-control.js`, `src/os-input/input-capture.js`.

1. Вынести ссылки на функции-обработчики `mouseMove`, `mouseDown`, `mouseUp`, `scroll` в управляемую структуру, чтобы их можно было снять теми же ссылками.
2. Не регистрировать `keyDown`, `keyUp` и `charInput` в `wireInputToController()`: после удаления CDP-клавиатуры эти события приходят через HTTP endpoint `/os-keyboard` и не должны проходить через `inputCapture`.
3. Удалить из `src/os-input/input-capture.js` ветки `keyDown`, `keyUp` и связанное автоматическое создание `charInput` в `injectFromCdp()`. Оставить только реально используемые CDP-события mouse/wheel.
4. Добавить состояние, показывающее, что mouse/wheel listeners уже подключены.
5. При повторном вызове `wireInputToController()` не добавлять второй комплект mouse/wheel listeners.
6. В обработке `/api/multi-control/stop` снять только listeners, установленные multi-control, через `inputCapture.off(...)`; не использовать безусловный `removeAllListeners()`.
7. Сбрасывать состояние lifecycle после снятия listeners.
8. Если запуск завершается исключением после подключения listeners, выполнить cleanup в error/finally-пути, чтобы частично запущенный режим не оставлял обработчики.
9. Убедиться, что успешный новый запуск после stop снова подключает ровно один комплект listeners.

### Шаг 4. Сохранить полноценный ввод текста через native hook

Затрагиваемые файлы: `gui/src/main/keyboard-hooks.js`, при необходимости `src/os-input/native-hooks/index.js`, `src/os-input/native-hooks/hooks.cc` и `src/api/multi-control.js`.

1. Сохранить отправку `keyDown` и `keyUp` из native hook для всех клавиш и browser-level сочетаний.
2. Для printable клавиш добавить отдельное событие текста только когда это действительно обычный ввод, а не комбинация с `Ctrl`, `Alt` или `Meta`.
3. В native addon использовать Windows API `ToUnicodeEx()`, а не устаревший `ToAscii()`: получить текущий keyboard layout через `GetKeyboardLayout(0)`, собрать состояние modifiers/`CapsLock` через `GetKeyboardState()` и преобразовать `vkCode`/scan code в Unicode-строку.
4. Обработать результат `ToUnicodeEx()` явно:
   - положительный результат — передать полученную Unicode-строку как `charInput`;
   - нулевой результат — символ не сформирован, `charInput` не отправлять;
   - отрицательный результат — dead key; не отправлять промежуточный символ и корректно сохранить/сбросить состояние dead key перед следующим событием.
5. Учесть AltGr: не считать комбинацию `Ctrl+Alt` обычным текстовым вводом без проверки текущей раскладки; использовать состояние клавиатуры и результат `ToUnicodeEx()`, чтобы европейские AltGr-символы формировались как текст, но browser shortcuts не превращались в `charInput`.
6. Не пытаться имитировать IME простым `ToUnicodeEx()`: composition и committed text зависят от выбранного IME и не представлены надежно в `WH_KEYBOARD_LL`. Для IME не отправлять догадочный `charInput`; сохранить key events и зафиксировать необходимость отдельного IME text-input решения, если ручная проверка выявит регрессию.
7. Не использовать простое преобразование виртуального кода в нижний ASCII-символ как окончательное решение: оно не учитывает `Shift`, `CapsLock`, текущую раскладку, AltGr и Unicode.
8. Передавать в backend уже вычисленный текст отдельным событием с полем `text`, не логируя его содержимое.
9. В `/api/multi-control/os-keyboard` явно разделить обработку:
   - `keyDown` → `controller.onKeyDown(event)`;
   - `keyUp` → `controller.onKeyUp(event)`;
   - `charInput` → `controller.onCharInput({ text })`.
10. Не отправлять `charInput` для `Ctrl`, `Meta`, browser shortcuts и прочих командных сочетаний; AltGr обрабатывать только по результату layout-aware `ToUnicodeEx()`.
11. Проверить, что один printable key вызывает один `Input.insertText` в каждом slave и не вызывает дополнительный `charInput` из CDP.
12. Не логировать содержимое вводимого текста, пароли, токены и другие чувствительные данные.

### Шаг 5. Проверить обработку browser-level сочетаний

Затрагиваемые файлы: `gui/src/main/keyboard-hooks.js`, `src/api/multi-control.js`, при необходимости `src/multi-control/index.js`.

1. `Ctrl+W` должен закрывать соответствующие slave tabs через backend, а master tab должен закрываться штатно браузером без второго CDP browserAction.
2. `Ctrl+T` должен проходить через native hook и штатно обрабатываться master-браузером; discovery должен синхронизировать новый tab со slave.
3. `Ctrl+1` и аналогичные browser-level shortcuts должны передаваться hook-потоком один раз.
4. Проверить, что удаление CDP key listeners не вызывает повторного закрытия/создания вкладок.
5. Проверить отпускание modifier keys, чтобы после комбинаций не оставались зависшие состояния в slave.

### Шаг 6. Проверить прокрутку и разбивку wheel delta

Затрагиваемые файлы: `src/multi-control/index.js`, `src/api/multi-control.js`, при необходимости `src/multi-control/cdp-manager.js`.

1. Убедиться, что один CDP `wheel` вызывает один `controller.scrollTo()`.
2. Учесть, что `scrollTo()` может разбивать большую дельту на несколько `mouseWheel` вызовов по `SCROLL_STEP_PX`; это допустимо только если сумма отправленных дельт равна исходной.
3. Не подключать `hook-worker.js` к multi-control в рамках этой задачи, поскольку согласованным источником wheel остаётся CDP.
4. Проверить обновление master/slave scroll positions после одного события и после серии событий.
5. Проверить, что повторный start/stop не увеличивает число wheel-последовательностей.

### Шаг 7. Добавить и обновить тесты

Затрагиваемые файлы: существующие тесты рядом с проверяемыми модулями, прежде всего `tests/unit/multi-control.test.js`, `tests/unit/multi-control-api.test.js`, `tests/unit/cdp-manager.test.js`, `tests/unit/os-input.test.js`.

Добавить проверки:

1. Повторный вызов wiring-функции не добавляет listeners повторно.
2. После stop listeners сняты, а последующий CDP event не вызывает controller.
3. Сценарий `start → stop → start` создаёт ровно один рабочий комплект listeners.
4. Один CDP wheel вызывает одну обработку `scrollTo`.
5. Сумма нескольких `mouseWheel` шагов равна исходной delta.
6. `src/os-input/input-capture.js` больше не обрабатывает CDP `keyDown`, `keyUp` и не создаёт из них `charInput`.
7. Тесты `injectFromCdp` для keyDown/keyUp/charInput удалены или обновлены на проверку отсутствия мёртвого поведения.
8. CDP script больше не содержит `keydown`, `keyup`, `charInput` и `browserAction`.
9. Native hook keyDown/keyUp передаются в controller ровно по одному разу.
10. `/os-keyboard` маршрутизирует `charInput` в `controller.onCharInput({ text })`.
11. Printable text передаётся одним `charInput`/`insertText`.
12. `Shift`, `CapsLock`, английская/русская раскладка и AltGr проверяются на Windows; dead key не отправляет промежуточный символ.
13. Для IME не генерируется ложный `charInput`; IME composition/commit явно помечены как отдельное ограничение, если текущий hook не может их надежно получить.
14. `Ctrl`, `Meta`, `Ctrl+1`, `Ctrl+W` и `Ctrl+T` не создают лишних text events; AltGr проверяется отдельно по выбранной раскладке.
15. Повторная регистрация и cleanup работают при частично завершившемся запуске.

Если нативное вычисление символа нельзя надежно протестировать на CI без Windows keyboard layout, вынести чистое преобразование payload в тестируемую функцию и отдельно описать ручную Windows-проверку раскладок.

### Шаг 8. Проверить результат

1. Запустить `npm test`.
2. При наличии отдельных команд для GUI/native addon запустить соответствующие unit-тесты и сборочную проверку без изменения версии проекта.
3. Выполнить ручную проверку на Windows:
   - запустить sync;
   - нажать обычные клавиши и проверить однократный ввод в slave;
   - проверить `Shift`, `CapsLock`, русскую и английскую раскладки;
   - проверить `Ctrl+1`, `Ctrl+T`, `Ctrl+W`;
   - прокрутить master и сравнить величину прокрутки slave;
   - выполнить несколько циклов start/stop/start;
   - убедиться, что после каждого цикла нет удвоения.
4. Проверить логи: одно исходное событие не должно приводить к двум controller dispatch.
5. Проверить итоговый `git diff` и убедиться, что изменены только файлы этой задачи и тесты.

## Затрагиваемые файлы

### Основные

- `src/multi-control/cdp-manager.js` — убрать CDP-перехват клавиатуры, оставить mouse/wheel/tab events.
- `src/api/multi-control.js` — lifecycle listeners и маршрутизация native keyboard events.
- `src/os-input/input-capture.js` — удалить мёртвые CDP-ветки `keyDown`, `keyUp` и `charInput`.
- `gui/src/main/keyboard-hooks.js` — передача key events и printable text через native hook.

### Возможные дополнительные

- `src/os-input/native-hooks/index.js` — адаптация payload native addon.
- `src/os-input/native-hooks/hooks.cc` — получение фактического символа с учетом Windows keyboard state/layout.
- `src/multi-control/index.js` — только если потребуется уточнить маршрутизацию key/char/scroll или защиту от повторной обработки.

### Тесты

- `tests/unit/multi-control.test.js`.
- `tests/unit/multi-control-api.test.js`.
- `tests/unit/cdp-manager.test.js`.
- `tests/unit/os-input.test.js`.

## Ограничения и риски

- Не подключать второй глобальный mouse hook в рамках этой задачи.
- Не оставлять CDP и native hook одновременно источниками одних и тех же клавиатурных событий.
- Не использовать `removeAllListeners()` для singleton `inputCapture`.
- Не логировать введённый текст и секретные данные.
- Логи могут подтверждать тип, источник, виртуальный код и количество dispatch, но не должны содержать `text`, введённые символы, пароли или токены.
- Не менять версию проекта и release-файлы.
- Не менять security-модель API без отдельного согласования.
- Особое внимание уделить раскладкам, AltGr, CapsLock, IME и Unicode-вводу.
- После удаления CDP key listeners browser-level shortcuts должны продолжить работать через native hook.
- Если вычисление printable text на уровне native hook требует отдельной архитектуры или не может быть надежно реализовано в рамках текущего модуля, остановиться и вынести это как отдельное решение, не подменяя раскладку простым ASCII-маппингом.

## Критерии готовности

- Клавиша не дублируется при одном запуске и после повторных start/stop.
- Прокрутка не дублируется при одном запуске и после повторных start/stop.
- CDP script не слушает клавиатуру.
- Keyboard hook сохраняет browser-level shortcuts.
- Обычный текст корректно вводится с учетом `Shift` и выбранной Windows-раскладки.
- Listeners снимаются при stop и не регистрируются повторно.
- В логах отсутствует содержимое вводимого текста; присутствуют только безопасные диагностические метаданные.
- `npm test` проходит успешно.
- Ручная Windows-проверка пройдена для клавиатуры, текста, shortcuts и прокрутки.
