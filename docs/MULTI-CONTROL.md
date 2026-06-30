# Multi-Control Sync

Синхронизация действий между мастер-профилем и slave-профилями через CDP (Chrome DevTools Protocol).

## Архитектура

```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent(profileId, event, sessionId)
  ↓ controller.setActiveMasterTab(targetId) → _syncActiveTabToSlaves (activateTarget)
  ↓ inputCapture.injectFromCdp()
  ↓ MultiController → broadcast → _getSlaveSession(slaveId)
  ↓ CDP Input.dispatch* → slave windows
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

```
tabMapping = Map<masterTargetId, Map<slaveId, slaveTargetId>>
```

- `MapTab(masterTargetId, slaveId, slaveTargetId)` — добавить маппинг
- `UnmapTab(masterTargetId, slaveId?)` — удалить маппинг
- `GetSlaveTabForMaster(masterTargetId, slaveId)` — получить slave-вкладку
- `_getSlaveSession(slaveId)` — найти CDP-сессию slave через activeMasterTab → tabMapping

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

### CDP SYNC_EVENT_SCRIPT (DOM-события)
- Инжектится в master page через `Page.addScriptToEvaluateOnNewDocument`
- Ловит только DOM-события: mousemove, mousedown, mouseup, wheel, keydown, keyup, click
- **Не ловит** события в browser chrome: адресная строка, tab bar, меню
- Идёт через `Runtime.bindingCalled` → `onEvent` → `injectFromCdp()` → `controller.onKeyDown/onMousePressed/etc.`
- При каждом событии вызывает `setActiveMasterTab(targetId)`, обновляя `activeMasterTab`

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

### Ctrl+T (работает)
1. Native hook перехватывает Ctrl+T через WH_KEYBOARD_LL
2. HTTP POST → `/api/multi-control/os-keyboard`
3. Backend создаёт вкладки через CDP `Target.createTarget` (request-response):
   - Сначала в master → получает `masterTargetId`
   - Затем в каждом slave → получает `slaveTargetId`
   - Немедленный маппинг: `controller.mapTab(masterTargetId, slaveId, slaveTargetId)`
4. Маппинг есть → дальнейшие события (`onNavigate`, dispatchKeyEvent) попадают в правильные табы слейвов

### `_blank` ссылки и `window.open` (НЕ РАБОТАЕТ)

**Проблема:** `Target.setAutoAttach` не работает в антидетект-браузере. CDP НЕ присылает `Target.attachedToTarget`, когда браузер открывает новую вкладку сам (через `_blank` или `window.open`).

**Что происходит на практике:**

1. Пользователь кликает `_blank` ссылку в master Tab A →
2. Master открывает Tab B нативно (браузер сам)
3. CDP не присылает `attachedToTarget` → `onNewTab` НЕ вызывается
4. Маппинг `Tab B → slave_tab` **НЕ СОЗДАЁТСЯ**
5. Клик синхронизируется в slave Tab A' → slave тоже открывает Tab B' нативно
6. `onNewTab` для slave тоже НЕ вызывается → Tab B' не отслеживается

**Последствия:** Tab B в master и Tab B' в slave существуют физически, но не имеют маппинга. CDP-менеджер о них не знает.

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

## Решение (реализовано в v0.7.0)

Синхронизация `_blank`/`window.open` работает через browser-level событие `Target.targetCreated`. Оно приходит на browser WebSocket и НЕ требует `Target.setAutoAttach`:

1. Подписка на `Target.targetCreated` в `_setupBrowserMessageHandler` (cdp-manager.js:165)
2. При получении события с `targetInfo.type === 'page'`:
3. Вызов `Target.attachToTarget(targetId)` вручную через `_attachToTarget()`
4. Получение sessionId, настройка enableInput (binding + sync script), хранение в `bc.targetSessions`
5. Вызов `onNewTab(profileId, targetInfo, newSession)`:
   - **Для master:** `setActiveMasterTab(targetId)` + создание вкладок в slave через `createTab()` + маппинг
   - **Для slave:** маппинг к `activeMasterTab` через `mapTab(activeMasterTab, slaveId, slaveTargetId)`

### Обработка Ctrl+T

При Ctrl+T:
1. Native hook → `/os-keyboard` → `cdpManager.createTab(masterId)` (только master!)
2. `Target.targetCreated` → `onNewTab(masterId)` → создаёт slave вкладки через `createTab()` + маппинг
3. Создание slave вкладок удалено из `/os-keyboard` — теперь этим занимается `onNewTab`

### Обработка `_blank`

1. Клик в master → браузер открывает Tab B нативно → `Target.targetCreated` → attach → `onNewTab(master)`
2. `setActiveMasterTab(Tab B)` + для каждого slave: `createTab()` + `mapTab()`
3. Синхронизированный клик доходит до slave → slave открывает Tab B' нативно → `Target.targetCreated` → attach → `onNewTab(slave)`
4. `mapTab(activeMasterTab=Tab B, slaveId, Tab B')` — маппинг обновляется на нативный таб

### Что изменилось в коде

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | Добавлен обработчик `Target.targetCreated` (строка 165) |
| `src/api/multi-control.js` | `onNewTab` для slave теперь маппит к `activeMasterTab`; Ctrl+T создаёт только master таб |
| `tests/unit/multi-control-api.test.js` | Обновлён тест Ctrl+T, добавлены тесты slave onNewTab |
| `tests/unit/multi-control.test.js` | Добавлены тесты `setActiveMasterTab` / `_syncActiveTabToSlaves` |

### Double `onNewTab` и защита `_attachToTarget` (v0.8.1)

Когда браузер открывает новую вкладку, CDP может сгенерировать **два события** для одного таба:

1. `Target.targetCreated` → ручной `_attachToTarget()` → `callback` → `onNewTab`
2. `Target.attachedToTarget` (auto-attach) → тоже вызывает `onNewTab`

**Проблема:** `onNewTab` вызывается дважды для одного и того же таба. Второй вызов может перезаписать маппинг или создать duplicate-таб в slave.

**Исправления (v0.8.1):**

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | `_attachToTarget`: проверка `sessionBySid.has(sessionId)` — если auto-attach уже подключил таб, `return` без вызова `callback` (строка 351) |
| `src/multi-control/cdp-manager.js` | `attachedToTarget` handler: `if (!firstSessionResolved) { firstSessionResolved = true; resolve(newSession); }` — разрешает `connect()` из auto-attach, если `Target.getTargets()` не вызвал ручной attach (строка 195) |

**Логика `_attachToTarget` guard:**
```javascript
// Если auto-attach уже подключил этот targetId, пропускаем
if (this.sessionBySid.has(sessionId)) {
  // callback НЕ вызывается → onNewTab НЕ дублируется
  return;
}
```

**Логика `attachedToTarget` resolve:**
```javascript
if (!firstSessionResolved) {
  firstSessionResolved = true;
  resolve(newSession); // разрешаем Promise connect() от auto-attach
}
```

Это гарантирует, что `connect()` резолвится ровно один раз, а `onNewTab` не дублируется для одного таба.

### Известные ограничения

- **Duplicate tabs:** При `_blank` в slave создаются 2 таба: один через `createTab()` (маппится первым) и один нативно от синхронизированного клика (перезаписывает маппинг). Нативный таб используется для dispatch, createTab-таб остаётся orphaned. Это не влияет на функциональность, но создаёт лишние пустые вкладки.
- **Race condition:** Если slave `targetCreated` приходит раньше master `targetCreated`, slave таб маппится к предыдущему `activeMasterTab`, а не к новому. На практике маловероятно (master браузер открывает таб раньше, чем slave получает CDP-событие).

## Структура файлов

| Файл | Назначение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | CDP connection, dispatch, navigation, createTab, activateTarget |
| `src/multi-control/index.js` | MultiController (broadcast, tabMapping 1:N) |
| `src/api/multi-control.js` | API routes + CDP event wiring + os-keyboard + tab mapping |
| `src/api/window-arranger.js` | Window arranger (taskbar-aware) |
| `src/os-input/input-capture.js` | EventEmitter wrapper (CDP mode) |
| `src/os-input/native-hooks/hooks.cc` | C++ addon: WH_KEYBOARD_LL via N-API |
| `gui/src/main/keyboard-hooks.js` | Electron main process: bridges native hooks to backend API |

## Архитектурные решения

1. **CDP-based sync** — правильный подход для антидетект-браузера (не Windows API)
2. **Native C++ addon** для WH_KEYBOARD_LL — koffi trampoline не работает для синхронных callback
3. **Гибрид**: CDP для mouse/keyboard + native hooks для browser shortcuts
4. **Tab mapping 1:N** — `Map<masterTargetId, Map<slaveId, slaveTargetId>>` каждый slave маппится отдельно
5. **onClick = no-op** — mousePressed+mouseReleased из mouseDown/mouseUp уже генерируют DOM click
6. **WorkingArea** вместо Bounds — taskbar-aware window positioning
7. **Прямой createTab для Ctrl+T** — `Target.setAutoAttach` не работает в антидетект-браузере, поэтому создаём вкладки через API напрямую

## Версия

Текущая: v0.8.1 (CDP-based + native keyboard hooks + multi-tab mirror + stale event filter + onTabActivated + double onNewTab guard)

## История версий

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
