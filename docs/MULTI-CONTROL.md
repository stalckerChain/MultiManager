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

### Native hooks (дополнительный)
- Browser shortcuts (Ctrl+T, Ctrl+W) через C++ addon с WH_KEYBOARD_LL
- HTTP POST → `/api/multi-control/os-keyboard`
- Используется только для перехвата системных комбинаций

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

## Ctrl+T обработка

1. Native hook перехватывает Ctrl+T через WH_KEYBOARD_LL
2. HTTP POST → `/api/multi-control/os-keyboard`
3. Backend создаёт вкладки через CDP `Target.createTarget`:
   - Сначала в master → получает masterTargetId
   - Затем в каждом slave → получает slaveTargetId
   - Немедленный маппинг: `controller.mapTab(masterTargetId, slaveId, slaveTargetId)`

> **Важно:** `Target.setAutoAttach` не работает в антидетект-браузере, поэтому `onNewTab` не вызывается. Используется прямой `Target.createTarget`.

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

## Версия

Текущая: v0.6.0 (CDP-based + native keyboard hooks + multi-tab mirror)
