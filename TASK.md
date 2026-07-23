# Задача: Диагностика и фикс Ctrl+W в multi-control

**Дата:** 2026-07-23
**Статус:** Готово к тестированию
**Проблема:** При синхронизации аккаунтов, нажатие Ctrl+W в master закрывает таб в master, но НЕ закрывает в slave.

## Что сделано

### 1. SYNC_EVENT_SCRIPT — блокировка Ctrl+W + `browserAction` event

**Файл:** `src/multi-control/cdp-manager.js:32-52`

- Добавлены `ctrlKey`, `shiftKey`, `altKey`, `metaKey` в emitted data (ранее отсутствовали)
- Ctrl+W и Ctrl+T теперь блокируются через `e.preventDefault()` и отправляют `browserAction: closeTab/newTab`
- Это СИНХРОННЫЙ путь — работает мгновенно, без HTTP-задержек

### 2. Обработка `browserAction` в `onEvent` callback

**Файл:** `src/api/multi-control.js:225-270`

- При получении `browserAction: closeTab` вызывается `cdpManager.closeTarget()` для всех замапленных slave-табов
- Затем `controller.unmapTab()` для очистки маппинга

### 3. Детальное логирование во всех трёх путях

| Точка | Файл | Префикс лога |
|-------|------|-------------|
| SYNC_EVENT_SCRIPT bindingCalled | `cdp-manager.js:247` | `CDP-SYNC: received event` |
| Target.targetDestroyed | `cdp-manager.js:218` | `CDP: Target.targetDestroyed, calling onTabDestroyed` |
| onEvent callback | `multi-control.js:234` | `MC-EVENT: received from master` |
| onTabDestroyed callback | `multi-control.js:322` | `MC-DESTROYED: master tab destroyed` |
| OS-keyboard Ctrl+W | `multi-control.js:494` | `OS-KEYBOARD: Ctrl+W handling complete` |
| onKeyDown filter | `index.js:290` | `MC-KEY: Ctrl+W/T/N blocked` |
| unmapTab | `index.js:86` | `MC-UNMAP: no mapping found` |
| Keyboard hooks | `keyboard-hooks.js:60` | `CTRL+W/T intercepted` |

## Как тестировать

1. Запустить приложение, включить multi-control (master + 1 slave)
2. Открыть 2+ таба в master
3. Нажать Ctrl+W в master
4. Проверить `core.log` — искать префиксы `MC-EVENT`, `MC-DESTROYED`, `CDP-SYNC`, `OS-KEYBOARD`
5. Проверить, закрылся ли таб в slave

## Результат

- **738 тестов** — все проходят
- Новый `browserAction` путь должен синхронно закрывать slave-табы через CDP `Target.closeTarget`
