# Multi-Control Sync — Состояние на конец сессии 2026-06-30

## Текущее состояние (working, v0.6.0)

### Что работает
- Mouse sync (движение, клик, скролл) ✓ — CDP button конвертация (number→string), без двойного dispatch
- Keyboard sync (нажатия, Enter, стрелки) ✓ — CDP-based
- Text input (Input.insertText через charInput) ✓
- Navigation sync (master переходит → slave следует) ✓ — через tab mapping
- Multi-tab sync — Ctrl+T открывает вкладки в slaves ✓ — без дублирования
- Tab switching sync — переключение вкладки в master активирует соответствующую вкладку в slaves ✓
- Tab mapping 1:N — один master tab маппится на несколько slaves ✓
- Browser shortcuts (native C++ addon) ✓
- Slave dispatch через CDP Input.dispatch* ✓ — с детальным логированием
- Window arranger — taskbar-aware (WorkingArea вместо Bounds) ✓
- Clicks после Ctrl+W — не ломаются (fallback на первую сессию) ✓

### Что НЕ работает
1. **Ctrl+W** — закрытие вкладок в slaves не реализовано
2. **Кроссплатформенность** — window arranger через PowerShell (только Windows)
3. **Window positions** — GUI arranger не отправляет позиции в `/window-position` endpoint после расстановки окон (координаты мыши могут быть неточными если окна расставлены через arranger)

### Что исправлено в этой сессии (2026-06-30)
1. **Multi-tab sync fix** — убрал `enableInput` gate на `onNewTab` в cdp-manager.js, slave CDP теперь детектит новые вкладки
2. **Dispatch через tab mapping** — `_getSlaveSession(slaveId)` ищет slave-сессию через `activeMasterTab → tabMapping → slaveTargetId`
3. **TabMapping 1:N** — переделан с `Map<masterId, slaveId>` на `Map<masterId, Map<slaveId, slaveId>>` — каждый slave хранит свой маппинг
4. **Tab switching sync** — `setActiveMasterTab` вызывает `_syncActiveTabToSlaves` → `cdpManager.activateTarget(slaveId, slaveTargetId)`
5. **Click fix** — `_toCdpButton()` конвертирует `button: 0` → `button: 'left'` (CDP ожидает строку). Убран двойной dispatch из `onClick` (mousePressed+mouseReleased уже генерируют DOM click)
6. **ClickCount** — принудительно ≥1 для mousePressed/mouseReleased
7. **CDP logging** — детальное логирование dispatchMouseEvent/dispatchMouseEventToSession с параметрами
8. **Ctrl+T fix** — убрано дублирование из OS keyboard handler (создавал unmapped вкладки параллельно с `onNewTab`)
9. **Taskbar** — `PrimaryScreen.Bounds` → `WorkingArea` в window-arranger.js, grid/cascade учитывают offsetX/Y
10. **Initial tab mapping** — при добавлении slave, начальные вкладки маппятся (`mapTab(masterTargetId, slaveId, slaveTargetId)`)
11. **Session cleanup** — при `targetDestroyed`, `this.sessions` переключается на выжившую сессию
12. **Slave tab destroy** — `_unmapBySlaveTargetId()` чистит mapping при уничтожении slave-вкладки

---

## Версия и сборка
- Версия: 0.6.0
- Тесты: 326/326 pass
- Бинарник: `gui/release/MultiManager Setup 0.4.0.exe`
- Режим: CDP-based + native keyboard hooks (C++ addon) + multi-tab mirror

## Ключевые файлы
- `src/multi-control/cdp-manager.js` — CDP connection, dispatch (с логированием), navigation, createTab, activateTarget, session cleanup
- `src/multi-control/index.js` — MultiController (broadcast, _toCdpButton, _getSlaveSession, tabMapping 1:N, _syncActiveTabToSlaves)
- `src/api/multi-control.js` — API routes + CDP event wiring + /os-keyboard + Ctrl+T (без дублирования) + initial tab mapping + slave destroy cleanup
- `src/api/window-arranger.js` — Window arranger: WorkingArea (taskbar-aware), grid с offsetX/Y
- `src/os-input/input-capture.js` — EventEmitter wrapper (CDP mode)
- `src/os-input/native-hooks/hooks.cc` — C++ addon: WH_KEYBOARD_LL via N-API
- `gui/src/renderer/stores/sync.js` — triggers hooks start/stop with multi-control

## Полезные команды
```powershell
# Логи backend
Get-Content "$env:APPDATA\CloakManager\logs\core.log" -Tail 50

# Логи Electron main process
Get-Content "$env:APPDATA\multimanager-gui\logs\app-2026-06-30.log" -Tail 30

# Тесты
npx vitest run

# Сборка
cd gui; npx vite build; npx electron-builder --win
```

## Архитектура (текущая)
```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent(profileId, event, sessionId)
  ↓ controller.setActiveMasterTab(targetId)  → _syncActiveTabToSlaves (activateTarget)
  ↓ inputCapture.injectFromCdp()
  ↓ MultiController → broadcast → _getSlaveSession(slaveId)
  ↓ CDP Input.dispatch* → slave windows (button конвертация: 0→'left')

Tab mapping (1:N):
  ↓ tabMapping = Map<masterTargetId, Map<slaveId, slaveTargetId>>
  ↓ _getSlaveSession(slaveId) → ищет activeMasterTab → tabMapping → slaveTargetId → bc.targetSessions
  ↓ Фолбэк: если mapping нет → первая доступная slave-сессия

Browser shortcuts (native):
  ↓ Electron main process → WH_KEYBOARD_LL hook (C++ addon)
  ↓ hooks.node → HTTP POST /api/multi-control/os-keyboard
  ↓ Ctrl+T: просто пропускает (master обрабатывает нативно)
  ↓ onNewTab → создаёт mapped вкладку в каждом slave

Navigation:
  ↓ Page.frameNavigated event (master)
  ↓ cdpManager.onNavigate → ищет slaveTargetId через tabMapping (per-slave)
  ↓ navigateToSession для каждого slave

Tab switching:
  ↓ setActiveMasterTab(targetId) → _syncActiveTabToSlaves
  ↓ cdpManager.activateTarget(slaveId, slaveTargetId)
```

## История коммитов (сессия 2026-06-30)
```
ec1de40 fix: Ctrl+T — remove duplicate tab creation from OS keyboard handler
cf9a276 fix: CDP click logging + ensure clickCount≥1; taskbar-aware window positioning
9234368 fix: clicks — convert button number to CDP string + remove double dispatch
cc3208e fix: tabMapping 1:N — support multiple slaves per master tab
d1443b6 fix: tab sync — clicks survive Ctrl+W + slave tab activation on switch
62d326f fix: multi-tab sync — slave tab detection + dispatch via tab mapping
```

## Архитектурные решения
1. **CDP-based sync** — правильный подход для антидетект-браузера (не Windows API)
2. **Native C++ addon** для WH_KEYBOARD_LL — koffi trampoline не работает для синхронных callback
3. **Гибрид**: CDP для mouse/keyboard + native hooks для browser shortcuts
4. **Tab mapping 1:N** — `Map<masterTargetId, Map<slaveId, slaveTargetId>>` каждый slave маппится отдельно
5. **onClick = no-op** — mousePressed+mouseReleased из mouseDown/mouseUp уже генерируют DOM click
6. **WorkingArea** вместо Bounds — taskbar-aware window positioning

## TODO (следующая сессия)
1. **Ctrl+W** — закрытие вкладок в slaves (Target.closeTarget) + unmap
2. **Window positions sync** — GUI arranger должен отправлять позиции в `/window-position` после расстановки
3. **Кроссплатформенность** — заменить PowerShell window arranger
