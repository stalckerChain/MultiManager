# Multi-Control Sync — Состояние на конец сессии 2026-06-29

## Текущее состояние (working, v0.5.0)

### Что работает
- Mouse sync (движение, клик, скролл) ✓ — без дублирования
- Keyboard sync (нажатия, Enter, стрелки) ✓ — CDP-based
- Text input (Input.insertText через charInput) ✓
- Navigation sync (master переходит → slave следует) ✓
- Multi-tab sync — Ctrl+T открывает вкладки в slaves ✓
- Browser shortcuts (Ctrl+L, Ctrl+T, Ctrl+W, Alt+Arrow) ✓ — native C++ addon
- Slave dispatch через CDP Input.dispatch* ✓
- Tab mapping — master вкладки привязаны к slave вкладкам ✓

### Что НЕ работает
1. **Multi-tab sync** — при ручном открытии вкладки в slave, sync не подхватывается (slave CDP с enableInput:false)
2. **Windows-only** — window arranger через PowerShell
3. **Ctrl+W** — закрытие вкладок в slaves не реализовано

### Архитектура (текущая)
```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent(profileId, event, sessionId)
  ↓ controller.setActiveMasterTab(targetId)
  ↓ inputCapture.injectFromCdp()
  ↓ MultiController → broadcast
  ↓ CDP Input.dispatch* → slave windows

Browser shortcuts (native):
  ↓ Electron main process → WH_KEYBOARD_LL hook (C++ addon)
  ↓ hooks.node → HTTP POST /api/multi-control/os-keyboard
  ↓ backend детектит Ctrl+T → cdpManager.createTab(slaveId)
  ↓ Target.createTarget → новая вкладка в каждом slave

Tab mapping:
  ↓ Target.attachedToTarget (master) → onNewTab callback
  ↓ controller.mapTab(masterTargetId, slaveTargetId)
  ↓ Navigate → navigateToSession(slaveId, slaveSessionId, url)

Navigation:
  ↓ Page.frameNavigated event (master)
  ↓ cdpManager.onNavigate(profileId, url, sessionId)
  ↓ navigateToSession для привязанных slave вкладок
```

---

## Версия и сборка
- Версия: 0.5.0
- Тесты: 326/326 pass
- Бинарник: `gui/release/MultiManager Setup 0.5.0.exe`
- Режим: CDP-based + native keyboard hooks (C++ addon) + multi-tab mirror

## Ключевые файлы
- `src/multi-control/cdp-manager.js` — CDP connection, dispatch, navigation, createTab, tab mapping
- `src/multi-control/index.js` — MultiController (broadcast, coords, tabMapping)
- `src/api/multi-control.js` — API routes + CDP event wiring + /os-keyboard + Ctrl+T handling
- `src/os-input/input-capture.js` — EventEmitter wrapper (CDP mode)
- `src/os-input/native-hooks/hooks.cc` — C++ addon: WH_KEYBOARD_LL via N-API
- `src/os-input/native-hooks/index.js` — JS wrapper for native addon
- `gui/src/main/keyboard-hooks.js` — Electron main process: loads addon, sends to backend
- `gui/src/main/index.js` — IPC handlers for hooks:start/stop
- `gui/src/preload/index.js` — hooksStart/hooksStop exposed to renderer
- `gui/src/renderer/stores/sync.js` — triggers hooks start/stop with multi-control

## Полезные команды
```powershell
# Логи backend
Get-Content "$env:APPDATA\CloakManager\logs\core.log" -Tail 50

# Логи Electron main process
Get-Content "$env:APPDATA\multimanager-gui\logs\app-2026-06-29.log" -Tail 30

# Логи keyboard hooks
Get-Content "$env:APPDATA\multimanager-gui\logs\hooks-2026-06-29.log"

# Тесты
npx vitest run

# Сборка native addon
cd src/os-input/native-hooks; npx node-gyp rebuild

# Сборка
cd gui; npx vite build; npx electron-builder --win
```

## История коммитов (сессия 2026-06-29)
```
81dacef fix: Target.createTarget requires url param — default to about:blank
4ef09c2 fix: Ctrl+T creates tabs in slaves via os-keyboard handler
7e94cee feat: multi-tab sync — mirror tabs between master and slaves
8a11e13 feat: native keyboard hooks via C++ addon + fix duplicate clicks
```

## Архитектурные решения
1. **CDP-based sync** — правильный подход для антидетект-браузера (не Windows API)
2. **Native C++ addon** для WH_KEYBOARD_LL — koffi trampoline не работает для синхронных callback
3. **Гибрид**: CDP для mouse/keyboard + native hooks для browser shortcuts
4. **Tab mapping** — master вкладки привязаны к slave вкладкам через targetId

## TODO (следующая сессия)
1. **Ctrl+W** — закрытие вкладок в slaves (Target.closeTarget)
2. **Multi-tab sync** — slave CDP с enableInput:false не детектит новые вкладки
3. **Кроссплатформенность** — заменить PowerShell window arranger
