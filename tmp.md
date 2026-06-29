# Multi-Control Sync — Состояние на конец сессии 2026-06-29

## Текущее состояние (working, v0.5.0)

### Что работает
- Mouse sync (движение, клик, скролл) ✓ — без дублирования
- Keyboard sync (нажатия, Enter, стрелки) ✓ — CDP-based
- Text input (Input.insertText через charInput) ✓
- Navigation sync (master переходит → slave следует) ✓
- Multi-tab master (Target.setAutoAttach + addScriptToEvaluateOnNewDocument) ✓
- Browser shortcuts (Ctrl+L, Ctrl+T, Ctrl+W, Alt+Arrow) ✓ — native C++ addon
- Slave dispatch через CDP Input.dispatch* ✓

### Что НЕ работает
1. **Multi-tab sync** — при открытии новой вкладки в master, sync может прерываться
2. **Windows-only** — window arranger через PowerShell

### Архитектура (текущая)
```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent → inputCapture.injectFromCdp()
  ↓ MultiController → broadcast
  ↓ CDP Input.dispatch* → slave windows

Browser shortcuts (native):
  ↓ Electron main process → WH_KEYBOARD_LL hook (C++ addon)
  ↓ hooks.node → HTTP POST /api/multi-control/os-keyboard
  ↓ backend → controller.onKeyDown/onKeyUp → CDP dispatch

Navigation:
  ↓ Page.frameNavigated event (master)
  ↓ cdpManager.onNavigate → navigateTo(slave, url)
```

---

## Версия и сборка
- Версия: 0.5.0
- Тесты: 318/318 pass
- Бинарник: `gui/release/MultiManager Setup 0.5.0.exe`
- Режим: CDP-based + native keyboard hooks (C++ addon)

## Ключевые файлы
- `src/multi-control/cdp-manager.js` — CDP connection, dispatch, navigation sync
- `src/multi-control/index.js` — MultiController (broadcast, coords)
- `src/api/multi-control.js` — API routes + CDP event wiring + /os-keyboard endpoint
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

## Что сделано в этой сессии
- Native C++ addon для WH_KEYBOARD_LL (N-API, raw, без node-addon-api)
- addon компилируется через node-gyp, загружается из Electron main process
- IPC цепочка: renderer → main process (hooks:start/stop) → addon → HTTP → backend → CDP
- Убрано дублирование кликов (click handler в wireInputToController)
- Добавлен /api/multi-control/os-keyboard endpoint
- Диагностическое логирование в файлы (app-*.log, hooks-*.log)
