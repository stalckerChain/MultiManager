# MultiManager GUI

Electron frontend для MultiManager.

## Архитектура

```
gui/
├── src/
│   ├── main/          # Electron Main Process
│   │   ├── index.js       # Окно, IPC, graceful shutdown
│   │   ├── core-manager.js # Fork бэкенда, динамические порты
│   │   ├── tray.js        # Системный трей
│   │   ├── updater.js     # electron-updater
│   │   ├── pty.js         # PTY-терминал
│   │   └── keyboard-hooks.js
│   ├── preload/       # IPC контекстный мост
│   ├── renderer/      # Vue 3 SPA (Ant Design, Pinia, Tailwind)
│   └── shared/        # Общие коды ошибок
├── backend/           # ← Junction → ../src/ (бэкенд-движок)
├── dist/              # Собранный Vue bundle
└── release/           # Собранный Electron installer/portable
```

## Как GUI запускает бэкенд

- **Dev-режим**: `core-manager.js` форкает `../../src/index.js` напрямую
- **Production**: `core-manager.js` форкает `resources/backend/src/index.js` (копия `src/` через `extraResources` в `gui/package.json`)

Бэкенд работает как отдельный процесс. GUI общается с ним через REST API (`http://127.0.0.1:{PORT}`) и WebSocket (`ws://127.0.0.1:{PORT}/ws`).

## Запуск

```bash
cd gui
npm install
npm run dev    # Vite dev server + Electron
```

## Сборка

```bash
npm run build  # vite build + electron-builder
# Результат: gui/release/
```
