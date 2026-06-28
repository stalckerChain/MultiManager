# Multi-Control Sync — История и текущее состояние

## Текущее состояние (working, CDP-based)

### Что работает
- Mouse sync (клик, движение, скролл) ✓
- Keyboard sync (нажатия, Enter, стрелки) ✓
- Text input (Input.insertText через charInput) ✓
- Slave dispatch через CDP Input.dispatch* ✓

### Что НЕ работает
1. **Browser shortcuts (Ctrl+L, Ctrl+T)** — DOM events не ловят браузерные шорткаты
2. **Multi-tab master** — CDP binding привязан к конкретной page, новые вкладки не перехватываются (но Target.setAutoAttach + addScriptToEvaluateOnNewDocument решали это в v0.3.x)
3. **Windows-only** — window arranger через PowerShell

### Архитектура (текущая, рабочая)
```
CDP SYNC_EVENT_SCRIPT (инжектится в master page)
  ↓ Runtime.addBinding('__MM_SYNC_BIND__')
  ↓ DOM events → window.__MM_SYNC_BIND__(JSON)
  ↓ cdpManager.onEvent → inputCapture.injectFromCdp()
  ↓ MultiController → broadcast
  ↓ CDP Input.dispatch* → slave windows
```

---

## Попытка OS-level hooks (Variant B) — НЕ сработала

### Что пытались сделать
Перейти с CDP-based input capture на OS-level hooks через **koffi** FFI (Win32 API), чтобы:
- Ловить ВСЕ события ввода в master окне, включая browser shortcuts
- Не зависеть от injection script в DOM

### Архитектура Variant B
```
OS hooks (WH_MOUSE_LL + WH_KEYBOARD_LL)
  ↓ koffi FFI → EventEmitter → controller → CDP dispatch → slaves
```

### Почему НЕ сработало (3 проблемы)

#### Проблема 1: koffi v3 callback type system
- `koffi.proto('HOOKPROC', ...)` создаёт callback prototype
- `SetWindowsHookExW` требует `koffi.pointer(HOOKPROC)` как параметр
- `koffi.register(fn, koffi.pointer(HOOKPROC))` — register тоже требует pointer-wrapped тип
- **Решение**: использовать `koffi.pointer(HOOKPROC)` везде — но это не помогло до конца

#### Проблема 2: koffi callbacks queue'ятся асинхронно
- koffi `register()` создаёт native trampoline, который queue'ит JS callback на event loop
- `WH_MOUSE_LL` требует **синхронного** вызова callback во время `PeekMessageW`/`GetMessageW`
- В forked Node.js process koffi не может вызвать JS синхронно изнутри FFI call
- **Доказательство**: heartbeat показал `pumpCount: 192, eventCount: 0` — PeekMessageW вызывался, но hook callback НЕ вызывался

#### Проблема 3: koffi.alloc() v3 API change
- В koffi v3 `koffi.alloc(type)` выбрасывает "Expected 2 arguments, got 1"
- Нужно `koffi.alloc(type, count)` — даже для одного элемента

### Что пробовали
1. **In-process hooks** — koffi.register(fn, HOOKPROC) в основном процессе → callbacks не вызываются
2. **PeekMessageW pump** — `setInterval(() => PeekMessageW(...), 1)` → 100% CPU, тормоза 15-30 сек, callbacks всё равно не вызываются
3. **Forked worker process** — hook-worker.js в отдельном child_process с GetMessage loop → hooks стартуют, pump работает, но eventCount=0 (callbacks не вызываются)
4. **uncaughtException handler** — worker падал молча, ошибки не докладывались до исправления

### Почему forked worker с koffi не работает
Ключевой insight: koffi `register()` для callback создаёт trampoline, который **не может** быть вызван синхронно из Windows hook. Windows вызывает hook procedure как обычный function pointer, но koffi trampoline пытается queueнуть JS callback → event loop ещё не обработал предыдущий вызов → callback теряется.

Это **фундаментальное ограничение koffi** для использования с Windows low-level hooks.

---

## Версия и сборка
- Версия: 0.4.0
- Тесты: 310/310 pass
- Бинарник: `gui/release/MultiManager Setup 0.4.0.exe`
- Режим: CDP-based (OS hooks отключены)

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
```

## Полезные команды
```powershell
# Логи
Get-Content "$env:APPDATA\CloakManager\logs\core.log" -Tail 50

# Тесты
npx vitest run

# Сборка
cd gui; npx vite build; npx electron-builder --win
```

## TODO
1. Multi-tab support (Target.setAutoAttach + addScriptToEvaluateOnNewDocument) — должно работать из v0.3.x
2. Browser shortcuts — нужен другой подход (Electron globalShortcut? или нативный addon?)
3. Кроссплатформенность — заменить PowerShell window arranger
