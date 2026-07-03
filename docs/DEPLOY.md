# DEPLOY — Сборка и развёртывание

## Структура проекта

```
MultiManager/
├── src/                    # Core-движок (Node.js REST API)
├── gui/                    # GUI (Electron + Vue 3 + Vite)
│   ├── src/
│   │   ├── main/           # Electron main process
│   │   ├── preload/        # Preload script (contextBridge)
│   │   └── renderer/       # Vue 3 фронтенд
│   ├── dist/               # Собранный фронтенд (vite build)
│   ├── release/            # Готовые сборки (установщик, портативная версия)
│   ├── resources/          # Иконки приложения
│   └── backend → ../src    # Symlink на Core-движок
├── tests/
└── docs/
```

GUI-процесс (`gui/`) запускает Core-движок (`src/`) через `child_process.fork`. В production-сборке исходники Core копируются в `resources/backend/src/` внутри установленного приложения.

## Системные требования для сборки

| Компонент | Версия |
|-----------|--------|
| Node.js | ≥ 20.x |
| npm | ≥ 10.x |
| Python | 3.x (для `node-gyp` при сборке native-модулей) |
| Visual Studio Build Tools | C++ Desktop Workload (для `node-gyp` на Windows) |
| Git | последняя |

### Установка Visual Studio Build Tools (Windows)

Если при сборке native-модулей появляется ошибка `node-gyp`, установите Build Tools:

```bash
npm install -g windows-build-tools
# или вручную через Visual Studio Installer:
# → Workloads → "Desktop development with C++"
```

---

## 1. Установка зависимостей

### Core-движок (root)

```bash
cd MultiManager
npm install
```

### GUI (gui/)

```bash
cd MultiManager/gui
npm install
```

---

## 2. Native-модули

Проект содержит скомпилированные native-модули, которые уже включены в репозиторий:

| Модуль | Расположение | Назначение |
|--------|-------------|------------|
| `hooks.node` | `src/os-input/native-hooks/build/Release/` | C++ addon `WH_KEYBOARD_LL` (перехват клавиатуры на уровне ОС) |
| `better_sqlite3.node` | `node_modules/better-sqlite3/build/Release/` | SQLite (через npm) |
| `koffi.node` | `node_modules/@koromix/koffi-win32-x64/` | FFI для WinAPI (через npm) |

В production-сборке `*.node` файлы автоматически выносятся из `app.asar` через `asarUnpack` в конфиге electron-builder. `hooks.node` также копируется в `resources/backend/src/os-input/native-hooks/build/Release/` через `extraResources`.

> **Примечание:** Если при запуске в production возникают ошибки вида `Error: The module was compiled against a different Node.js version`, выполните пересборку native-модулей под Electron: `cd gui && npx electron-rebuild -f`

---

## 3. Запуск в режиме разработки (Dev)

### 1. Запустить Core-движок

```bash
cd MultiManager
npm run dev        # node --watch src/index.js
```

Core запустится на `http://127.0.0.1:3000` (или ближайший свободный порт 3000–3100).

### 2. Запустить GUI

```bash
cd MultiManager/gui
npm run electron:dev
```

Electron запустится с Vite dev-server на `http://localhost:5173`. Окно откроется автоматически.

---

## 4. Сборка Windows-установщика (NSIS)

```bash
cd MultiManager/gui
npm run build
# эквивалент: vite build && electron-builder
```

### Что происходит

1. **Vite build** — фронтенд (Vue 3) собирается в `gui/dist/`
2. **electron-builder** — создаёт Electron-пакет:
   - Упаковывает `dist/`, `src/main/`, `src/preload/` в `app.asar`
   - Распаковывает `*.node` модули (`better-sqlite3`, `koffi`) в `app.asar.unpacked/`
   - Копирует `../src` (Core-движок) в `resources/backend/src/` (extraResources)
   - Копирует `resources/icon.ico` → иконка приложения
   - Генерирует NSIS-установщик с кастомным скриптом `installer.nsh`

### Результат

```
gui/release/
├── MultiManager Setup 0.4.1.exe              # NSIS-установщик (~105 MB)
├── MultiManager Setup 0.4.1.exe.blockmap     # Delta-обновления
└── win-unpacked/                               # Портативная версия (распакованная)
    ├── MultiManager.exe
    ├── resources/
    │   ├── app.asar                             # GUI-код (сжатый)
    │   ├── app.asar.unpacked/
    │   │   └── node_modules/
    │   │       ├── better-sqlite3/               # Native SQLite (unpacked)
    │   │       └── @koromix/koffi-*/             # Native koffi (unpacked)
    │   └── backend/
    │       └── src/
    │           ├── index.js                       # Core-движок entry point
    │           ├── os-input/native-hooks/
    │           │   └── build/Release/hooks.node   # C++ keyboard hook addon
    │           └── ...
    └── *.dll, *.pak                              # Chromium runtime
```

### Конфигурация сборки (gui/package.json → "build")

```json
{
  "build": {
    "appId": "com.multimanager.gui",
    "productName": "MultiManager",
    "files": ["dist/**/*", "src/main/**/*", "src/preload/**/*", "backend/**/*"],
    "extraResources": [{ "from": "../src", "to": "backend/src", "filter": ["**/*"] }],
    "asarUnpack": ["**/*.node"],
    "directories": { "output": "release" },
    "win": { "target": "nsis", "icon": "resources/icon.ico" },
    "nsis": { "include": "installer.nsh" }
  }
}
```

- `extraResources` — копирует Core-движок (`../src`) в `resources/backend/src/`. Важно: `filter: ["**/*"]` включает все файлы, включая скомпилированный `hooks.node`.
- `asarUnpack: ["**/*.node"]` — native-модули выносятся из `app.asar`, т.к. Chromium не может загружать `.node` из asar-архива.
- `nsis.include` — кастомный NSIS-скрипт (`installer.nsh`), добавляющий сообщение при попытке обновления запущенного приложения.

---

## 5. Портативная версия (Portable)

Портативная версия — это содержимое папки `win-unpacked/` после сборки. Она работает без установки.

### Получение

После сборки установщика (шаг 4), папка `gui/release/win-unpacked/` содержит полностью готовую портативную версию.

### Использование

```bash
# Просто запустите
gui/release/win-unpacked/MultiManager.exe
```

Все данные (БД `app.db`, логи, настройки) будут созданы в стандартном пути Electron `userData`:
```
%APPDATA%\MultiManager\
```

### Создание архива (опционально)

```bash
cd MultiManager/gui/release
# ZIP-архив
powershell Compress-Archive -Path win-unpacked -DestinationPath "MultiManager-Portable-0.4.1.zip"
```

---

## 6. macOS сборка (DMG)

> Требуется macOS-машина с установленным Xcode Command Line Tools.

```bash
cd MultiManager/gui
npm run build
```

electron-builder автоматически выберет `mac.target: "dmg"` из конфигурации. Требуется иконка `resources/icon.icns` (256x256+).

```
gui/release/
└── MultiManager-0.4.1.dmg
```

### Кастомизация macOS-сборки

В `gui/package.json` → `"build"."mac"`:

```json
{
  "mac": {
    "target": "dmg",
    "icon": "resources/icon.icns",
    "category": "public.app-category.utilities",
    "hardenedRuntime": true,
    "gatekeeperAssess": false,
    "entitlements": "build/entitlements.mac.plist",
    "entitlementsInherit": "build/entitlements.mac.plist"
  }
}
```

Для distribution (не Ad Hoc) потребуется Apple Developer ID и код-подпись:
```bash
export APPLE_ID="developer@example.com"
export APPLE_ID_PASSWORD="app-specific-password"
npm run build -- --publish never
```

### Native-модули под macOS

`hooks.node` (WH_KEYBOARD_LL) — **Windows-only**. На macOS addon не собирается, keyboard hooks не загружаются (keyboard-hooks.js вернёт `addon not found` — это нормальное поведение, multi-control работает через CDP без native hooks).

---

## 7. Linux сборка (AppImage)

> Требуется Linux-машина с `libxss1`, `libgtk-3-0`.

```bash
cd MultiManager/gui
npm run build
```

electron-builder выберет `linux.target: "AppImage"`. Требуется иконка `resources/icon.png` (512x512+).

```
gui/release/
└── MultiManager-0.4.1.AppImage
```

### Альтернативные форматы

```json
{
  "linux": {
    "target": ["AppImage", "deb", "rpm"],
    "icon": "resources/icon.png",
    "category": "Utility"
  }
}
```

### Native-модули под Linux

Аналогично macOS — `hooks.node` не собирается, keyboard hooks недоступны.

---

## 8. Автоматические обновления (electron-updater)

Проект интегрирует `electron-updater` (v6.3.9). Модуль `gui/src/main/updater.js` проверяет `latest.yml` на GitHub Releases.

### Workflow обновлений

1. Создайте git tag с версией:
   ```bash
   git tag v0.4.2
   git push origin v0.4.2
   ```

2. Соберите с публикацией:
   ```bash
   cd gui
   npm run build -- --publish always
   ```

3. electron-builder загрузит в GitHub Releases:
   - `MultiManager Setup 0.4.2.exe` — полный установщик
   - `MultiManager Setup 0.4.2.exe.blockmap` — дельта-обновление
   - `latest.yml` — метаданные для electron-updater

4. Приложение проверит `latest.yml` при старте и предложит обновление.

### Без GitHub (локальное обновление)

Для внутреннего обновления без GitHub, `latest.yml` можно разместить на любом HTTP-сервере:

```bash
# В updater.js: изменить feed URL на кастомный
const feedUrl = 'http://your-server.com/updates/latest.yml';
autoUpdater.setFeedURL(feedUrl);
```

---

## 9. Устранение неполадок

### `hooks.node` не найден в production

**Симптом:** лог `hooks.log` → `FATAL: hooks.node addon not found`

**Причина:** `hooks.node` не попал в `extraResources` при сборке.

**Решение:**
1. Проверьте, что `src/os-input/native-hooks/build/Release/hooks.node` существует (файл должен быть в репозитории)
2. Проверьте `gui/package.json` → `extraResources` → `filter: ["**/*"]`
3. Пересоберите установщик с чистой директорией `release`: `rm -rf gui/release && cd gui && npm run build`

### `Error: The module was compiled against a different Node.js version`

**Симптом:** приложение падает при `require('better-sqlite3')` или `require('koffi')`.

**Решение:**
```bash
cd gui
npx electron-rebuild -f -w better-sqlite3
npx electron-rebuild -f -w koffi
npm run build
```

### NSIS-установщик не создаёт ярлык

Проверьте `installer.nsh` — кастомный скрипт может переопределять дефолтное поведение. Для стандартного ярлыка убедитесь, что `gui/package.json` → `nsis` не содержит `"createDesktopShortcut": false`.

### Портативная версия не находит backend

**Симптом:** Core не запускается, окно пустое.

**Причина:** `resources/backend/src/index.js` отсутствует.

**Решение:** В production путь к backend — `process.resourcesPath + '/backend/src/index.js'`. Проверьте:
```
win-unpacked/resources/backend/src/index.js  ← должен существовать
```

Если папка `backend` пуста — пересоберите с чистой директорией `release`:
```bash
rm -rf gui/release
cd gui && npm run build
```

---

## 10. Полная сборка с нуля (clean build)

```bash
# 1. Очистить всё
rm -rf gui/dist gui/release gui/node_modules node_modules

# 2. Установить зависимости
npm install
cd gui && npm install && cd ..

# 3. Запустить тесты
npm test

# 4. Собрать установщик
cd gui && npm run build
```

Результат: `gui/release/MultiManager Setup {version}.exe`
