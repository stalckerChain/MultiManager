# Multi-Control Sync

Синхронизация действий между мастер-профилем и slave-профилями через CDP (Chrome DevTools Protocol).

## Архитектура

```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events + visibilitychange → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent(profileId, event, sessionId)
  ├── event.type === 'tabActivated' → targetId = targetBySid.get(sessionId)
  │                                   → controller.setActiveMasterTab(targetId)
  │                                   → _syncActiveTabToSlaves → activateAndFocusTarget
  ├── other events → controller.setActiveMasterTab(targetId)
  │                 → inputCapture.injectFromCdp()
  ↓ MultiController → broadcast → _getSlaveSession(slaveId)
  ↓ CDP Input.dispatch* → slave windows

CDP Target.targetInfoChanged (master browser)
  ↓ cdpManager.onTabActivated(profileId, targetId)
  ↓ controller.setActiveMasterTab(targetId)
  ↓ _syncActiveTabToSlaves → activateAndFocusTarget
```

## Режимы работы

### CDP-based синхронизация (основной)
- Мышь: движение, клик, скролл
- Клавиатура: нажатия, Enter, стрелки
- Текст: Input.insertText через charInput
- Навигация: master переходит → slave следует
- Переключение вкладок: активация в master → активация в slaves

### Native hooks (WH_KEYBOARD_LL)
- C++ addon перехватывает ВСЕ клавиши на уровне ОС через `WH_KEYBOARD_LL`
- HTTP POST → `/api/multi-control/os-keyboard`
- Единственный источник событий для browser chrome (адресная строка, tab bar)
- Также перехватывает browser shortcuts (Ctrl+T, Ctrl+W, etc.)
- **Double dispatch**: при вводе в DOM-элементе клавиши уходят в slave дважды (CDP + native hook)

## Tab Mapping (1:N)

### Структуры данных

```
tabMapping = Map<masterTargetId, Map<slaveId, slaveTargetId>>
tabIndex   = Array<masterTargetId>  // упорядоченная матрица (порядок создания)
```

- `tabMapping` — связь master-таба с slave-табами (1:N)
- `tabIndex` — массив masterTargetId в порядке их создания. Используется для маппинга slave-табов по индексу: если master создал N-й таб, то новый slave-таб с индексом N-1 маппится на master-таб с тем же индексом
- `mapTab(masterTargetId, slaveId, slaveTargetId)` — добавить маппинг + запись в tabIndex
- `unmapTab(masterTargetId, slaveId?)` — удалить маппинг + очистка tabIndex
- `getSlaveTabForMaster(masterTargetId, slaveId)` — получить slave-вкладку
- `getTabIndex(masterTargetId)` / `getActiveTabIndex()` — получить индекс таба в tabIndex
- `_getSlaveSession(slaveId)` — найти CDP-сессию slave через activeMasterTab → tabMapping
- `_maybeSwitchToPrevTab(destroyedMasterTargetId)` — при закрытии активного таба переключает фокус на предыдущий в tabIndex

## Ключевые эндпоинты

### POST /api/multi-control/start
Запуск multi-control с указанным мастер-профилем.

### POST /api/multi-control/stop
Остановка multi-control.

### POST /api/multi-control/slave/add
Добавление slave-профиля.

### POST /api/multi-control/slave/remove
Удаление slave-профиля.

### POST /api/multi-control/os-keyboard
Обработка системных клавиш (Ctrl+T, Ctrl+W).

### POST /api/multi-control/window-position
Установка позиции окна для slave.

## Источники событий (Event Sources)

Система получает события из двух независимых источников:

### CDP SYNC_EVENT_SCRIPT (DOM-события + tabActivated)
- Инжектится в master page через `Page.addScriptToEvaluateOnNewDocument`
- Ловит DOM-события: mousemove, mousedown, mouseup, wheel, keydown, keyup, click
- Ловит `visibilitychange` → при `document.hidden === false` эмитит `tabActivated`
- `tabActivated` → `Runtime.bindingCalled` → `onEvent` → `targetId = targetBySid.get(sessionId)` → `setActiveMasterTab(targetId)` → `_syncActiveTabToSlaves` → `activateAndFocusTarget`
- Активация Slaves происходит **только** через `tabActivated` (Master реально переключился на вкладку). Фоновое создание вкладок (middle-click, контекстное меню) не триггерит синхронизацию
- **Не ловит** события в browser chrome: адресная строка, tab bar, меню
- `tabActivated` не вызывает `injectFromCdp()` (фокус синхронизируется через CDP, не через OS input)
- Остальные события идут через `injectFromCdp()` → `controller.onKeyDown/onMousePressed/etc.`

### Native hooks (WH_KEYBOARD_LL)
- C++ addon перехватывает ВСЕ клавиши на уровне ОС
- HTTP POST → `/api/multi-control/os-keyboard`
- Идёт напрямую в `controller.onKeyDown/onKeyUp` (минуя `inputCapture`)
- **Всегда активен**, включая ввод в адресной строке
- Шлёт `keyDown`/`keyUp` для ЛЮБЫХ клавиш, не только Ctrl+T/W

### Double Dispatch (важно!)

Когда пользователь печатает текст в DOM-элементе master page (например, в `<input>` на сайте), **оба источника срабатывают одновременно**:

1. CDP script ловит keydown → `onKeyDown` → dispatch в slave
2. Native hook ловит ту же клавишу → `/os-keyboard` → `onKeyDown` → dispatch в slave

Одна и та же клавиша уходит в slave **дважды**. В случае Enter это может вызвать:
- Дублированное нажатие в форме
- Двойную отправку
- Непредсказуемое поведение (в т.ч. открытие нового таба)

> Double dispatch НЕ происходит для ввода в адресной строке (там нет DOM-событий).

## Создание новых вкладок (Tab Creation)

### Ctrl+T (работает, v0.9.5+)
1. Native hook перехватывает Ctrl+T через WH_KEYBOARD_LL
2. HTTP POST → `/api/multi-control/os-keyboard`
3. **Браузер мастера открывает вкладку нативно** — бэкенд НЕ вызывает `Target.createTarget` через CDP (антидетект-браузер игнорирует `e.preventDefault()`, поэтому CDP-создание приводило к дублированию табов)
4. HTTP `/json` polling (`discoverActiveTab()`) обнаруживает новую вкладку в течение ≤300 мс
5. `syncNewMasterTab()`:
   - Attach'ит таб мастера (ручной `Target.attachToTarget`, т.к. антидетект не шлёт `attachedToTarget`)
   - Для каждого слейва: проверяет наличие нативного таба через HTTP `/json` → если найден — attach+map, иначе `createTab`+attach+map
   - **Не активирует таб в слейвах** — активация произойдёт только когда Master реально переключится на новый таб (событие `tabActivated` через `visibilitychange`)

### `_blank` ссылки и `window.open` (РАБОТАЕТ через HTTP /json polling + tabIndex, v0.10.0)

**Проблема:** Антидетект-браузер не экспортирует нативно-открытые табы через CDP WebSocket:
- `Target.setAutoAttach` не работает → `Target.attachedToTarget` не приходит
- `Target.targetCreated` не приходит для нативно открытых табов
- `Target.getTargets()` через WS не возвращает такие табы

**Решение (v0.9.0):** HTTP DevTools endpoint `GET /json` — другой кодовый путь Chromium, не зависящий от WS-подписок. Polling `/json` каждые ~300мс находит новые табы.

**Доработка (v0.10.0):** Поиск нативных табов слейва через `tabMapping` вместо `targetSessions`:

1. Пользователь кликает `_blank` → master открывает Tab B нативно. Событие мыши диспатчится в slave → slave тоже открывает Tab B' нативно
2. Polling `/json` на master через ≤300мс находит Tab B
3. `syncNewMasterTab(B)`:
   - Attach'ит Tab B (мастер)
   - Для каждого slave вызывает `_findNativeSlaveTab()`:
     - HTTP GET `/json` слейва
     - Сравнивает с `tabMapping` (НЕ с `targetSessions`) — таб есть в `/json`, но его ещё нет в `tabMapping` для этого slave → нативный таб
   - Если найден — `attachToExistingTarget` + `mapTab(B, slaveId, B')`
   - Если нет (тайминг) — `createTab` + `attachToExistingTarget` + `mapTab(B, slaveId, B'')`
4. Активация в Slaves произойдёт только когда Master реально переключится на Tab B (событие `tabActivated`)

**Клики по `_blank` больше не перехватываются в sync-script** — мёртвый код удалён (0 срабатываний в логах).

### onNewTab для master/slave (v0.11.1)

**Master:** `onNewTab` больше не вызывает `setActiveMasterTab`. Новый таб только регистрируется в `attachedMasterTabs`. Активация в Slaves произойдёт только когда Master реально переключится на таб (`tabActivated` через `visibilitychange`). Это исключает ложную активацию при фоновом открытии вкладок (middle-click, контекстное меню "открыть в новом табе").

**Slave (v0.10.0+):** Раньше при `Target.targetCreated`/`attachedToTarget` для slave-таба, `onNewTab` маппил его на `controller.activeMasterTab`. Это было **некорректно**: активным мог быть старый таб, а новый таб маппился на него вместо правильного нового master-таба.

**Исправление (v0.10.0):** маппинг по порядку создания через `tabIndex`:

```javascript
const bc = cdpManager.browserConnections.get(profileId);
if (bc) {
  const slaveIdx = bc.targetSessions.size - 1;  // N-й таб слейва
  const masterTargetId = controller.tabIndex[slaveIdx];  // N-й таб мастера
  if (masterTargetId) {
    controller.mapTab(masterTargetId, profileId, targetInfo.targetId);
  }
}
```

Надёжность достигается тем, что `targetSessions.set()` вызывается до `onNewTab`, поэтому `bc.targetSessions.size` всегда отражает актуальное количество табов.

## Навигация (Navigation Sync)

### Когда маппинг есть (Ctrl+T)
`onNavigate` → `getSlaveTabForMaster(masterTargetId, slaveId)` → находит slaveTargetId → `navigateToSession()` → навигирует правильный таб в slave.

### Когда маппинга нет (`_blank`)
`onNavigate` → `getSlaveTabForMaster(masterTargetId, slaveId)` → null → **фолбэк**: `cdpManager.navigateTo(slaveId, url)` → `this.sessions.get(profileId)` → **первый/дефолтный таб** (Tab A'), а не Tab B'.

## Dispatch клавиш (Key Dispatch)

### `_getSlaveSession(slaveId)`
```javascript
_getSlaveSession(slaveId) {
  if (this.activeMasterTab) {
    const bySlave = this.tabMapping.get(this.activeMasterTab);
    if (bySlave) {
      const slaveTargetId = bySlave.get(slaveId);
      if (slaveTargetId) { return mapped; }  // маппинг есть → правильный таб
    }
  }
  // ФОЛБЭК: первая доступная сессия
  const first = bc.targetSessions.values().next().value;
  return first;
}
```

**Сценарий "Enter в адресной строке Tab B (master)":**

1. Пользователь печатает URL в Tab B (адресная строка)
2. `activeMasterTab` = Tab A (последнее CDP-событие было из Tab A)
3. Native hook шлёт все символы + Enter в `/os-keyboard` → `onKeyDown`
4. `_getSlaveSession(slaveId)` → `activeMasterTab` = Tab A → маппинг → Tab A'
5. **Enter уходит в Tab A'** (не в Tab B')
6. `onNavigate` от Tab B → фолбэк `navigateTo` → Tab A'
7. **Итог:** Tab A' получает и Enter, и навигацию. Tab B' остаётся на `about:blank`.

### Почему "открывается новый таб" (визуально)

Возможные причины:
- Tab A' (старый таб) навигируется на URL вместо Tab B' — пользователь видит, что "правильный" таб (выглядящий как новый) не получил контент
- Enter, отправленный в Tab A', при определённых условиях (пустая страница, new tab page) может инициировать открытие ещё одного таба в Chrome
- Double dispatch (native hook + CDP) при вводе в DOM-элементе может отправить Enter дважды

## Решение v0.9.0: HTTP /json polling (актуальное)

**WS-based подход (v0.7.0–v0.8.1) не сработал для нативных табов:** антидетект-браузер не шлёт ни `Target.targetCreated`, ни `Target.attachedToTarget` для табов, открытых через `_blank` или адресную строку. `Target.getTargets()` через WS тоже не возвращает их.

**Рабочее решение — HTTP DevTools endpoint `GET /json` + tabIndex matrix:**

1. **Polling** `discoverActiveTab()` раз в 300мс (setInterval при старте)
2. Запрос `GET http://127.0.0.1:{cdpPort}/json` — **другой кодовой путь Chromium**, не зависящий от WS-подписок
3. Сравнение списка табов из `/json` с известными табами мастера
4. Вновь появившийся page-таб = новый активный (эвристика: браузер автофокусирует новый таб)
5. `syncNewMasterTab(targetId, url)`: attach мастера → поиск нативных slave-табов через `/json` + tabMapping → createTab (если не найдены) → mapTab (добавляет в tabIndex). **Не активирует** — активация отложена до `tabActivated`

**Поиск нативных slave-табов** (отличие от v0.9.2):
- Старая логика (v0.9.2): сравнивала `/json` с `targetSessions` слейва — проигрывала race condition с CDP auto-attach (нативный таб уже был в `targetSessions`, но не в `tabMapping`)
- Новая логика (v0.10.0): сравнивает `/json` с `tabMapping` для конкретного slave — находит таб, даже если auto-attach уже добавил его в `targetSessions`

## Закрытие вкладок и возврат фокуса (v0.10.0)

### Ctrl+W
Native hook → `/os-keyboard` → закрытие slave-табов через CDP `Target.closeTarget` → удаление маппинга (`unmapTab`). Браузер мастера закрывает таб нативно.

### Target.targetDestroyed
`onTabDestroyed`:
1. Для master-таба: закрывает соответствующие slave-табы, удаляет маппинг
2. Вызывает `_maybeSwitchToPrevTab(targetId)`:
   - Если закрытый таб был активным — переключает `activeMasterTab` на предыдущий в `tabIndex`
   - Если закрытый таб не был активным — ничего не делает
3. Для slave-таба: `_unmapBySlaveTargetId` — находит master-таб по slaveTargetId и удаляет маппинг + вызывает `_maybeSwitchToPrevTab`

### Алгоритм `_maybeSwitchToPrevTab`
```javascript
_maybeSwitchToPrevTab(destroyedMasterTargetId) {
  if (this.activeMasterTab !== destroyedMasterTargetId) return;
  const destroyedIdx = this.tabIndex.indexOf(destroyedMasterTargetId);
  if (destroyedIdx <= 0) {
    if (this.tabIndex.length > 0) {
      this.setActiveMasterTab(this.tabIndex[0]);  // первый доступный
    }
    return;
  }
  this.setActiveMasterTab(this.tabIndex[destroyedIdx - 1]);  // предыдущий
}
```

### attachToExistingTarget (ключевой метод)

Антидетект не шлёт `Target.attachedToTarget`, поэтому attach нужно вызывать вручную:

```javascript
// Ручной attach через WS (не HTTP)
bc.ws.send({
  id: attachId,
  method: 'Target.attachToTarget',
  params: { targetId, flatten: true },
});
```

После успешного ответа: `_enableInput(session)` (binding + sync script).

### Обработка Ctrl+T (v0.9.5+)

1. Native hook → `/os-keyboard` → handler возвращает `{ ok: true, action: 'skip' }` — **браузер открывает таб нативно**
2. `discoverActiveTab()` (HTTP polling `/json` каждые 300 мс) обнаруживает новую вкладку мастера
3. `syncNewMasterTab(masterTargetId, url)`: attach мастера → проверка/создание табов слейвов → attach → map → activate

### Обработка `_blank`

1. Polling `/json` находит Tab B (нет в targetSessions)
2. `attachToExistingTarget(masterId, Tab B)` + `createTab` + `attachToExistingTarget` в слейвах
3. `mapTab` + `setActiveMasterTab(Tab B)`

### activateAndFocusTarget (v0.11.0)

Принудительная активация вкладки и установка DOM-фокуса в Slave через цепочку CDP-команд:

```javascript
async activateAndFocusTarget(profileId, targetId) {
  // 1. Переключение вкладки
  Target.activateTarget({ targetId })
  // 2. Вывод страницы на передний план
  Page.bringToFront({})
  // 3. Программный фокус ввода
  DOM.enable({})
  DOM.focus({ nodeId: 1 })
  // 4. Fallback: document.body.focus()
  Runtime.evaluate({ expression: 'document.body.focus()' })
}
```

Используется в `_syncActiveTabToSlaves` вместо старого `activateTarget`. Без этой цепочки `Input.dispatchKeyEvent`/`Input.dispatchMouseEvent` игнорируются движком страницы, так как сессия автоматизации не получает системный фокус ввода.

### Динамический поиск Slave-табов по URL/индексу (v0.11.0)

При отсутствии предустановленного маппинга в `tabMapping` (например, при переключении на таб, созданный до начала multi-control сессии):

1. `getPageTargets(masterId)` → URL активного master-таба
2. `getPageTargets(slaveId)` → список всех табов slave
3. Поиск по URL (исключая `about:blank`)
4. Fallback: сопоставление по порядковому индексу в `tabIndex`
5. `mapTab(masterTargetId, slaveId, slaveTargetId)` + `activateAndFocusTarget`

### await discoverActiveTab() перед Enter

В `/os-keyboard` добавлен вызов `await discoverActiveTab()` перед `keyDown` с `key === 'Enter'`. Это гарантирует, что Enter уходит в актуальный таб:

```javascript
if (event.type === 'keyDown' && event.key === 'Enter') {
  await discoverActiveTab();
}
```

### Что изменилось в коде (v0.9.0)

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | `getHttpTabs()` — HTTP GET /json, `attachToExistingTarget()` — ручной attach с `_enableInput`; хранение `cdpPort` в `browserConnections`; `http` импорт на верхнем уровне; удалён `_blank`-перехват из `SYNC_EVENT_SCRIPT` |
| `src/api/multi-control.js` | `discoverActiveTab()` через `getHttpTabs()` (вместо `getPageTargets`); `syncNewMasterTab(targetId, url)` — attach мастера + create+attach slave + map + activate; `attachedMasterTabs` Set; `onNewTab` для мастера только трекает таб (создание slave делает `syncNewMasterTab`); `/os-keyboard` делает `await discoverActiveTab()` перед Enter; очистка `pendingSync`/`attachedMasterTabs` в `/stop`; удалён мёртвый `openTab` handler |
| `tests/unit/cdp-manager.test.js` | Тесты `getHttpTabs` (фолбэки, фильтрация), `attachToExistingTarget` (существующая сессия, attach+enableInput, ошибка) |
| `tests/unit/multi-control-api.test.js` | Тесты `syncNewMasterTab` (создание slave, дедуп, guard inactive), `discoverActiveTab` (обнаружение по разнице knownTargets/`/json`) |

### Известные ограничения

- **Orphaned native tabs (уменьшено в v0.10.0):** Если нативный slave-таб открыт (от диспатченного ивента), но не обнаружен `_findNativeSlaveTab` (тайминг), `syncNewMasterTab` создаёт CDP-таб. Нативный таб остаётся orphaned. `_findNativeSlaveTab` теперь использует сравнение с `tabMapping` вместо `targetSessions`, что значительно снижает вероятность.
- **Polling latency:** Обнаружение нового таба через HTTP /json может занимать до 300мс. Enter перед `/os-keyboard` делает `await discoverActiveTab()` — это добавляет до ~50-100мс к вводу.
- **HTTP /json недоступен:** Если браузер не отвечает на HTTP DevTools endpoint (заблокирован, сломан), система слепнет к новым табам. `_discoverWsUrl` уже использует `/json`, так что риск мал.

## Структура файлов

| Файл | Назначение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | CDP connection, dispatch, navigation, createTab, activateTarget |
| `src/multi-control/index.js` | MultiController (broadcast, tabMapping 1:N, tabIndex matrix, focus switching, MouseSmoother integration) |
| `src/multi-control/mouse-smoothing.js` | MouseSmoother: ghost-cursor path() trajectory + setTimeout dispatch loop |
| `src/api/multi-control.js` | API routes + CDP event wiring + os-keyboard + tab mapping + slave tab discovery |
| `src/api/window-arranger.js` | Window arranger (taskbar-aware) |
| `src/os-input/input-capture.js` | EventEmitter wrapper (CDP mode) |
| `src/os-input/native-hooks/hooks.cc` | C++ addon: WH_KEYBOARD_LL via N-API |
| `gui/src/main/keyboard-hooks.js` | Electron main process: bridges native hooks to backend API |

## Архитектурные решения

1. **CDP-based sync** — правильный подход для антидетект-браузера (не Windows API)
2. **Native C++ addon** для WH_KEYBOARD_LL — koffi trampoline не работает для синхронных callback
3. **Гибрид**: CDP для mouse/keyboard + native hooks для browser shortcuts
4. **Tab mapping 1:N** — `Map<masterTargetId, Map<slaveId, slaveTargetId>>` каждый slave маппится отдельно
5. **tabIndex matrix** — `Array<masterTargetId>` для маппинга по порядку создания. Позволяет `onNewTab` для slave корректно определять master-таб по индексу (N-й slave → N-й master)
6. **onClick = no-op** — mousePressed+mouseReleased из mouseDown/mouseUp уже генерируют DOM click
7. **WorkingArea** вместо Bounds — taskbar-aware window positioning
8. **Прямой createTab для Ctrl+T** — `Target.setAutoAttach` не работает в антидетект-браузере, поэтому создаём вкладки через API напрямую
9. **HTTP /json polling** — единственный надёжный способ обнаружить нативно-открытые табы в антидетект-браузере; WS-based методы (`targetCreated`, `getTargets`) не работают
10. **Поиск нативных slave-табов через tabMapping** (не targetSessions) — исключает race condition с CDP auto-attach. Нативный таб может быть уже в `targetSessions`, но не в `tabMapping` — значит, это наш кандидат
11. **Фокус на предыдущий таб при destroy** — `_maybeSwitchToPrevTab` использует `tabIndex` для переключения на предыдущий таб в порядке создания
12. **Трёхшаговая активация фокуса в Slave** — `Target.activateTarget` (переключение вкладки) → `Page.bringToFront` (вывод на передний план) → `DOM.focus` (программный фокус ввода). Без `DOM.focus` движок Chromium игнорирует эмулируемые события `Input.dispatchKeyEvent`/`dispatchMouseEvent`
13. **`visibilitychange` как единственный надёжный детектор переключения вкладок** — `Target.targetInfoChanged` не содержит признака активации вкладки. `visibilitychange` ловит все сценарии: Ctrl+Tab, Ctrl+Shift+Tab, Ctrl+1..9, клики по tab bar. Событие передаётся через `Runtime.bindingCalled` → разрешение `targetId` из `sessionId`
14. **Принудительная реактивация фона в Slave при background-табах** — `_enforceSlaveFocusOnActiveTab` отправляет полную цепочку фокуса (`activateAndFocusTarget`: `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()`) сразу после `mapTab`, если новый таб не является `activeMasterTab`. Chromium в Slave автоактивирует табы, созданные через `Input.dispatchMouseEvent` — одного `Target.activateTarget` недостаточно для закрепления DOM-фокуса, поэтому используется та же цепочка, что и в `_syncActiveTabToSlaves`
15. **Гибрид: наш MouseSmoother loop + математика ghost-cursor path()** — high-level API GhostCursor.click/scroll требует Puppeteer/Playwright page object, что недоступно на голом CDP. Экспорт `path(start, end, options)` — чистая синхронная функция, возвращающая массив точек {x,y} с кубической Безье, Fitts's Law и overshoot. Наш loop диспатчит точки через setTimeout, flush() перед кликом гарантирует точную позицию

## Версия

Текущая: v0.14.0 (Coordinate fix: page→viewport конвертация + multi-tab sync)

## История версий

### v0.14.0 — Coordinate fix: page→viewport конвертация + multi-tab sync

**Проблема 1:** Координаты кликов и hover не синхронизировались после прокрутки.
\_toSlaveCoords\ неправильно конвертировала page-координаты в viewport: \pageX - masterScrollX + slaveScrollX + offsetX\ давала \clientX + slaveScrollX + offsetX\ вместо \clientX + offsetX\.

**Исправление 1:** Формула изменена на \pageX - slaveScrollX + offsetX\.

**Проблема 2:** \masterScroll\ был статическим снапшотом и не обновлялся при прокрутке.

**Исправление 2:** \masterScroll\ обновляется накоплением дельт в \scrollTo\.

**Проблема 3:** Синхронизация ломалась при открытии нового таба. \setActiveMasterTab\ вызывался только для \mouseDown\, \	abActivated\ — \ctiveMasterTab\ не обновлялся при interactions с другим табом → \_getSlaveSession\ искал slave по устаревшему табу.

**Исправление 3:** Убран фильтр исключений — \setActiveMasterTab\ вызывается для ВСЕХ событий от master.

| Файл | Изменение |
|------|-----------|
| \src/multi-control/index.js\ | \_toSlaveCoords\: исправлена формула конвертации координат; \scrollTo\: \masterScroll\ обновляется при скролле |
| \src/api/multi-control.js\ | \onEvent\: убран фильтр исключений из \setActiveMasterTab\ |
| \	ests/unit/multi-control.test.js\ | Обновлён тест scroll-координат (slave scroll вместо master scroll) |

### v0.13.0 — Human-like движения: ghost-cursor path() + плавный скролл

- Курсор в слейвах движется по человеческой траектории (ghost-cursor path(): кубическая Безье + Fitts's Law + overshoot) вместо телепортации между точками
- Наш MouseSmoother loop диспатчит точки в CDP слейва, flush() перед mousePressed гарантирует точность клика
- Скролл разбивается на серию мелких wheel-dispatch'ей (SCROLL_STEP_PX=40, SCROLL_TICK_MS=16)
- Удалён дублирующий throttle в InputCapture, THROTTLE master-page уменьшен 25→16 мс
- Новая зависимость: ghost-cursor

| Файл | Изменение |
|------|-----------|
| `src/multi-control/mouse-smoothing.js` | Новый класс MouseSmoother: ghost-cursor path() генерирует траекторию, setTimeout-цепочка диспатчит точки. flush() перед кликом, setTarget() пересчитывает путь из текущей позиции |
| `src/multi-control/index.js` | Интеграция MouseSmoother: onMouseMoved → smoother.setTarget, onMousePressed/Released → smoother.flush(). Удалён throttle 25мс, mouseBuffer, throttleTimer. Новый _dispatchSlaveMove, _runScrollSequence |
| `src/multi-control/cdp-manager.js` | SYNC_EVENT_SCRIPT: THROTTLE 25→16 мс |
| `src/os-input/input-capture.js` | Удалён throttle 16мс в _onMouseMove — mouseMove эмиттится немедленно |
| `tests/unit/mouse-smoothing.test.js` | 7 тестов MouseSmoother: dispatch, flush, stop, pathFn injection, stepInterval |
| `tests/unit/multi-control.test.js` | Обновлены: smoother интеграция, flush перед кликом, scroll разбивается на шаги |
| `tests/unit/os-input.test.js` | Обновлены: mouseMove без throttle |
| `package.json` | Новая зависимость: ghost-cursor |

### v0.12.1 (2026-07-04) — Fix: enforceSlaveFocusOnActiveTab использует activateAndFocusTarget

**Проблема:** Middle-click по ссылке или "открыть в новом табе" через контекстное меню в Master открывает вкладку в фоне (фокус остаётся на исходной). При диспатче события мыши в Slave, Chromium в Slave-окне активирует новую вкладку — фокус уходит на неё, ломая синхронизацию. v0.12.0 пытался вернуть фокус через `Target.activateTarget`, но одного этого вызова **недостаточно** — Chromium не закрепляет DOM-фокус ввода без `Page.bringToFront` + `DOM.focus` (тот же вывод, что и в v0.11.0 для `_syncActiveTabToSlaves`).

**Корень:** `_enforceSlaveFocusOnActiveTab` использовал fire-and-forget `Target.activateTarget` вместо полной цепочки активации, уже реализованной в `cdpManager.activateAndFocusTarget` и применяемой в `_syncActiveTabToSlaves`.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/index.js` | `_enforceSlaveFocusOnActiveTab`: метод стал `async`, заменён вызов `this.cdp.activateTarget(...)` → `await this.cdp.activateAndFocusTarget(...)`. Добавлен `try/catch` с логированием ошибок |
| `src/api/multi-control.js` | `syncNewMasterTab`: добавлен `await` перед `_enforceSlaveFocusOnActiveTab` в обеих ветках (native-tab и create-tab). `onTabAttached`: fire-and-forget с `.catch(err => logger.error(...))` — синхронный callback не должен блокировать WS message handler |
| `tests/unit/multi-control.test.js` | Все 5 тестов `_enforceSlaveFocusOnActiveTab` стали `async` + проверки переведены с `activateTarget` на `activateAndFocusTarget`. Добавлен тест на логирование ошибки при rejected promise |
| `tests/unit/multi-control-api.test.js` | `MockCdpManager`: добавлен `activateAndFocusTarget` (пушит в `activateCalls`), `_enforceSlaveFocusOnActiveTab` стал `async`. Тестовая копия `syncNewMasterTab` использует `await`. Тесты `onTabAttached` стали `async` с flush через `setTimeout(0)` |

**Поведение:** Middle-click / контекстное меню → таб создаётся в Slaves → `_enforceSlaveFocusOnActiveTab` прогоняет полную цепочку `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()`, закрепляя DOM-фокус на исходном табе. Когда Master реально переключается (Ctrl+Tab, клик по tab bar, `visibilitychange` → `tabActivated`) — фокус в Slaves переключается через штатный `_syncActiveTabToSlaves`.

### v0.12.0 (2026-07-03) — Fix: enforce focus on active tab in slaves after background tab creation

**Проблема:** Middle-click по ссылке или "открыть в новом табе" через контекстное меню в Master открывает вкладку в фоне (фокус остаётся на исходной). При диспатче события мыши в Slave, Chromium в Slave-окне автоматически активирует новую вкладку — фокус уходит на неё, ломая синхронизацию.

**Корень:** `Input.dispatchMouseEvent` с button 'middle' в Chromium Slave создаёт и активирует новый таб, в то время как в Master таб остаётся фоновым. Предыдущее решение (v0.11.1) отложило активацию до `tabActivated`, но не реактивировало исходный таб в Slave принудительно.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/index.js` | Добавлен `_enforceSlaveFocusOnActiveTab(slaveId)` — fire-and-forget `Target.activateTarget` для принудительного возврата фокуса на вкладку, соответствующую `activeMasterTab` |
| `src/api/multi-control.js` | `syncNewMasterTab`: после `mapTab` для каждого slave, если `masterTargetId !== activeMasterTab`, вызывается `_enforceSlaveFocusOnActiveTab`. `onNewTab` для slave: то же после `mapTab` по `tabIndex` |
| `tests/unit/multi-control.test.js` | 4 новых теста: `_enforceSlaveFocusOnActiveTab` (активация правильного таба, guard без activeMasterTab, guard без маппинга, без cdp) |
| `tests/unit/multi-control-api.test.js` | 5 новых/обновлённых тестов: реактивация activeMasterTab, отсутствие реактивации когда таб == active, когда activeMasterTab не задан |

**Поведение:** Middle-click / контекстное меню → таб создаётся в Slaves → `_enforceSlaveFocusOnActiveTab` немедленно реактивирует исходный таб в каждом Slave (Chromium не успевает "закрепить" фокус на новом табе). Когда Master реально переключается (Ctrl+Tab, клик по tab bar, `visibilitychange` → `tabActivated`) — фокус в Slaves переключается на соответствующий таб через штатный `_syncActiveTabToSlaves`.

### v0.11.1 (2026-07-03) — Fix: no forced activation on background tabs (middle-click, context menu)

**Проблема:** Middle-click по ссылке или "открыть в новом табе" через контекстное меню в Master открывает вкладку в фоне (фокус остаётся на исходной). `onNewTab` и `syncNewMasterTab` форсированно вызывали `setActiveMasterTab`, что переключало фокус в Slaves на новый таб — поведение отличалось от Master.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/api/multi-control.js` | `syncNewMasterTab`: удалены `setActiveMasterTab` и `_syncActiveTabToSlaves`. `onNewTab` для master: удалён `setActiveMasterTab`. Новые табы только регистрируются, активация отложена до `tabActivated` |
| `tests/unit/multi-control-api.test.js` | Удалены тесты на активацию в `syncNewMasterTab`. `discoverActiveTab` и `onNewTab` больше не ожидают изменения `activeMasterTab`. Добавлен тест `never activates slave tabs` |

**Поведение:** Middle-click / контекстное меню → таб создаётся в Slaves, но фокус остаётся на текущем табе. Когда Master реально переключается (Ctrl+Tab, клик по tab bar, Ctrl+1..9), `visibilitychange` → `tabActivated` → `setActiveMasterTab` → синхронизация.

### v0.11.0 (2026-07-03) — Focus sync via activateAndFocusTarget + visibilitychange wiring

**Проблема:** Переключение вкладок в Master (Ctrl+Tab, клик по панели вкладок) корректно отрабатывало в Master-окне, но Slave-окна не получали DOM-фокус ввода. Последующая трансляция нажатий клавиш игнорировалась, пока пользователь не кликал в область страницы каждого Slave.

**Корень:** `_syncActiveTabToSlaves` использовал `Target.activateTarget`, который переключает видимость вкладки, но не устанавливает DOM-фокус. Кроме того, `tabActivated` из `visibilitychange` игнорировался.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | Добавлен `_sendAndWait` — утилита для отправки CDP-команды с ожиданием ответа. Добавлен `activateAndFocusTarget(profileId, targetId)` — цепочка `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()`. `visibilitychange` возвращён в `SYNC_EVENT_SCRIPT` |
| `src/multi-control/index.js` | `_syncActiveTabToSlaves` переведён на `async`. Использует `activateAndFocusTarget` вместо `activateTarget`. Добавлен динамический поиск slave-табов по URL/индексу при отсутствии маппинга |
| `src/api/multi-control.js` | `tabActivated` в `onEvent` больше не игнорируется: resolves `targetId` через `targetBySid.get(sessionId)` → `setActiveMasterTab`. Добавлен `await` перед `_syncActiveTabToSlaves` в `syncNewMasterTab` |
| `tests/unit/cdp-manager.test.js` | 3 новых теста: `activateAndFocusTarget` (без connection, цепочка команд, fallback body.focus, без session) |
| `tests/unit/multi-control.test.js` | 4 новых теста: URL-матчинг slave, index fallback, missing master target. Обновлены все тесты на `activateAndFocusTarget` |
| `tests/unit/multi-control-api.test.js` | Тест `tabActivated` теперь проверяет вызов `setActiveMasterTab` (вместо игнора). Добавлен тест `ignores tabActivated with unknown sessionId` |

### v0.10.0 (2026-07-03) — Dynamic tab sync: tabIndex matrix, native slave tab fix, focus return

**Проблемы:**
1. `onNewTab` для slave маппил новый таб на `activeMasterTab` (старый таб) вместо нового master-таба — критический баг, ломавший синхронизацию при `_blank`/`window.open`
2. `syncNewMasterTab` искал нативные slave-табы через `targetSessions`, проигрывая race condition с CDP `Target.setAutoAttach` — нативный таб уже был в `targetSessions`, поиск не находил его, создавался дубликат
3. При закрытии master-таба фокус синхронизации не возвращался на предыдущий таб

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/index.js` | Добавлен `tabIndex` (упорядоченный массив masterTargetId). `mapTab` добавляет в `tabIndex` при первом маппинге. `unmapTab`/`_unmapBySlaveTargetId` чистят `tabIndex`. Добавлен `_maybeSwitchToPrevTab` — возврат фокуса на предыдущий таб. Добавлены `getTabIndex`/`getActiveTabIndex` |
| `src/api/multi-control.js` | `onNewTab` для slave: маппинг по `tabIndex[slaveIdx]` вместо `activeMasterTab`. `syncNewMasterTab`: поиск нативных табов через `_findNativeSlaveTab` (сравнение `/json` с `tabMapping`, не с `targetSessions`). `onTabDestroyed` вызывает `_maybeSwitchToPrevTab` |
| `tests/unit/multi-control.test.js` | 11 новых тестов: tabIndex (ordered matrix, порядок, очистка), getTabIndex/getActiveTabIndex, _maybeSwitchToPrevTab (3 сценария), _unmapBySlaveTargetId + focus |
| `tests/unit/multi-control-api.test.js` | Обновлены тесты onNewTab (tabIndex-based mapping), onTabDestroyed (focus return) |

### v0.9.0 (2026-07-01) — HTTP /json polling + manual attach

**Проблема:** Антидетект-браузер не шлёт `Target.targetCreated`/`attachedToTarget` для нативно открытых табов (`_blank`, адресная строка). WS-based `Target.getTargets()` тоже не возвращает их. Система слепа к новым табам → Enter уходит в устаревший таб → открывается третий таб в слейвах.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | `getHttpTabs()` — HTTP GET /json; `attachToExistingTarget()` — ручной attach с `_enableInput`; хранение `cdpPort` в `browserConnections`; удалён `_blank`-перехват из `SYNC_EVENT_SCRIPT` |
| `src/api/multi-control.js` | `discoverActiveTab()` через `getHttpTabs()`; `syncNewMasterTab(targetId, url)` — attach мастера + create+attach slave + map + activate; `attachedMasterTabs` Set; `onNewTab` только трекает таб мастера (создание slave делает `syncNewMasterTab`); `await discoverActiveTab()` перед Enter; очистка `pendingSync`/`attachedMasterTabs` в `/stop`; удалён мёртвый `openTab` handler |
| `tests/unit/cdp-manager.test.js` | Тесты `getHttpTabs`, `attachToExistingTarget` |
| `tests/unit/multi-control-api.test.js` | Тесты `syncNewMasterTab`, `discoverActiveTab` |

**Ключевые изменения в логике:**
- `discoverActiveTab()` переписана: запрос `/json` через HTTP (вместо `Target.getTargets` через WS). Новый таб = page-таб из `/json`, отсутствующий в `targetSessions` мастера.
- `syncNewMasterTab()` теперь attach'ит таб мастера (чтобы работал ввод) и делает ручной attach созданных slave табов (антидетект не шлёт `attachedToTarget`).
- `/os-keyboard`: перед `keyDown` с `Enter` вызывается `await discoverActiveTab()` — Enter гарантированно уходит в актуальный таб.

### v0.9.1 (2026-07-01) — Fix duplicate slave tabs on tab creation

**Проблема:** `onNewTab` (от `Target.targetCreated`) И `syncNewMasterTab` (от HTTP polling) оба создавали табы в слейвах → каждый новый таб мастера порождал 2 таба в каждом слейве.

**Исправление:**

| Файл | Изменение |
|------|-----------|
| `src/api/multi-control.js` | `onNewTab` для мастера больше не создаёт slave табы — только трекает (`attachedMasterTabs.add`, `setActiveMasterTab`). Всё создание slave табов делает `syncNewMasterTab` |
| `tests/unit/multi-control-api.test.js` | Обновлён тест Ctrl+T — теперь проверяет `syncNewMasterTab` вместо `onNewTab` |

### v0.9.2 (2026-07-01) — Native slave tab detection + single pendingSync guard

**Проблема (v0.9.1 не решил):** Когда мастер кликает `_blank` ссылку, ивент диспатчится в слейв через `Input.dispatchMouseEvent`. Слейв тоже открывает таб нативно. Затем `syncNewMasterTab` создаёт ещё один таб через CDP → 2 таба в слейве.

Дополнительная проблема: `pendingSync` захватывался в двух отдельных `try/finally` блоках, создавая окно для race condition между polling и Ctrl+T.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/api/multi-control.js` | `syncNewMasterTab`: перед `createTab` проверяет HTTP `/json` слейва на наличие нативного таба (2 попытки с 150ms паузой). Если найден — attach+map вместо создания. `pendingSync` — единый блок на всю функцию |
| `docs/MULTI-CONTROL.md` | Обновлена история |

### v0.9.3 (2026-07-01) — Prevent native Ctrl+T in master browser

**Проблема:** Нативный OS-хук не блокирует Ctrl+T (`CallNextHookEx`). Браузер мастера получает шорткат и открывает нативный таб поверх CDP-созданного → в мастере 2 таба, в слейвах — табы для каждого.

**Исправление:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | SYNC_EVENT_SCRIPT: `e.preventDefault()` для Ctrl+T/Ctrl+N/Ctrl+W в keydown handler'е. Событие уходит в Node.js, но браузер не создаёт нативный таб |
| `docs/MULTI-CONTROL.md` | Обновлена версия |

### v0.9.6 (2026-07-02) — Fix Ctrl+W close tab + close slave tabs on master tab destroy

**Проблема:** Ctrl+W не работал — `e.preventDefault()` в sync script и `/os-keyboard` handler блокировали закрытие вкладки.

**Исправление:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | Убран `e.preventDefault()` для `KeyW` — браузер закрывает вкладку нативно. Добавлен метод `closeTarget(profileId, targetId)` для CDP `Target.closeTarget` |
| `src/api/multi-control.js` | `onTabDestroyed` теперь закрывает соответствующие slave-табы через `closeTarget` при уничтожении master-таба (Ctrl+W или X) |
| `docs/MULTI-CONTROL.md` | Обновлена версия |

### v0.9.5 (2026-07-02) — Eliminate duplicate tab on Ctrl+T (CDP createTab → native browser)

**Проблема (v0.9.3+v0.9.4 не решили):** При Ctrl+T создавалось 2 таба в каждом окне:
1. CDP `createTab('about:blank')` — от обработчика `/os-keyboard`
2. Нативный `chrome://newtab/` — физический Ctrl+T дошёл до браузера (антидетект-браузер игнорирует `e.preventDefault()`)

**Корень:** Антидетект-браузер не блокирует Ctrl+T через `e.preventDefault()` (вероятно, перехватывает шорткат на уровне browser chrome). Поэтому каждый Ctrl+T порождал две синхронизации для разных master targetId.

**Исправление (стратегия меняется):**

| Файл | Изменение |
|------|-----------|
| `src/api/multi-control.js` | `/os-keyboard` Ctrl+T больше не вызывает `cdpManager.createTab`. Позволяем браузеру открыть таб нативно, `discoverActiveTab` (HTTP polling) подхватывает и синхронизирует |
| `src/multi-control/index.js` | `onKeyDown` фильтрует Ctrl+T/Ctrl+N/Ctrl+W — не диспатчит их в слейвы (предотвращает побочные эффекты) |
| `src/multi-control/cdp-manager.js` | SYNC_EVENT_SCRIPT: удалён `e.preventDefault()` для `KeyT` (теперь НЕ блокируем нативный Ctrl+T), оставлен для `KeyN` и `KeyW` |
| `docs/MULTI-CONTROL.md` | Обновлена версия |

### v0.9.4 (2026-07-01) — Fix preventDefault for non-Latin keyboard layouts

**Проблема:** `e.key` зависит от раскладки клавиатуры. На русской раскладке `e.key='т'` для физической клавиши T, из-за чего `e.preventDefault()` не срабатывал и браузер открывал нативный таб.

**Исправление:**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | Заменён `e.key` на `e.code` (`KeyT`/`KeyN`/`KeyW`) — не зависит от раскладки |
| `docs/MULTI-CONTROL.md` | Обновлена версия |

### v0.8.0 (2026-06-30) — Стабильная синхронизация activeMasterTab

**Проблема:** После клика по `_blank` ссылке и переключения на новый таб, клавиши из адресной строки (Enter, символы) уходили в первый таб слейвов вместо второго, из-за того что `activeMasterTab` не обновлялся.

**Исправления:**

| Файл | Изменение |
|------|-----------|
| `src/api/multi-control.js` | Фильтр stale событий: `mouseUp`, `mouseMove`, `scroll`, `keyUp`, `charInput` больше не обновляют `activeMasterTab` (строка 72) |
| `src/api/multi-control.js` | `onNavigate` теперь вызывает `setActiveMasterTab(masterTargetId)` (строка 114) |
| `src/api/multi-control.js` | Добавлен `cdpManager.onTabActivated` callback (строка 150) |
| `src/api/multi-control.js` | `/os-keyboard` best-effort запрос `Target.getTargets()` с таймаутом 300ms (строка 291) |
| `src/api/multi-control.js` | `/stop` очищает `cdpManager.onTabActivated` (строка 184) |
| `src/multi-control/cdp-manager.js` | Добавлен `this.onTabActivated = null` в constructor (строка 49) |
| `src/multi-control/cdp-manager.js` | Добавлен обработчик `Target.targetInfoChanged` (строка 267) |
| `src/multi-control/cdp-manager.js` | Добавлен `getPageTargets(profileId)` — запрос `Target.getTargets()` (строка 640) |
| `src/multi-control/cdp-manager.js` | Добавлен `getActiveTargetId(profileId)` — возвращает активный page target (строка 667) |

**Новые тесты (v0.8.0):**

| Файл | Тесты |
|------|-------|
| `tests/unit/cdp-manager.test.js` | `getPageTargets` (возвращает [] без connection), `getActiveTargetId` (null без connection), `onTabActivated` (инициализация, targetInfoChanged, не-page фильтр) |
| `tests/unit/multi-control-api.test.js` | `onTabActivated` (обновление activeMasterTab, неактивный controller, не-master), stale event filter (mouseUp не обновляет, mouseDown обновляет), `/os-keyboard` best-effort update (tid обновляет, null не меняет) |
| `tests/unit/multi-control.test.js` | `onNavigate` вызывает `setActiveMasterTab`, повторный вызов с тем же targetId не дублирует `_syncActiveTabToSlaves` |

### v0.7.0 (2026-06-30) — _blank/window.open sync
