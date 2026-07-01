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

### `_blank` ссылки и `window.open` (РАБОТАЕТ через HTTP /json polling, v0.9.0)

**Проблема:** Антидетект-браузер не экспортирует нативно-открытые табы через CDP WebSocket:
- `Target.setAutoAttach` не работает → `Target.attachedToTarget` не приходит
- `Target.targetCreated` не приходит для нативно открытых табов
- `Target.getTargets()` через WS не возвращает такие табы

**Решение (v0.9.0):** HTTP DevTools endpoint `GET /json` — другой кодовый путь Chromium, не зависящий от WS-подписок. Polling `/json` каждые ~300мс находит новые табы:

1. Пользователь кликает `_blank` → master открывает Tab B нативно
2. Polling `/json` на master через ≤300мс находит Tab B (нет в `targetSessions`)
3. `attachToExistingTarget(masterId, Tab B)` — ручной attach + `_enableInput`
4. `createTab(slaveId, url)` + `attachToExistingTarget(slaveId, slaveTab)` для каждого slave
5. `mapTab(Tab B, slaveId, slaveTab)` + `setActiveMasterTab(Tab B)`

**Клики по `_blank` больше не перехватываются в sync-script** — мёртвый код удалён (0 срабатываний в логах).

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

**Рабочее решение — HTTP DevTools endpoint `GET /json`:**

1. **Polling** `discoverActiveTab()` раз в 300мс (setInterval при старте)
2. Запрос `GET http://127.0.0.1:{cdpPort}/json` — **другой кодовой путь Chromium**, не зависящий от WS-подписок
3. Сравнение списка табов из `/json` с `targetSessions` мастера
4. Вновь появившийся page-таб = новый активный (эвристика: браузер автофокусирует новый таб)
5. `syncNewMasterTab(targetId, url)`: attach мастера → createTab+attach в слейвах → mapTab → setActiveMasterTab

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

### Обработка Ctrl+T

1. Native hook → `/os-keyboard` → `cdpManager.createTab(masterId)` → `await syncNewMasterTab(masterTargetId, 'about:blank')`
2. syncNewMasterTab сам создаёт slave табы + attach + маппинг

### Обработка `_blank`

1. Polling `/json` находит Tab B (нет в targetSessions)
2. `attachToExistingTarget(masterId, Tab B)` + `createTab` + `attachToExistingTarget` в слейвах
3. `mapTab` + `setActiveMasterTab(Tab B)`

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

- **Duplicate tabs (уменьшено в v0.9.0):** При `_blank` в slave создаётся 1 таб через `createTab()` (маппится). Ранее мог открыться второй нативный таб от синхронизированного клика — теперь `_blank`-перехват удалён из sync-script, поэтому клик не блокируется и нативный таб не открывается. Но если на странице есть `window.open` без CDP-перехвата — дубликат возможен.
- **Polling latency:** Обнаружение нового таба через HTTP /json может занимать до 300мс. Enter перед `/os-keyboard` делает `await discoverActiveTab()` — это добавляет до ~50-100мс к вводу.
- **HTTP /json недоступен:** Если браузер не отвечает на HTTP DevTools endpoint (заблокирован, сломан), система слепнет к новым табам. `_discoverWsUrl` уже использует `/json`, так что риск мал.

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
8. **HTTP /json polling** — единственный надёжный способ обнаружить нативно-открытые табы в антидетект-браузере; WS-based методы (`targetCreated`, `getTargets`) не работают

## Версия

Текущая: v0.9.5 (HTTP /json polling + native browser Ctrl+T)

## История версий

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
