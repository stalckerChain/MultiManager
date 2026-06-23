# MultiManager

MVP кроссплатформенного антидетект-браузера с REST API для ИИ-агентов.

## Архитектура

- **Core-движок** — Node.js бэкенд с REST API
- **GUI** — Electron/Tauri фронтенд (в разработке)

## Быстрый старт

```bash
npm install
npm run dev
```

## Структура проекта

```
src/
├── index.js          # Точка входа
├── core/             # Express сервер
├── api/              # Middleware и роуты
├── db/               # SQLite (better-sqlite3)
├── fingerprint/      # Генератор отпечатков
├── proxy/            # Менеджер прокси
├── cookie/           # Импорт/экспорт куки
├── multi-control/    # Синхронизация окон
├── typing/           # Human-like ввод
├── logger/           # Pino логгер
└── utils/            # Общие утилиты
```

## API

Сервер запускается на `127.0.0.1:3000`. Все запросы требуют заголовок `Authorization: Bearer <token>`.
