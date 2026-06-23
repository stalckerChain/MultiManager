# MultiManager

MVP кроссплатформенного антидетект-браузера с REST API для ИИ-агентов (аналог AdsPower).

## Архитектура

- **Core-движок** — Node.js бэкенд с REST API, работающий в фоновом режиме
- **GUI** — Electron/Tauri фронтенд (в разработке)

Система кроссплатформенная: Windows, macOS, Linux.

## Быстрый старт

```bash
# Установка зависимостей
npm install

# Запуск в режиме разработки
npm run dev

# Запуск production
npm start

# С указанием токена
npm start -- --api-token=YOUR_SECRET_TOKEN
```

## Структура проекта

```
MultiManager/
├── package.json              # Зависимости и скрипты
├── tsconfig.json             # Конфигурация TypeScript
├── vitest.config.js          # Конфигурация тестов
├── src/
│   ├── index.js              # Точка входа
│   ├── core/
│   │   └── app.js            # Express сервер с роутами
│   ├── api/
│   │   ├── auth.js           # Авторизация по Bearer-токену
│   │   ├── profiles.js       # CRUD профилей
│   │   ├── proxies.js        # CRUD прокси + проверка
│   │   ├── cookies.js        # Импорт/экспорт куки
│   │   └── browser.js        # Управление браузером
│   ├── db/
│   │   ├── index.js          # Инициализация SQLite
│   │   ├── schema.js         # Таблицы и индексы
│   │   └── queries.js        # CRUD запросы
│   ├── fingerprint/
│   │   └── index.js          # Генератор отпечатков
│   ├── proxy/
│   │   └── index.js          # Парсинг, проверка, ротация
│   ├── cookie/
│   │   └── index.js          # Парсинг JSON/Netscape
│   ├── typing/
│   │   └── index.js          # Human-like ввод
│   ├── logger/
│   │   └── index.js          # Pino логгер
│   └── utils/
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
    ├── API.md                # Документация API
    └── DATABASE.md           # Схема базы данных
```

## Зависимости

### Production
- `better-sqlite3` — нативная работа с SQLite
- `express` — HTTP сервер
- `pino` — высокопроизводительный логгер
- `uuid` — генерация UUID
- `tree-kill` — кроссплатформенное завершение процессов

### Development
- `vitest` — тестирование
- `eslint` — линтинг
- `typescript` — типизация

## Конфигурация

### Переменные окружения

| Переменная | Описание | По умолчанию |
|------------|----------|--------------|
| `PORT` | Порт API сервера | `3000` |
| `LOG_LEVEL` | Уровень логирования | `info` |
| `NODE_ENV` | Режим работы | `development` |

### Аргументы запуска

| Аргумент | Описание |
|----------|----------|
| `--api-token=SECRET` | Токен авторизации (генерируется автоматически, если не указан) |

## Директория хранения данных

| Платформа | Путь |
|-----------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

Содержимое:
- `app.db` — база данных SQLite
- `logs/` — логи профилей

## Лицензия

ISC
