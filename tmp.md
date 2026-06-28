# Multi-Control Sync — Состояние на конец сессии 2026-06-28

## Текущее состояние (working, v0.4.0)

### Что работает
- Mouse sync (клик, движение, скролл) ✓
- Keyboard sync (нажатия, Enter, стрелки) ✓
- Text input (Input.insertText через charInput) ✓
- Navigation sync (master переходит → slave следует) ✓
- Multi-tab master (Target.setAutoAttach + addScriptToEvaluateOnNewDocument) ✓
- Slave dispatch через CDP Input.dispatch* ✓

### Что НЕ работает
1. **Browser shortcuts (Ctrl+L, Ctrl+T)** — DOM events не ловят браузерные шорткаты
2. **Windows-only** — window arranger через PowerShell

### Архитектура (текущая, рабочая)
```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent → inputCapture.injectFromCdp()
  ↓ MultiController → broadcast
  ↓ CDP Input.dispatch* → slave windows

Navigation:
  ↓ Page.frameNavigated event (master)
  ↓ cdpManager.onNavigate → navigateTo(slave, url)
```

---

## Версия и сборка
- Версия: 0.4.0
- Тесты: 310/310 pass
- Бинарник: `gui/release/MultiManager Setup 0.4.0.exe`
- Режим: CDP-based (OS hooks отключены)
- Последний коммит: `3291153 feat: add navigation sync`

## Коммиты (сессия 2026-06-28)
```
CDP-based sync (рабочий):
- 8f05658 feat: text input sync via Input.insertText + charInput event (v0.3.2)
- a24dc72 feat: multi-tab sync — Page.addScriptToEvaluateOnNewDocument + Target.setAutoAttach
- 79d45bd fix: inject cdpManager into MultiController (broadcast was null) + verbose diagnostics

OS hooks (эксперимент, НЕ работает):
- 837a03d feat: OS-level input hooks via koffi — Variant B (v0.4.0)
- 4747e98 fix: add koffi to gui/package.json for electron-builder packaging
- b8065e6 test: add WindowsHooks VK-mapping tests + update API docs to v0.4.0
- 795b04a fix: revert to CDP-based sync — OS hooks via koffi don't work in forked Node processes

Navigation sync:
- 3291153 feat: add navigation sync — master navigates, slaves follow
```

## Почему OS hooks (koffi) НЕ сработали
- koffi `register()` создаёт trampoline, который queue'ит JS callback на event loop
- `WH_MOUSE_LL` требует синхронного вызова callback во время PeekMessageW
- В forked Node.js process koffi не может вызвать JS синхронно изнутри FFI call
- Доказательство: heartbeat показал pumpCount=192, eventCount=0
- Это **фундаментальное ограничение koffi** для Windows low-level hooks

---

## TODO (для следующей сессии)
1. **Browser shortcuts** — нужен другой подход:
   - Вариант A: Native addon (.node) — C++ файл с Windows hooks, надёжнее koffi
   - Вариант B: Electron globalShortcut — требует IPC с main process
   - Вариант C: Пропустить — accept limitation, page-level shortcuts работают
2. **Multi-tab slave** — slave-окна не перехватывают input (архитектурно)
3. **Кроссплатформенность** — заменить PowerShell window arranger

## Полезные команды
```powershell
# Логи
Get-Content "$env:APPDATA\CloakManager\logs\core.log" -Tail 50

# Тесты
npx vitest run

# Сборка
cd gui; npx vite build; npx electron-builder --win

# Git
git status
git log --oneline -5
```

## Ключевые файлы
- `src/multi-control/cdp-manager.js` — CDP connection, dispatch, navigation sync
- `src/multi-control/index.js` — MultiController (broadcast, coords)
- `src/api/multi-control.js` — API routes + CDP event wiring
- `src/os-input/input-capture.js` — EventEmitter wrapper (CDP mode)
- `docs/API.md` — документация API
