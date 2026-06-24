# MultiManager

Industrial cross-platform anti-detect browser with a graphical interface and local REST API / WebSocket for autonomous AI agents (AdsPower alternative), built on the CloakBrowser C++ core.

## Architecture and Technology Stack

The project is built as a monorepo (Full-Stack Desktop Application):

- **Core Engine (Backend):** Node.js, Express, SQLite (`better-sqlite3`), Pino, WebSocket (`ws`). Runs as a hidden background service, managing the database, network fingerprints, and CloakBrowser processes.
- **GUI (Frontend):** Electron.js, Vue 3 (Composition API), Ant Design Vue, Tailwind CSS, Pinia, Vue Router, i18next.

### Cross-Platform System Integration:

- **Main / Renderer IPC:** Secure inter-process communication via `contextBridge` with full isolation (`contextIsolation: true`, `nodeIntegration: false`).
- **Dynamic Port Allocation:** Auto-start of the backend with automatic scanning and reservation of free ports in the range `3000–3100` on conflicts (`EADDRINUSE` error).
- **System Tray:** Window close event interception, hiding the UI to the system tray on Windows/macOS/Linux for uninterrupted AI agent operation in the background.
- **Auto-Update:** Background application updates via `electron-updater` with `autoDownload` and notifications support.
- **Localization (i18n):** Full on-the-fly language switching via `i18next` (English, Русский, 简体中文).
- **Theme Switcher:** Dynamic theme switching (Dark / Light / System) via CSS variables.
- **WebSocket:** Real-time broadcasting of profile statuses and logs from Core Engine to the GUI.

---

## Project Structure

```
MultiManager/
├── package.json              # Monorepo dependencies and build scripts
├── tsconfig.json             # TypeScript configuration
├── vitest.config.js          # Vitest test environment configuration
├── src/                      # BACKEND (Core Engine)
│   ├── index.js              # Backend entry point
│   ├── core/
│   │   ├── app.js            # Express.js server initialization and routes
│   │   └── websocket.js      # WebSocket server for real-time events
│   ├── api/                  # REST API endpoints
│   │   ├── auth.js           # Bearer token authentication
│   │   ├── profiles.js       # Profile CRUD
│   │   ├── proxies.js        # Proxy CRUD + checking
│   │   ├── cookies.js        # Cookie import/export
│   │   ├── browser.js        # CloakBrowser start/stop
│   │   ├── multi-control.js  # Window synchronization (CDP)
│   │   ├── window-arranger.js # Window positioning (Grid/Cascade)
│   │   ├── extensions.js     # Chrome extensions management
│   │   └── logs.js           # Profile and system log access
│   ├── db/                   # SQLite (WAL-mode initialization, table schemas, CRUD)
│   │   ├── index.js
│   │   ├── schema.js         # Tables, indexes, triggers
│   │   └── queries.js        # CRUD operations
│   ├── fingerprint/          # Fingerprint validator (cross-platform anomaly protection)
│   │   └── index.js
│   ├── proxy/                # Parsing, GeoIP checker (ipify), and mobile proxy rotation logic
│   │   └── index.js
│   ├── cookie/               # Session injection and export (JSON / Netscape TXT)
│   │   ├── index.js
│   │   └── inject.js         # Cookie injection into isolated profile directory
│   ├── typing/               # Human-like typing emulation
│   │   └── index.js
│   ├── multi-control/        # Window synchronizer (mouse/keyboard broadcast via CDP)
│   │   └── index.js
│   ├── logger/               # High-performance Pino logger (core.log + profile_[ID].log)
│   │   └── index.js
│   └── utils/
├── gui/                      # FRONTEND (Electron + Vue 3 Application)
│   ├── package.json          # GUI dependencies
│   ├── vite.config.js        # Vite configuration
│   ├── tailwind.config.js    # Tailwind CSS configuration
│   ├── postcss.config.js     # PostCSS plugins
│   └── src/
│       ├── main/             # Electron Main Process
│       │   ├── index.js      # Window creation, IPC handlers, lifecycle
│       │   ├── tray.js       # System tray (context menu)
│       │   ├── core-manager.js # Core engine fork, dynamic port allocation
│       │   └── updater.js    # Auto-updates via electron-updater
│       ├── preload/          # Isolated IPC context bridge
│       │   └── index.js      # Exposes electronAPI (getPort, getToken, quitApp, events)
│       ├── shared/
│       │   └── errors.js     # Shared error codes
│       └── renderer/         # Vue 3 App
│           ├── main.js       # Vue entry point
│           ├── App.vue       # Root component
│           ├── router.js     # Routing (Hash Router)
│           ├── style.css     # Global styles + Tailwind
│           ├── i18n/         # Localization
│           │   ├── index.js  # i18next initialization
│           │   ├── en.json   # English
│           │   ├── ru.json   # Русский
│           │   └── zh.json   # 简体中文
│           ├── stores/       # Pinia Stores
│           │   ├── app.js    # Global application state
│           │   ├── profiles.js # Profiles state
│           │   ├── proxies.js  # Proxies state
│           │   └── browser.js  # Browser state
│           ├── views/        # Screens
│           │   ├── Profiles.vue
│           │   ├── Proxies.vue
│           │   ├── WindowArranger.vue
│           │   ├── Extensions.vue
│           │   ├── Settings.vue
│           │   ├── ProfileModal.vue
│           │   └── CookieImportModal.vue
│           ├── components/   # Reusable components
│           │   ├── Layout.vue
│           │   ├── StatusBar.vue
│           │   └── LogPanel.vue
│           ├── composables/  # Vue Composables
│           └── api/          # HTTP client for Core requests
└── tests/                    # Testing infrastructure
    ├── unit/                 # Module unit tests (nock for network mocks)
    │   ├── auth.test.js
    │   ├── cookie.test.js
    │   ├── fingerprint.test.js
    │   ├── fingerprint-edge.test.js
    │   ├── proxy.test.js
    │   ├── proxy-checker.test.js
    │   ├── typing.test.js
    │   └── multi-control.test.js
    └── integration/          # Integration tests (SQLite WAL, API, CloakBrowser)
        ├── database.test.js
        ├── wal-stress.test.js
        ├── api-real.test.js
        └── profile-launch.test.js
```

---

## Quick Start (Development)

```bash
# Install backend and frontend dependencies
npm install

# Run the full application in development mode (Electron GUI + Core auto-start in background)
npm run dev

# Run the full test suite
npm test
```

### Manual Core Launch Parameters (without GUI)

```bash
npm start -- --api-token=YOUR_SECRET_TOKEN --port=3005
```

### Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start backend with auto-restart (`node --watch`) |
| `npm start` | Production Core engine launch |
| `npm test` | Run all Vitest tests |
| `npm run test:api` | Run integration API test |
| `npm run test:all` | Vitest + API test |
| `npm run lint` | ESLint check on `src/` |
| `npm run typecheck` | TypeScript check without compilation |

---

## AI Agent Integration (API Guide)

All requests to the local server must include the authorization header `Authorization: Bearer <TOKEN>`. The token is generated automatically on Electron startup and is available for copying in the GUI status bar.

### 1. Launching a Browser Profile for AI

**Request:**
```
POST http://127.0.0.1:{PORT}/api/browser/{profile_id}/start
```

**Engine Response:**
Upon successful proxy validation and fingerprint generation, the Core Engine launches CloakBrowser and returns a WebSocket endpoint to the AI agent for automation:
```json
{
  "status": "success",
  "profile_id": "8f3b201a-cb41-4c12-8671-50e50f3b4d11",
  "pid": 14208,
  "ws_endpoint": "ws://127.0.0.1:3000/devtools/browser/8f3b201a-cb41-4c12-8671-50e50f3b4d11"
}
```

### 2. AI Agent Connection Example (Python / Playwright)

The AI agent reads the `ws_endpoint` and instantly takes over session control:

```python
import asyncio
from playwright.async_api import async_playwright

async def run_ai_agent():
    ws_endpoint = "ws://127.0.0.1:3000/devtools/browser/8f3b201a-cb41-4c12-8671-50e50f3b4d11"

    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws_endpoint)
        context = browser.contexts[0]
        page = context.pages[0] if context.pages else await context.new_page()

        await page.goto("https://realsite.com")
        print(await page.title())

        await browser.close()

asyncio.run(run_ai_agent())
```

### 3. Human-like Typing Method for AI

To bypass bot detection (Cloudflare/Google), the AI agent sends text through a special Core Engine endpoint that simulates typos and delays:

```
POST http://127.0.0.1:{PORT}/api/multi-control/keyboard/type
```
```json
{
  "text": "MySecretPassword123"
}
```

### 4. Full Automation Cycle (Example)

```python
import requests
import asyncio
from playwright.async_api import async_playwright

BASE = "http://127.0.0.1:3000"
TOKEN = "your-api-token"
HEADERS = {"Authorization": f"Bearer {TOKEN}"}

# 1. Create a profile
profile = requests.post(f"{BASE}/api/profiles", headers=HEADERS, json={
    "name": "AI Worker #1",
    "platform": "windows"
}).json()

# 2. Launch browser
start = requests.post(f"{BASE}/api/browser/{profile['id']}/start", headers=HEADERS).json()
ws = start["ws_endpoint"]

# 3. Connect via Playwright and work
async def work():
    async with async_playwright() as p:
        browser = await p.chromium.connect_over_cdp(ws)
        page = browser.contexts[0].pages[0]
        await page.goto("https://example.com")
        # ... automation
        await browser.close()

asyncio.run(work())

# 4. Stop
requests.post(f"{BASE}/api/browser/{profile['id']}/stop", headers=HEADERS)
```

---

## Data Storage Directories (Data Integrity)

All isolated user data is stored at:

| Platform | Path |
|----------|------|
| Windows | `%APPDATA%/CloakManager/` |
| macOS | `~/Library/Application Support/CloakManager/` |
| Linux | `~/.config/CloakManager/` |

### System Directory Structure:

- `app.db` — SQLite database in WAL mode (Configurations, Proxies, Fingerprints, Cookies).
- `profiles_data/` — Isolated Chromium session folders (`BrowserData/` for each account: Cookies, LocalStorage, Cache).
- `extensions/` — Installed Chrome extensions.
- `logs/core.log` — General system logs (Pino JSON).
- `logs/profile_[ID].log` — Individual automation session telemetry.

---

## Testing

The project includes 12 test files based on **Vitest**:

| Test | Type | Description |
|------|------|-------------|
| `auth.test.js` | Unit | Bearer token authentication middleware |
| `cookie.test.js` | Unit | JSON/Netscape cookie parsing |
| `fingerprint.test.js` | Unit | Fingerprint generation correctness |
| `fingerprint-edge.test.js` | Unit | Edge cases (cross-platform anomalies) |
| `proxy.test.js` | Unit | Proxy string parsing |
| `proxy-checker.test.js` | Unit | Proxy checking via ipify |
| `typing.test.js` | Unit | Human-like input emulation |
| `multi-control.test.js` | Unit | Multi-control logic |
| `database.test.js` | Integration | SQLite CRUD operations |
| `wal-stress.test.js` | Integration | WAL-mode stress test |
| `api-real.test.js` | Integration | Full REST API cycle |
| `profile-launch.test.js` | Integration | CloakBrowser launch and PID capture |

```bash
# Run all tests
npm test

# With verbose output
npx vitest run --reporter=verbose
```

---

## License

ISC
