# TASK — Снижение задержки курсора в MultiController

## Цель

Устранить задержку движения курсора на slave-профилях при работе пяти
одновременных профилей на оборудовании i7-8265U / 20 GB RAM.

Курсор slave не должен догонять master с задержкой 2–4 секунды из-за
избыточных `mousemove`, пересчёта траекторий и dispatch устаревших точек.

Отдельно устранить рассинхрон координат курсора после прокрутки: по видео
подтверждено, что после scroll курсор в slave визуально указывает не туда.
Источник проблемы — события содержат документные `pageX/pageY`, а текущая
формула дополнительно вычитает одновременно `masterScroll` и `slaveScroll`,
что при одинаковой прокрутке приводит к двойному вычитанию scroll.

## Согласованное решение

### 1. Throttling входящих mousemove

В `MultiController.onMouseMoved()` добавить throttling с интервалом 16 мс
(ориентировочно 60 обновлений/сек).

- Использовать стратегию `latest-event-wins`.
- Не обрабатывать все события, пришедшие в течение интервала.
- Хранить только последнее событие master.
- По истечении интервала вычислять координаты slave и вызывать `setTarget()`.
- Не допускать нескольких параллельных throttle-timer.
- Throttling является общим для controller, не отдельным для каждого slave.
- Pending должен хранить минимально необходимый payload master-события:
  позицию и scroll-контекст (`x`, `y`, `scrollX`, `scrollY`), достаточные для
  последующей конвертации координат slave.
- При `removeSlave()` не очищать общий pending, если остаются другие slave:
  последнее событие должно быть обработано для них. Полностью очищать pending
  и timer только при остановке controller или отсутствии slave.
- Не менять контракт входных событий и координатную конвертацию.

Throttling должен применяться только к движению мыши. События клика,
клавиатуры и scroll не задерживать этим механизмом.

### 2. Адаптивные параметры MouseSmoother

Выбирать параметры smoother в зависимости от количества slave. Spike на
установленной версии `ghost-cursor` показал, что уменьшение `moveSpeed`
увеличивает число точек и длительность траектории. Поэтому `moveSpeed` не
использовать как адаптивный ограничитель нагрузки: оставить его стабильным,
а нагрузку снижать через throttling, `stepInterval`, `maxPoints` и backpressure:

- 1–2 slave: `stepInterval=8`, `maxPoints=60`, `moveSpeed=5`;
- 3–4 slave: `stepInterval=12`, `maxPoints=40`, `moveSpeed=5`;
- 5 и более slave: `stepInterval=16`, `maxPoints=30`, `moveSpeed=5`.

Перед реализацией дополнительно выполнить короткий spike с реальным `path()`:
зафиксировать для `moveSpeed=5` и `moveSpeed=3` число исходных точек и
суммарную длительность timestamp-траектории. Ожидаемый результат для
`ghost-cursor@1.4.2`: уменьшение `moveSpeed` увеличивает оба показателя.
Отдельно проверить для согласованных профилей число точек после `maxPoints`,
фактическое число CDP dispatch и latency. Результат записать в итог
реализации/отчёт проверки.

Основными ограничителями нагрузки считать throttling, `maxPoints`,
`stepInterval` и backpressure. `moveSpeed` не использовать как единственный
механизм оптимизации.

Параметры должны передаваться существующему `MouseSmoother` через его options.
Не создавать новый менеджер или отдельный сервис только ради выбора профиля.
Не менять значения по умолчанию `MouseSmoother`, чтобы сохранить независимое
поведение класса и существующие unit-тесты.

При добавлении или удалении slave применять профиль по актуальному количеству
slave ко всем существующим smoother. Не пересоздавать объекты: обновлять их
`stepInterval` и `_maxPoints` на живых экземплярах. `moveSpeed` остаётся
фиксированным равным 5. Изменение параметров должно применяться к следующей
траектории и не ломать текущую анимацию.

### 3. Backpressure для устаревших точек

Текущий `_points` не является растущей очередью: `setTarget()` заменяет массив
точек. Реальная проблема состоит в том, что при задержке Event Loop `_tick()`
продолжает dispatch устаревших промежуточных точек.

Добавить временной backpressure, ориентированный на допустимое отставание.
Для timestamp-траекторий плановое время точки определяется относительно
момента старта текущей анимации: `dueAt = animationStart +
(point.timestamp - firstPoint.timestamp)`. Это работает и с абсолютными
timestamp из реального `ghost-cursor`, и с относительными timestamp в тестах.
Для режима без timestamp использовать время генерации траектории и
`stepInterval` как расписание. Отставание считать относительно планового
времени dispatch (`now - dueAt`), а не только относительно момента вызова
`setTarget()`.

При необходимости нормализовать timestamp после ресемплирования, сохранять и
интерполировать timestamp в `_resamplePoints()`. Нельзя допускать потери
timestamp: иначе существующий `_scheduleTick()` получает `NaN` и может перейти
на некорректное расписание.

Правила backpressure:

- базовый предел устаревания: около 75 мс (`maxLagMs`);
- при небольшом отставании dispatch выполнять штатно;
- при отставании выше `maxLagMs` пропускать промежуточные точки;
- dispatch выбирать ближайшую актуальную точку траектории;
- финальную точку текущей цели всегда сохранять;
- если устарели все промежуточные точки, сразу dispatch финальной точки и
  завершать анимацию, не проигрывая старый путь;
- не допускать dispatch точек старой анимации после смены target или `flush()`;
- механизм не должен нарушать `current`, `_target`, завершение анимации и
  точное попадание в target.

Не использовать `100px` как основной критерий backpressure: пространственный
порог зависит от скорости движения и хуже отражает задержку Event Loop. Если
параметр настраивается, оставить его внутренним option/константой, без нового
API или GUI-настройки в рамках этой задачи.

### 4. Мгновенный dispatch кликов

Сохранить существующий механизм `MouseSmoother.flush()`, который вызывается
перед `mousePressed` и `mouseReleased`.

Проверить и при необходимости скорректировать взаимодействие throttling и
`flush()`:

- отменять активный timer анимации;
- очищать промежуточные точки;
- отменять общий pending-throttle timer;
- использовать координаты события клика как актуальную цель для smoother,
  если последнее mousemove ещё не было обработано throttling;
- dispatch финальной координаты клика немедленно через существующий
  `_broadcastMouse()`;
- не допускать позднего выполнения pending mousemove после клика;
- сохранять точность координат клика через существующий `_broadcastMouse()`.

Не создавать отдельный механизм dispatch кликов.

### 5. Corrective fix: race condition при scroll

Для document scroll первоначальная wheel-реализация ниже superseded разделом
8: вместо сериализации wheel нужно сериализовать применение абсолютного
`scrollX/scrollY` через CDP. Алгоритм сериализации и coalescing описан только
в разделе 8; здесь остаются только требования к generation, отмене callback и
отсутствию устаревшей записи.

Ручная проверка выявила отдельную race condition в той же цепочке синхронизации:
несколько scroll-событий могут одновременно запускать применение состояния, а
отложенный `_syncSlaveScroll()` может записать устаревший `slaveData.scroll`.
Из-за этого визуальный scroll slave остаётся корректным, но `_toSlaveCoords()`
получает неправильный scroll и hover на ссылках после прокрутки рассинхронен.

Исправить проблему в рамках текущей задачи, не меняя внешний API и визуальную
семантику scroll:

- защитить `_syncSlaveScroll()` от записи результата устаревшей операции через
  generation/version или эквивалентный механизм;
- не допускать, чтобы старый sync перезаписал более новое состояние scroll;
- при `stop()` и `removeSlave()` не оставлять активные scroll-timer или callback,
  способные изменить состояние после удаления/остановки.

Сохранить существующий контракт событий `scroll`, `scrollX/scrollY`, `deltaX` и
`deltaY`. Внутренняя формула `_toSlaveCoords()` уточняется в разделе 6 с
учётом фактической семантики `pageX/pageY`.

### 6. Corrective fix: двойное вычитание scroll в координатах

`cdp-manager.js` передаёт `e.pageX/e.pageY`, то есть координаты документа.
Поэтому при преобразовании в координаты viewport slave необходимо вычитать
только фактический `slaveScroll`. `masterScroll` уже учтён в исходной
документной координате и не должен вычитаться повторно.

`Input.dispatchMouseEvent` в CDP принимает `x/y` в CSS-пикселях viewport
конкретного target/session, а не глобальные координаты рабочего стола Windows.
Положение окна на другом мониторе (`windowPositions.x/y`, например `1920,0`)
не меняет систему координат CDP и не должно участвовать в преобразовании.

- сохранить внешний контракт событий и формат `x/y = pageX/pageY`;
- использовать явную внутреннюю формулу `_toSlaveCoords()`:
  `slaveX = pageX - slaveScroll.scrollX`,
  `slaveY = pageY - slaveScroll.scrollY`;
- не вычитать `masterScroll` из этой формулы: `pageX/pageY` уже являются
  координатами документа, а не координатами viewport master;
- не добавлять `windowPositions` offset: координаты рабочего стола не являются
  координатами viewport, которые принимает `Input.dispatchMouseEvent`;
- учитывать только фактический `slaveScroll`;
- проверить одинаковый scroll master и slave: координата курсора в slave не
  должна смещаться вдвое;
- проверить разные значения scroll master и slave, click и mousemove после
  прокрутки;
- не менять координатный контракт, API и визуальную семантику scroll.

### 7. Corrective fix: устаревшее чтение фактического slave scroll

Раздел относится к проверке результата authoritative `window.scrollTo()`, а
не к чтению после dispatch `mouseWheel`.

Отложенный `getPageScroll()` может вернуть значение до завершения применения
последнего `scrollTo()` и затем перезаписать более актуальное локальное
состояние. Generation-защиты между разными операциями недостаточно для
устаревшего чтения внутри одной операции.

- учитывать версию последнего wheel-события при запуске и завершении
  `getPageScroll()`;
- не разрешать результату чтения, сделанного до нового wheel или до
  завершения серии, откатывать актуальный `slaveData.scroll`;
- после стабилизации scroll получать фактическое значение slave и применять
  его для последующей конвертации координат;
- при `stop()` и `removeSlave()` не допускать поздней записи результата
  асинхронного чтения.

### 8. Authoritative document scroll вместо wheel-dispatch

Для scroll основного документа master является единственным источником истины.
Slave не должны воспроизводить поток `mouseWheel`: он зависит от позиции
курсора, браузерного event loop, размеров страницы и может накапливать ошибку.

#### 8.1. Причина one-event lag

Текущий источник scroll ошибочен: `SYNC_EVENT_SCRIPT` отправляет состояние
`window.scrollX/scrollY` из обработчика `wheel`. Обработчик `wheel` выполняется
до того, как браузер применит новую прокрутку. Поэтому первое событие вниз
передаёт старое значение, slave отстаёт на один шаг, а при смене направления
первое событие передаёт старое значение предыдущего направления.

Наблюдаемая последовательность должна быть устранена именно сменой источника
состояния, а не дополнительной поправкой формулы:

```text
wheel #1 down: master event scrollY=0, фактический master scrollY ещё 0
после default action: master scrollY=100
wheel #2 down: master event scrollY=100, slave только теперь получает 100
```

#### 8.2. Новый источник authoritative scroll

- Не отправлять authoritative `scroll` из `wheel`-обработчика.
- В `SYNC_EVENT_SCRIPT` добавить обработчик фактического `window`-события
  `scroll`. Это событие приходит после изменения `window.scrollX/scrollY`.
- В payload authoritative события передавать абсолютные числовые
  `scrollX: window.scrollX` и `scrollY: window.scrollY`.
- `x/y`, `clientX/clientY` и `deltaX/deltaY` не использовать для определения
  document scroll. Их можно сохранять как диагностические поля, но отсутствие
  этих полей не должно блокировать scroll-синхронизацию.
- Если браузер выдаёт несколько `scroll` подряд, coalesce-ить их до последнего
  состояния. Не накапливать `deltaY` и не вычислять новое состояние slave из
  delta-событий.
- Если для совместимости требуется сохранить wheel-событие, использовать его
  только для диагностики; оно не должно вызывать `controller.scrollTo()`.
- Не регистрировать одновременно два независимых authoritative-источника,
  иначе один и тот же scroll может быть применён дважды.

- получать из master-события абсолютные `scrollX/scrollY` документа;
- coalesce-ить частые события до последнего состояния без backlog старых delta;
- применять абсолютное состояние на каждом slave исключительно через CDP
  `Runtime.callFunctionOn` с числовыми аргументами:
  `window.scrollTo(scrollX, scrollY)`;
- для каждого slave получать target/session через существующий
  `_getSlaveSession(slaveId)`; использовать возвращённый
  `session.sessionId` как CDP execution context для вызова в соответствующем
  slave target. Не выбирать первый session напрямую и не использовать
  глобальный master session;
- передавать `scrollX` и `scrollY` через аргументы `Runtime.callFunctionOn`,
  не встраивать значения в JavaScript-строку;
- не строить JavaScript конкатенацией строк и не передавать scroll через
  `Input.dispatchMouseEvent('mouseWheel')`;
- сериализовать применение scroll для каждого slave, чтобы старый вызов не
  завершился после нового и не перезаписал актуальное состояние;
- после применения читать фактический `window.scrollX/scrollY` slave;
- учитывать возможный clamp из-за отличающейся высоты документа: фактическое
  значение slave использовать в `_toSlaveCoords()`, а расхождение считать
  диагностическим показателем;
- `clientX/clientY` больше не являются обязательными для document scroll;
  отсутствие этих полей не должно блокировать прокрутку.

#### 8.3. Пошаговый алгоритм controller

1. Получить событие фактического `window.scroll` master с абсолютными
   `scrollX/scrollY`.
2. Обновить `controller.masterScroll` этим состоянием.
3. Для каждого slave, у которого есть smoother и актуальная session, увеличить
   generation и заменить `state.pending` последним `{ scrollX, scrollY,
   generation }`.
4. Запустить один controller runner на slave. Если runner уже выполняется,
   не запускать второй: он должен после текущего CDP-вызова взять новое
   `state.pending`.
5. Получить session только через `_getSlaveSession(slaveId)` и использовать
   её `session.sessionId`.
6. Вызвать только `Runtime.callFunctionOn` для этой session с функцией
   `function(x, y) { window.scrollTo(x, y); }` и аргументами `{ value: x }`,
   `{ value: y }`.
7. После завершения вызова проверить generation. Если пришло новое состояние,
   не записывать старый результат и сразу обработать последнее pending.
8. После успешного завершения `Runtime.callFunctionOn` запланировать один
   отменяемый `setTimeout` на существующий `SCROLL_TICK_MS = 16 мс`. Это и есть
   фиксированный стабилизационный интервал: не использовать неопределённое
   ожидание, цепочку произвольных таймеров или ожидание нового wheel.
9. По истечении этого timer вызвать существующую функцию
   `CdpManager.getPageScrollForSession(profileId, session.sessionId)` для той
   же session и записать фактическое состояние slave только при совпадении
   generation. Если за 16 мс пришло новое состояние, старый timer отменить или
   его результат отбросить.
10. При `stop()`/`removeSlave()` отменить pending и timer; поздний callback не
   должен менять `slaveData.scroll`.

#### 8.4. Ограничение CDP Runtime API

`Runtime.callFunctionOn` является единственным разрешённым способом применить
или прочитать authoritative document scroll в рамках этой задачи.

`_callFunctionOnSession()` уже существует в
`src/multi-control/cdp-manager.js` и не создаётся заново. Его задача в рамках
этой задачи — выполнять `Runtime.callFunctionOn` в переданной slave session.

- Удалить fallback на `Runtime.evaluate` в `_callFunctionOnSession()`.
- Не получать `window` через `Runtime.evaluate` для подготовки `objectId`.
- Использовать execution context/session, уже связанный с target slave, и
  передавать `sessionId` CDP-команды отдельно от JavaScript-аргументов.
- Не конкатенировать значения scroll в `functionDeclaration` или expression.
- При отсутствии корректной session/context считать применение неуспешным,
  увеличить диагностический счётчик discard и не подменять состояние slave
  фиктивным значением.

`getPageScrollForSession(profileId, sessionId)` также уже существует в
`src/multi-control/cdp-manager.js` и должен использовать тот же
`_callFunctionOnSession()` с функцией чтения
`function() { return [window.scrollX, window.scrollY]; }`. Новую публичную
функцию или REST-эндпоинт для чтения scroll не добавлять.

Внешний контракт события `scroll` сохранить: `x/y`, `deltaX/deltaY` и
`scrollX/scrollY` остаются доступными. `deltaX/deltaY` используются только для
диагностики и совместимости, не для расчёта целевого scroll slave.

В рамках этой задачи не реализовывать синхронизацию scrollable `div` и iframe:
они имеют отдельные scroll-контексты и требуют отдельного определения target,
frame и координат. Их поддержку оформить отдельной задачей.

### 9. Production-путь authoritative scroll

Событие фактического `window.scroll` проходит через `SYNC_EVENT_SCRIPT`,
`cdpManager.onEvent()`, `inputCapture.injectFromCdp()` и
`controller.scrollTo()`. Адаптеры не должны терять `scrollX/scrollY`.

- в `InputCapture.injectFromCdp()` сохранять `scrollX/scrollY` при передаче
  CDP scroll-event;
- `clientX/clientY` можно сохранять для будущей поддержки контейнеров, но не
  использовать как условие допуска document scroll;
- `inputCapture` не должен превращать `wheel` в authoritative `scroll`;
- только событие `scroll`, сформированное после изменения `window.scrollY`,
  должно вызывать `controller.scrollTo()`;
- native mouse/scroll path не подключать к `MultiController`: `InputCapture`
  работает в режиме `CDP mode`, native keyboard path не изменять;
- проверять полный production-путь, а не только прямой вызов `scrollTo()`;
- при `stop()` и `removeSlave()` отменять отложенное применение scroll и
  игнорировать поздние CDP callbacks.

### 10. Порядок реализации

1. Изменить `SYNC_EVENT_SCRIPT` в `src/multi-control/cdp-manager.js`:
   убрать вызов authoritative `emit('scroll', ...)` из `wheel` listener;
   добавить listener фактического `window.scroll`, передающий абсолютные
   `scrollX/scrollY` после browser default action.
2. Обновить `src/api/multi-control.js` и
   `src/os-input/input-capture.js`, чтобы только событие `scroll` проходило в
   `controller.scrollTo()`, а wheel не запускал scroll runner.
3. В `src/multi-control/index.js` проверить coalescing/generation runner:
   один runner на slave, pending заменяется последним абсолютным состоянием,
   старый async result не записывается.
4. В `src/multi-control/cdp-manager.js` оставить единственный путь
   `Runtime.callFunctionOn` с session из `_getSlaveSession(slaveId)`;
   удалить fallback `Runtime.evaluate` из `_callFunctionOnSession()`.
5. После `Runtime.callFunctionOn` читать фактический scroll через тот же
   target/session и обновлять `slaveData.scroll` только для актуального
   generation.
6. Добавить тесты на порядок событий: первое движение вниз уже применяет
   новое значение, первое движение вверх после смены направления не повторяет
   старое состояние.
7. Добавить production-chain тест, который отправляет сначала wheel, затем
   фактический scroll event, и проверяет, что только второй вызывает
   authoritative scroll.
8. Запустить целевые тесты, полный unit-набор и ручную проверку на пяти
   профилях с несколькими последовательностями down/down/up/up.

## Что не входит в задачу

- Idle jitter не добавлять: он не устраняет latency и создаёт дополнительную
  нагрузку на CDP.
- Не использовать `process.setPriority()`: приоритет Node-процесса не гарантирует
  приоритет Chrome-процессов и является платформозависимым.
- Не добавлять Prometheus/Grafana. Для текущей проверки достаточно unit-тестов и
  агрегированной debug-статистики;
  полноценный monitoring оформить отдельной задачей при необходимости.
- Debug-статистику хранить во внутреннем поле `MultiController._debugStats`;
  не добавлять REST-эндпоинт и не включать её в `getStatus()` в рамках этой
  задачи. Формат счётчиков:
  `mousemoveReceived`, `mousemoveProcessed`, `mousemoveCoalesced`,
  `stalePointsSkipped`, `dispatchCount`, `scrollEventsReceived`,
  `scrollSyncApplied`, `scrollSyncDiscarded`, `currentLagMs`,
  `maxLagMs`, `windowStartedAt`.
- `currentLagMs` и `maxLagMs` относятся к backpressure; `dispatchCount`
  используется вместе с `windowStartedAt` для расчёта dispatch/sec за
  диагностическое окно. Счётчики сбрасывать при `setMaster()`/`stop()`;
  `removeSlave()` не должен сбрасывать общую статистику controller.
- Для ручной проверки разрешить агрегированный `logger.debug` не чаще одного
  раза в секунду с этими счётчиками и производными `dispatchPerSecond` и
  `coalescingRate`; не логировать координаты, profile ID, токены или другие
  чувствительные данные.
- Не менять API, БД, security-модель, CDP-контракты и внешний координатный
  контракт. Допускается исправление внутренней формулы преобразования
  `pageX/pageY` в viewport-координаты slave в соответствии с фактической
  семантикой событий.
- Не менять `package.json`, lock-файлы и версию проекта.

## Затрагиваемые файлы

### Backend

- `src/multi-control/index.js` — общий controller-level throttling
  `onMouseMoved()`, обработка клика относительно pending-события, очистка
  pending-состояния, выбор и обновление адаптивного профиля параметров всех
  smoother, сериализация/коалесцирование scroll и защита актуальности
  `_syncSlaveScroll()`, исправление двойного вычитания `masterScroll` из
  документных координат, защита от устаревшего результата `getPageScroll()` и
  ведение внутреннего агрегированного `_debugStats`; authoritative document
  scroll через безопасный CDP-вызов и сериализация scroll по slave.
- `src/multi-control/cdp-manager.js` — безопасное выполнение
  `window.scrollTo(x, y)` в нужном target/session и чтение фактического
  scroll без конкатенации JavaScript-строк.
- `src/os-input/input-capture.js` — сохранять `scrollX` и `scrollY` при
  преобразовании CDP scroll-event в событие `InputCapture`; `clientX/clientY`
  не должны быть обязательными для document scroll.
- `src/api/multi-control.js` — передавать в `controller.scrollTo()` только
  authoritative `scroll` event, сформированное после фактической прокрутки
  master; wheel не должен запускать scroll runner.
- `src/multi-control/mouse-smoothing.js` — временной backpressure и защита
  от dispatch устаревших точек; сохранить публичные методы `setTarget()`,
  `flush()`, `stop()` и существующие defaults. Для защиты от отложенных
  callback старой анимации использовать внутренний идентификатор поколения
  (`animationId`/`generation`): callback обрабатывается только если его
  поколение совпадает с текущим.

### Тесты

- `tests/unit/multi-control.test.js`:
  - проверка единого controller-level latest-event-wins для всех slave;
  - проверка интервала throttling;
  - проверка отсутствия лишних `setTarget()`;
  - проверка адаптивных параметров для 1–2, 3–4 и 5+ slave, включая обновление
    уже созданных smoother;
  - проверка, что click/flush использует координаты click и не задерживается
    pending mousemove;
  - проверка, что scroll и keyboard проходят независимо от mouse throttling;
  - проверка очистки throttling при stop и корректного сохранения pending для
    оставшихся slave при removeSlave;
  - проверка циклов add/remove slave на отсутствие лишних timer.
  - проверка серии быстрых scroll-событий вверх/вниз: применяется последнее
    абсолютное состояние master без backlog delta-событий;
  - проверка, что document scroll slave выполняется через CDP scrollTo, а
    `mouseWheel` для document scroll не dispatch-ится;
  - проверка координат при одинаковом scroll master и slave: отсутствие
    двойного вычитания scroll;
  - проверка mousemove и click при разных scroll master/slave после серии
    scroll-событий;
  - проверка, что `getPageScroll()` начатый до нового scroll не перезаписывает
    более актуальное состояние даже в рамках той же scroll-серии.
  - следующие существующие проверки переписать, а не сохранять со старыми
    ожиданиями вычитания `masterScroll` или добавления offsets окон:
    - `_toSlaveCoords вычитает masterScroll из page-координат (баг 1)`;
    - `onMouseMoved пробрасывает реальный masterScroll в целевую точку`;
    - `_broadcastMouse (клик) использует реальный masterScroll`;
    - `учитывает scroll master при пересчёте координат`;
    - `учитывает scroll master и slave одновременно`.
  - переписать существующие проверки относительных координат, которые ожидают
    добавление `slaveWindow - masterWindow`:
    - `пересчитывает координаты master→slave со смещением окон`;
    - `координаты не уходят в минус` — проверять viewport bounds без offsets;
    - новые ожидаемые значения для первого теста: при `page=(100,200)`,
      `slaveScroll=(0,0)` результат `{ x: 100, y: 200 }` независимо от
      `masterWindow=(0,0)` и `slaveWindow=(2000,0)`;
    - новые ожидаемые значения для проверки отрицательного результата:
      при `page=(50,50)`, `slaveScroll=(0,0)` результат `{ x: 50, y: 50 }`,
      затем отдельно проверить clamp только для `page < slaveScroll`;
  - добавить проверку, что document scroll не зависит от `clientX/clientY`
    и не использует `{ x: 0, y: 0 }` или другие wheel-координаты.
  - добавить регрессионные тесты порядка событий:
    - первый scroll вниз сразу применяет новое абсолютное значение;
    - второй scroll вниз не является первым моментом движения slave;
    - первый scroll вверх после down двигает slave вверх;
    - второй scroll вверх не требуется для исправления позиции;
    - быстрые down/up/down оставляют slave на последнем абсолютном состоянии.
- `tests/unit/cdp-manager.test.js`:
   - обновить проверки `SYNC_EVENT_SCRIPT` для scroll, чтобы они подтверждали
     наличие числовых `scrollX: window.scrollX` и `scrollY: window.scrollY`;
  - добавить проверку, что существующие `x: e.pageX`, `y: e.pageY` и
    `scrollX/scrollY` не удалены;
   - добавить проверку, что document scroll не зависит от `clientX/clientY`;
   - добавить проверку, что `_callFunctionOnSession()` не использует
     `Runtime.evaluate` и вызывает только `Runtime.callFunctionOn` с
     `sessionId` и числовыми аргументами.
   - проверить, что после применения scroll чтение выполняется через
     существующий `getPageScrollForSession(profileId, sessionId)` после одного
     timer на `SCROLL_TICK_MS`, а не через `getPageScroll(profileId)` без
     session.
- `tests/unit/input-capture.test.js` либо существующий unit-тест `InputCapture`:
   - проверить, что `injectFromCdp({ type: 'scroll', ... })` передаёт
     `x/y`, `deltaX/deltaY` и `scrollX/scrollY` без потери;
   - проверить, что событие без `clientX/clientY` всё равно передаётся как
     document scroll, если содержит числовые `scrollX/scrollY`;
  - зафиксировать, что native hook не подключает mouse/scroll к
    `InputCapture`/`MultiController`, а native keyboard path не изменён.
- `tests/unit/multi-control-api.test.js`:
  - добавить проверку production-цепочки `CDP event → InputCapture →
    controller.scrollTo`;
   - убедиться, что scroll с `scrollX/scrollY` доходит до authoritative
     scroll-вызова и не пропускается из-за отсутствия `clientX/clientY`;
   - добавить регрессионную проверку отсутствия `mouseWheel` dispatch для
     document scroll.
   - отправить wheel без последующего scroll и убедиться, что
     `controller.scrollTo()` не вызывается;
   - отправить фактический scroll event после wheel и убедиться, что
     `controller.scrollTo()` вызывается один раз с новым `scrollY`.
   - проверить, что callback стабилизации через 16 мс отменяется или
     отбрасывается после нового generation.
- `tests/unit/mouse-smoothing.test.js`:
  - проверка пропуска устаревших точек при искусственной задержке;
  - проверка расчёта lag от `dueAt`, а не от времени последнего dispatch;
  - проверка сохранения финальной точки target;
  - проверка отсутствия dispatch после `flush()` и `stop()`;
  - проверка совместимости timestamp и non-timestamp режимов;
  - проверка сохранения/interpolation timestamp при ресемплировании;
  - проверка вызова `setTarget()` во время активной анимации и flush;
  - сохранение существующих проверок path, current и defaults.

## Проверка результата

1. Запустить целевые unit-тесты:

   ```bash
   npm test -- --run tests/unit/mouse-smoothing.test.js tests/unit/multi-control.test.js tests/unit/cdp-manager.test.js tests/unit/multi-control-api.test.js tests/unit/input-capture.test.js
   ```

2. Запустить полный набор unit-тестов:

   ```bash
   npm test
   ```

3. При наличии lint-конфигурации выполнить:

   ```bash
   npm run lint
   ```

4. Выполнить ручную проверку на Windows с пятью профилями:

   - запустить master и пять slave-профилей;
   - быстро перемещать мышь по master;
   - убедиться, что slave не догоняют координаты с задержкой в секунды;
   - проверить отсутствие заметных рывков при обычном движении;
   - проверить клик во время интенсивного движения мыши;
   - проверить scroll, mouseUp и остановку MultiController;
   - проверить hover на ссылках в верхней части страницы;
    - прокрутить вниз, проверить hover в master и всех slave;
    - прокрутить обратно вверх, проверить hover сразу и после прекращения
      прокрутки без задержки в несколько секунд;
    - выполнить последовательность `down → down → up → up` и убедиться, что
      первый шаг каждого направления сразу отражается во всех slave;
    - выполнить быстрые последовательности `down → up → down` и
      `up → down → up`, сравнивая фактические `masterScroll` и `slaveScroll`;
    - убедиться, что после остановки и повторного запуска старые timer и
     pending-события и scroll-callback не вызывают dispatch или изменения
     состояния.

5. Зафиксировать при ручной проверке измеримые показатели:

   - целевая визуальная/измеренная задержка slave — менее 200 мс;
   - при интенсивном движении не должно быть backlog dispatch с задержкой в
     секунды;
   - dispatch на один slave не должен устойчиво превышать примерно 60/сек при
     профиле для пяти slave;
   - CPU Node-процесса ориентировочно не должен превышать 15% на целевом
     оборудовании, с указанием условий измерения; это диагностическая цель, а
     не безусловный критерий провала из-за зависимости от фоновой нагрузки.

   Для измерения latency использовать агрегированную debug-статистику, а не
   debug-лог на каждый dispatch: считать число входящих/обработанных событий,
   пропущенных точек, текущий и максимальный lag, а также dispatch в секунду.
   Источник показателей — `_debugStats` и агрегированный debug-снимок не чаще
   одного раза в секунду. Не логировать координаты или чувствительные данные.

## Риски и ограничения

- Слишком агрессивное прореживание может сделать движение визуально менее
  плавным. Поэтому параметры для 1–2 slave сохраняются, а профиль для пяти
  slave ограничивается прежде всего `stepInterval`, `maxPoints` и
  backpressure.
- Throttling может потерять последнее движение перед кликом. Это устраняется
  сбросом pending mousemove и обязательным `flush()` перед dispatch клика.
- Пропуск точек может изменить форму ghost-cursor-траектории, но финальная
  координата и порядок событий должны сохраниться.
- Таймеры Node.js не гарантируют точный интервал при перегруженном Event Loop;
  backpressure должен уменьшать последствия задержки, а не предполагать точное
  расписание.
- При изменении внутренней семантики `_tick()` нельзя ломать существующие
  timestamp-тесты и поведение `current`.
- Проверка производительности на i7-8265U требует ручного запуска пяти
  реальных профилей; unit-тесты проверяют корректность, но не реальную нагрузку
  CDP и Chrome.

## Критерии приёмки

- При пяти slave входящие mousemove обрабатываются не чаще примерно одного
  раза за 16 мс на цикл throttling.
- В обработку попадает последнее актуальное событие, а не backlog старых
  координат.
- Для пяти slave используются параметры `16 / 30 / 5` соответственно
  `stepInterval / maxPoints / moveSpeed`.
- В spike зафиксирована обратная зависимость: в `ghost-cursor@1.4.2`
  уменьшение `moveSpeed` увеличивает исходные точки и timestamp-длительность.
- Снижение dispatch для пяти slave подтверждается профилем `16 / 30 / 5`
  через throttling, `maxPoints` и backpressure, а не через изменение
  `moveSpeed`.
- Устаревшие точки при задержке Event Loop пропускаются.
- Курсор slave не воспроизводит backlog с задержкой в секунды.
- Клик немедленно завершает текущую анимацию и dispatch-ит точную координату.
- `stop()` и `removeSlave()` не оставляют активных timer или pending-событий.
- После быстрых серий scroll применяется последнее абсолютное состояние
  master, без backlog delta-событий и отката старым результатом sync.
- При одинаковом scroll master и slave координаты курсора не получают
  двойную поправку scroll.
- Координаты `_toSlaveCoords()` не зависят от положения окон на рабочем столе
  и совпадают с viewport-координатами CDP slave.
- Для master на одном мониторе и slave на втором мониторе с любыми
  `windowPositions.x/y` результат `_toSlaveCoords()` остаётся тем же при
  одинаковых `page` и `slaveScroll`.
- `mousemove` и click после scroll используют корректные viewport-координаты
  slave при одинаковом и различающемся scroll.
- Устаревший результат `getPageScroll()` не перезаписывает более новое
  состояние внутри одной scroll-серии.
- Document scroll slave применяется через authoritative CDP `scrollTo` с
  числовыми аргументами и без `mouseWheel` dispatch.
- Authoritative payload формируется из фактического `window.scroll` после
  browser default action, а не из `wheel`; первый шаг down/up не отстаёт на
  одно событие.
- В последовательностях `down → down → up → up`, `down → up → down` и
  `up → down → up` каждый slave после каждого события получает последнее
  абсолютное состояние master.
- Отсутствие `clientX/clientY` не блокирует document scroll; `scrollX/scrollY`
  сохраняются в production-цепочке через `InputCapture`.
- Применение и чтение document scroll выполняются только через
  `Runtime.callFunctionOn` в session, возвращённой `_getSlaveSession()`;
  fallback `Runtime.evaluate` отсутствует.
- Native mouse/scroll path остаётся отключённым для `MultiController`, native
  keyboard path работает без изменений.
- Scrollable `div` и iframe явно не входят в текущую реализацию и не должны
  ошибочно считаться синхронизированными.
- Hover в master и всех slave остаётся синхронным до scroll, после scroll вниз
  и после возврата вверх.
- Внешний контракт и визуальная семантика scroll, mouseUp, keyboard и
  tab-синхронизации не изменены.
- Целевые и полные unit-тесты проходят.
- Не добавлены idle jitter, process priority, Prometheus/Grafana, новые
  зависимости, API-эндпоинты или изменения схемы БД.
