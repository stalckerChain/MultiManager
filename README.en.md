# MultiManager

MVP cross-platform anti-detect browser with REST API for AI agents (AdsPower alternative).

## Architecture

- **Core Engine** — Node.js backend with REST API, running as a background service
- **GUI** — Electron/Tauri frontend (in development)

Cross-platform support: Windows, macOS, Linux.

## Quick Start

```bash
# Install dependencies
npm install

# Development mode
npm run dev

# Production
npm start

# With custom token
npm start -- --api-token=YOUR_SECRET_TOKEN
```

## Project Structure

```
MultiManager/
├── package.json              # Dependencies and scripts
├── tsconfig.json             # TypeScript configuration
├── vitest.config.js          # Test configuration
├── src/
│   ├── index.js              # Entry point
│   ├── core/
│   │   └── app.js            # Express server with routes
│   ├── api/
│   │   ├── auth.js           # Bearer token authentication
│   │   ├── profiles.js       # Profile CRUD
│   │   ├── proxies.js        # Proxy CRUD + checking
│   │   ├── cookies.js        # Cookie import/export
│   │   ├── browser.js        # Browser management
│   │   └── multi-control.js  # Window synchronization
│   ├── db/
│   │   ├── index.js          # SQLite initialization
│   │   ├── schema.js         # Tables and indexes
│   │   └── queries.js        # CRUD queries
│   ├── fingerprint/
│   │   └── index.js          # Fingerprint generator
│   ├── proxy/
│   │   └── index.js          # Parsing, checking, rotation
│   ├── cookie/
│   │   ├── index.js          # JSON/Netscape parsing
│   │   └── inject.js         # Cookie injection
│   ├── typing/
│   │   └── index.js          # Human-like input
│   ├── multi-control/
│   │   └── index.js          # Window sync (CDP)
│   ├── logger/
│   │   └── index.js          # Pino logger
│   └── utils/
├── tests/
│   ├── unit/
│   └── integration/
└── docs/
    ├── API.md                # API documentation
    └── DATABASE.md           # Database schema
```

## Dependencies

### Production
- `better-sqlite3` — Native SQLite driver
- `express` — HTTP server
- `pino` — High-performance logger
- `uuid` — UUID generation
- `tree-kill` — Cross-platform process termination

### Development
- `vitest` — Testing
- `eslint` — Linting
- `typescript` — Type checking

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `LOG_LEVEL` | Logging level | `info` |
| `NODE_ENV` | Runtime mode | `development` |

### Launch Arguments

| Argument | Description |
|----------|-------------|
| `--api-token=SECRET` | Authorization token (auto-generated if not specified) |

## Data Storage Directory

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

Contents:
- `app.db` — SQLite database
- `logs/` — Profile logs
- `profiles/` — Profile browser data

## License

ISC
