## Проблема: Enter в адресной строке второго таба открывает третий таб в слейвах

### Описание

1. **Запущено 3 аккаунта**, включена синхронизация
2. В Tab A (первая вкладка) клик по `_blank` ссылке — корректно открывается Tab B во всех аккаунтах
3. **Антидетект-браузер НЕ присылает** `Target.targetCreated` / `attachedToTarget` для нативно открытых табов
4. Из-за этого `onNewTab` не вызывается, `activeMasterTab` **не обновляется** — остаётся `Tab A`
5. Пользователь переключается на Tab B в мейне, вводит `ya.ru` в адресной строке, жмёт Enter
6. Native hooks (WH_KEYBOARD_LL) ловят Enter → `/os-keyboard` → `controller.onKeyDown` → `_getSlaveSession(slaveId)`
7. `_getSlaveSession` ищет по `activeMasterTab` (= Tab A) — Enter уходит в Tab A' (первый таб слейва)
8. Enter в Tab A' активирует `_blank` ссылку на странице → **открывается третий таб (Tab C')** в слейвах

### Корневая причина

**Антидетект-браузер не экспортирует нативно-открытые табы через CDP.**
- `Target.targetCreated` не приходит
- `Target.attachedToTarget` не приходит (auto-attach не работает для новых табов)
- `Target.getTargets()` не возвращает нативно-открытые табы
- Сессия для нового таба не создаётся → события `Page.frameNavigated` не приходят
- Система полностью слепа к существованию Tab B и Tab B'

---

## Хронология попыток исправления

### Попытка 1: Вариант C — `getTargets` в `/os-keyboard` + `tabActivated`

**Что сделано:**
- Best-effort `getPageTargets` перед каждым keyDown в `/os-keyboard` (таймаут 300ms)
- `tabActivated` в `onEvent` → вызов `getPageTargets`

**Почему не сработало:**
- Логи ни разу не показали `discoveredNewTab`
- `getPageTargets` не возвращает таймаут 300ms (всегда пустой массив)
- Даже если бы вернул, маппинга для нового таба нет → `_getSlaveSession` падает на первый доступный

---

### Попытка 2: `syncNewMasterTab` — создание табов в слейвах при обнаружении

**Что сделано:**
- Функция `syncNewMasterTab(masterTargetId)`:
  - Если таб уже замаплен → только `setActiveMasterTab`
  - Если новый таб → `createTab` в каждом слейве, `mapTab`, `setActiveMasterTab`, `_syncActiveTabToSlaves`
- `pendingSync` Set для защиты от гонок

**Почему не сработало:**
- `getPageTargets` не возвращает нативно-открытые табы
- `syncNewMasterTab` никогда не вызывается с targetId нового таба
- Единственные `SYNC:` в логах — для начального таба (когда slaves ещё не добавлены)

---

### Попытка 3: Вариант D — setInterval polling 300ms

**Что сделано:**
- Убран `getPageTargets` из `/os-keyboard` (не блокирует ввод)
- Убран `getPageTargets` из `tabActivated`
- Добавлен `discoverActiveTab()` с `discovering` guard
- `setInterval(discoverActiveTab, 300)` в `start()`
- Очистка таймера в `stop()`
- `discoverActiveTab` вызывает `getPageTargets` со штатным таймаутом 3s

**Почему не сработало:**
- `getPageTargets` успешно возвращает начальный таб
- Но **НЕ возвращает** нативно-открытый Tab B
- Polling находит только уже замапленный таб → `syncNewMasterTab` ничего не делает
- `tabMappingSize` всегда 1

---

### Попытка 4: Перехват `_blank` кликов в sync script

**Что сделано:**
- В `SYNC_EVENT_SCRIPT` изменён обработчик `click`:
  - Определяет `<a target="_blank">` (или ctrl+click, middle-click)
  - `preventDefault()` — блокирует нативное открытие таба
  - Эмитит `openTab` с URL
- В `onEvent` добавлена обработка `openTab`:
  - `createTab(masterId, url)` — создаёт таб через CDP
  - Создаёт табы во всех слейвах с тем же URL
  - Маппит, обновляет `activeMasterTab`
  - `inputCapture.injectFromCdp` не вызывается (click не уходит в слейвы)
- В `onNewTab` для мастера URL передаётся в `createTab(slaveId, targetInfo.url)`

**Статус:** не протестировано. Потенциальная проблема — `window.open` и CDP-созданные табы могут тоже не триггерить CDP-события в антидетект-браузере.

---

## Что нужно доработать

### Если `openTab` не сработает (CDP не создаёт таб)

Проверить, что `cdpManager.createTab()` отправляет `Target.createTarget` и получает ответ. Если браузер не отвечает на `Target.createTarget` (блокирует), нужен другой подход.

### Альтернатива: URL-aware dispatch

Вместо обнаружения табов — пересылать нажатия Enter в **каждый** таб слейва, чей URL совпадает с URL активного таба мастера. Для получения URL слейвов использовать `getPageTargets` на слейвах (не на мастере). Если браузер не экспортирует табы даже на слейвах — не сработает.

### Альтернатива: Native window focus tracker

Добавить в native addon (`.node`, `koffi`) отслеживание фокуса окна. Когда пользователь переключается на Tab B в мастере, native addon может:
1. Определить targetId окна через Win32 API (GetForegroundWindow → связать с CDP target)
2. Или определить URL из заголовка окна

### Альтернатива: Замена ядра браузера

Если CloakBrowser не поддерживает авто-аттач к новым табам — это баг/ограничение ядра. Возможно, в новой версии CloakBrowser это исправлено.

---

## Файлы, изменённые в ходе исправления

| Файл | Изменения |
|---|---|
| `src/api/multi-control.js` | syncNewMasterTab, polling timer, openTab handler, onNewTab url passthrough |
| `src/multi-control/cdp-manager.js` | _blank intercept в SYNC_EVENT_SCRIPT |
