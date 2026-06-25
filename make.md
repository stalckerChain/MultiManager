# MultiManager — Continuation Notes

## Текущая версия: 0.2.0

## Что сделано 2026-06-25/26

### Window Arranger — поиск окон по PID
- PowerShell скрипт с C# `Add-Type` теперь выводит pipe-разделённые строки (`handle|pid|name|x|y|w|h`) вместо JSON — проблема с экранированием кавычек в JS→PS→C# цепочке
- Скрипт пишется во временный файл `mm_windows.ps1` в `%TEMP%` и запускается через `-File` — длинный C# код обрезался лимитом командной строки `exec()`
- `getRunningWindows()` получает PID запущенных профилей из БД, передаёт в PowerShell
- Добавлено логирование: `targetPids`, `stdoutLen`, `windowCount` в core.log
- При старте backend сбрасывает все `running`/`starting` профили в `stopped` с `pid=NULL` (защита от статических PID после крэша)

### Window Arranger — группировка
- `GET /windows/grouped` — окна сгруппированы по профилям
- `POST /grid/grouped` — сетка с зонами для каждой группы
- `POST /cascade/grouped` — каскад с группировкой
- GUI: кнопки Grid (Groups) / Cascade (Groups), отображение имени профиля

### Версия в заголовке
- `gui/src/main/index.js`: заголовок `MultiManager v{version} (dev)` в dev, `MultiManager v{version}` в prod
- Версия читается из `package.json` с fallback на `app.getVersion()`

### Browser — привязка окон к профилям
- `profileWindows` Map хранит `{pid, handle}` для каждого профиля
- `findWindowByPid()` — находит HWND по PID через Win32 API (запускается 2 сек после спавна)
- `GET /api/browser/profile-windows` — возвращает список привязок

## Что НЕ работает (todo на завтра)

1. **Window Arranger не показывает окна** — PowerShell скрипт компилируется и выполняется, но `stdoutLen: 0`. Нужно проверить что C# код actually компилируется в asar-окружении. Возможно проблема с `Add-Type` в контексте forked Node.js процесса.
   - Логи: `core.log`, искать `Window arranger:`
   - Тестовый скрипт: `powershell -ExecutionPolicy Bypass -File tmp/test_windows.ps1` — работает из командной строки

2. **Кнопки Grid/Cascade не реагируют** — скорее всего связано с пунктом 1 (нет окон для раскладки)

3. **Заголовок без версии** — возможно旧 бинарник. Нужно переустановить `gui/release/MultiManager Setup 0.2.0.exe`

## Как запускать

```bash
# Dev
cd gui && npm run electron:dev

# Тесты
npm test

# Сборка
cd gui && npx vite build && npx electron-builder --win

# Проверка логов
# Electron: %APPDATA%\multimanager-gui\logs\app-*.log
# Backend: %APPDATA%\CloakManager\logs\core.log
```

## Ключевые файлы

- `src/api/window-arranger.js` — PowerShell скрипт + API роуты
- `src/api/browser.js` — запуск Chrome, привязка PID
- `src/index.js` — entry point, сброс статусов
- `gui/src/main/index.js` — Electron main, заголовок
- `gui/src/renderer/views/WindowArranger.vue` — GUI

## PowerShell — known issues

- `EnumWindows` callback не работает в PowerShell 5.1 через `exec()` — script block не конвертируется в делегат
- `Add-Type` с C# кодом в JSON-строках ломается из-за экранирования `\` → используем pipe-delimited output
- Длинный C# код обрезается лимитом командной строки — пишем в `.ps1` файл
