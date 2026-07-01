## Проблема: Enter в адресной строке второго таба открывает третий таб в слейвах

### Статус: ИСПРАВЛЕНО (v0.9.1, 2026-07-01)

> **v0.9.1:** Fix duplicate slave tabs — `onNewTab` больше не создаёт табы в слейвах (этим занимается только `syncNewMasterTab`).

### Описание

1. **Запущено 3 аккаунта**, включена синхронизация
2. В Tab A (первая вкладка) клик по `_blank` ссылке — корректно открывается Tab B во всех аккаунтах
3. **Антидетект-браузер НЕ присылает** `Target.targetCreated` / `attachedToTarget` для нативно открытых табов
4. Из-за этого `onNewTab` не вызывается, `activeMasterTab` **не обновляется** — остаётся `Tab A`
5. Пользователь переключается на Tab B в мейне, вводит `ya.ru` в адресной строке, жмёт Enter
6. Native hooks (WH_KEYBOARD_LL) ловят Enter → `/os-keyboard` → `controller.onKeyDown` → `_getSlaveSession(slaveId)`
7. `_getSlaveSession` ищет по `activeMasterTab` (= Tab A) — Enter уходит в Tab A' (первый таб слейва)
8. Enter в Tab A' активирует `_blank` ссылку на странице → **открывается третий таб (Tab C')** в слейвах

### Корневая причина (подтверждена логами core.log, сессия pid 24800)

**Антидетект-браузер не экспортирует нативно-открытые табы через CDP WebSocket:**
- `Target.targetCreated` не приходит
- `Target.attachedToTarget` не приходит (auto-attach не работает для новых табов)
- `Target.getTargets()` через WS не возвращает нативно-открытые табы

**Доказательства из логов:**
- `openTab` / `_blank` = **0 раз** во всём логе (перехват кликов в sync-script не работал)
- `master opened new tab` = **0 раз**
- `tabMappingSize:1` во **всех** 11 Enter-событиях — маппинг никогда не разрастался
- Все навигации шли в **одни и те же** target'ы (стартовый таб)

### Доп. баг (найден при анализе)

Даже когда `createTab()` через WS создавал таб, он **не делал attach** (attach происходит только в обработчике `Target.attachedToTarget`/`targetCreated`, который антидетект не шлёт). Созданный таб не попадал в `targetSessions`, и `_getSlaveSession` всё равно падал в фолбэк на первый таб.

---

## Решение v0.9.0: HTTP `/json` polling + sync создания/фокуса табов

HTTP DevTools endpoint `GET /json` — **другой кодовой путь Chromium**, не зависящий от WS-подписок.
`_discoverWsUrl()` уже успешно им пользуется. Polling `/json` каждые ~300мс надёжно находит новые табы.

**Важное ограничение:** `/json` НЕ помечает активный таб (поле `attached` = DevTools-подключение, а не фокус окна).
Эвристика: браузер автофокусирует **вновь открытый** таб → вновь появившийся в `/json` page-tab = новый активный.

### Изменения в коде

| Файл | Изменение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | Импорт `http` на верхнем уровне; хранение `cdpPort` в `browserConnections`; метод `getHttpTabs()` (HTTP GET /json, надёжный обход сломанного WS); метод `attachToExistingTarget()` (ручной attach для нативно-открытых/созданных табов + `_enableInput`); убран `_blank`-перехват из `SYNC_EVENT_SCRIPT` (мёртвый код, 0 срабатываний) |
| `src/api/multi-control.js` | `discoverActiveTab()` переписана через `getHttpTabs()` (вместо сломанного `getPageTargets` через WS); `syncNewMasterTab(masterTargetId, url)` — attach мастера + create+attach slave + map + activate; `onNewTab` для мастера теперь attach'ит slave табы; `/os-keyboard` делает `await discoverActiveTab()` перед Enter (ввод в актуальный таб); убран мёртвый `openTab` handler |
| `tests/unit/cdp-manager.test.js` | Тесты `getHttpTabs` (фолбэки + логика фильтрации), `attachToExistingTarget` (существующая сессия, attach+enableInput, ошибка) |
| `tests/unit/multi-control-api.test.js` | Тесты `syncNewMasterTab` (создание slave табов, дедуп по маппингу, guard inactive), `discoverActiveTab` (обнаружение нового таба по разнице knownTargets/`/json`) |

### Что починило фикс

1. Клик по `_blank` → нативный таб B в мастере → `/json` polling через ≤300мс находит его → `attachToExistingTarget` мастера → `createTab`+`attachToExistingTarget` в слейвах → `setActiveMasterTab(B)` + `activateTarget` в слейвах
2. Переключение на таб B, ввод `ya.ru`, Enter → `/os-keyboard` делает `await discoverActiveTab()` (подтверждает B активен) → Enter идёт в маппленный таб B' слейвов → **правильная навигация, без лишнего 3-го таба**

---

## Предыдущие попытки ( архив — НЕ сработали)

### Попытка 1–3: WS-based обнаружение (getPageTargets / polling через Target.getTargets)
**Почему не сработало:** `getPageTargets` через WS не возвращает нативно-открытые табы. `tabMappingSize` всегда 1.

### Попытка 4: Перехват `_blank` кликов в sync-script (openTab handler)
**Почему не сработало:** 0 срабатываний в логах. Не работает на chrome:// страницах и страницах без DOM. Удалён как мёртвый код.

---

## Что проверить после тестирования на реальном браузере

1. **Главный риск:** если антидетект блокирует даже HTTP `/json` для нативных табов (маловероятно — `_discoverWsUrl` уже им пользуется). Признак успеха: в логе появятся `SYNC: discovered new master tab` с URL нового таба.
2. Polling 300мс добавит задержку ≤300мс перед синхронизацией нового таба — приемлемо.
3. `await` перед Enter добавит ~десятки мс задержки ввода — незаметно.

Если `/json` тоже слеп — альтернатива «URL-aware dispatch» из истории ниже.

---

## Файлы

| Файл | Назначение |
|------|-----------|
| `src/multi-control/cdp-manager.js` | `getHttpTabs`, `attachToExistingTarget`, хранение `cdpPort` |
| `src/api/multi-control.js` | `discoverActiveTab`/`syncNewMasterTab` через HTTP, `await` перед Enter |
