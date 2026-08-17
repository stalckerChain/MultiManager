# API Reference

REST API for anti-detect browser management. All requests require an authorization header.

## Authentication

```http
Authorization: Bearer <token>
```

Token is generated on first launch or passed via `API_TOKEN` environment variable.

---

## Health Check

### GET /health

Check server health.

**Response:**
```json
{
  "status": "ok"
}
```

---

## Profile Info (public loopback)

### GET /profile-info/:profileId

Public local HTML endpoint (no auth, loopback only). On profile launch a new
tab opens in the browser with URL
`http://127.0.0.1:<port>/profile-info/<profileId>` — a page with account
information. The tab title (`<title>`) equals the account name.

The endpoint reads the profile and its linked proxy from the existing query
objects and returns HTML with only the agreed fields:

- `name` — account name (tab and page title);
- `email`;
- `wallet_evm_address`;
- `wallet_sol_address`;
- `twitter_username` — shown as X username;
- `discord_username`;
- proxy `last_ip` (proxy IP);
- proxy `location` (proxy location).

Missing values are shown with a uniform safe placeholder `Не указано`. All
user values are escaped before being inserted into the HTML.

Secret fields are never included in the HTML: `email_password`,
`wallet_password`, `twitter_password`, `twitter_auth_token`, `twitter_email`,
`discord_password`, `discord_token`, `discord_email`, proxy username/password,
fingerprint seed.

Limitations:

- No auth by agreement. Even when bound to `127.0.0.1`, any local process that
  knows the profile UUID can read the displayed account data. The profile UUID
  must not be treated as an authorization mechanism.
- No dedicated rate limiter for `/profile-info/:profileId` (loopback only, the
  endpoint is outside `/api/`).
- The info tab URL is never logged.

**Response (200):** HTML page, `Content-Type: text/html`
**Response (404):** `{ "error": "Профиль не найден" }`

---

## Profiles

### POST /api/profiles

Create a new profile. Fingerprint is auto-generated. **timezone is required.**

**Request Body:**
```json
{
  "name": "My Profile",
  "platform": "windows",
  "timezone": "Europe/Berlin",
  "proxy_id": 1,
  "extensions": ["ext1", "ext2"],
  "tags": ["tag1"],
  "notes": "Note",
  "email": "user@example.com",
  "email_password": "secret",
  "twitter_username": "my_twitter",
  "twitter_password": "tw_secret",
  "twitter_auth_token": "auth_token_123",
  "twitter_email": "tw@example.com",
  "discord_username": "my_discord",
  "discord_password": "dc_secret",
  "discord_token": "dc_token_456",
  "discord_email": "dc@example.com",
  "wallet_evm_address": "0x1234567890abcdef1234567890abcdef12345678",
  "wallet_sol_address": "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
  "wallet_password": "my_wallet_pass"
}
```

**Required Fields:** `name`, `platform` (windows | macos | linux)

**Response (201):**
```json
{
  "id": "f81d4fae-7dec-11d0-a765-00a0c91e6bf6",
  "number": 1,
  "name": "My Profile",
  "proxy_id": 1,
  "fingerprint_seed": "a1b2c3d4-...",
  "platform": "windows",
  "user_agent": "Mozilla/5.0 ...",
  "screen_resolution": "1920x1080",
  "hardware_cores": 8,
  "hardware_memory": 16,
  "extensions": "[\"ext1\",\"ext2\"]",
  "tags": "[\"tag1\"]",
  "notes": "Note",
  "timezone": "Asia/Bishkek",
  "email": "user@example.com",
  "email_password": "secret",
  "twitter_username": "my_twitter",
  "twitter_password": "tw_secret",
  "twitter_auth_token": "auth_token_123",
  "twitter_email": "tw@example.com",
  "discord_username": "my_discord",
  "discord_password": "dc_secret",
  "discord_token": "dc_token_456",
  "discord_email": "dc@example.com",
  "wallet_evm_address": "0x1234567890abcdef1234567890abcdef12345678",
  "wallet_sol_address": "AbCdEfGhIjKlMnOpQrStUvWxYz1234567890abcd",
  "wallet_password": "my_wallet_pass",
  "status": "stopped",
  "created_at": "2024-01-01T00:00:00.000Z",
  "updated_at": "2024-01-01T00:00:00.000Z"
}
```

---

### GET /api/profiles

Get all profiles.

**Response (200):** Array of profiles

---

### GET /api/profiles/:id

Get profile by ID.

**Response (200):** Profile
**Response (404):** `{ "error": "Profile not found" }`

---

### PUT /api/profiles/:id

Update profile.

**Request Body:**
```json
{
  "name": "New Name",
  "proxy_id": 2,
  "extensions": ["new_ext"],
  "tags": ["new_tag"],
  "notes": "New note",
  "timezone": "Europe/London",
  "email": "new@example.com",
  "email_password": "new_secret",
  "twitter_username": "new_twitter",
  "twitter_auth_token": "new_token",
  "discord_username": "new_discord",
  "wallet_evm_address": "0xabcdef1234567890abcdef1234567890abcdef12"
}
```

**Fingerprint set** (optional, must be sent as one complete set):
```json
{
  "platform": "windows",
  "fingerprint_seed": "46f7702b-c11d-4ab7-b29c-d314472e7e5c",
  "user_agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...",
  "screen_resolution": "1920x1080",
  "hardware_cores": 8,
  "hardware_memory": 16,
  "fingerprint_platform": "windows"
}
```

Behavior:
- If a complete fingerprint set (all six fields) is provided, it is saved in a single UPDATE without generating a new fingerprint, even when `platform` changes. `fingerprint_platform` must match the effective platform (`platform` if provided, otherwise the profile's current platform); on mismatch — `400`.
- If no set is provided and `platform` differs from the saved one — the backend generates a new full fingerprint for the new platform (previous behavior).
- If no set is provided and the platform is unchanged — the profile's fingerprint fields are kept unchanged.
- An incomplete set (e.g. only `user_agent`) is rejected with `400`.

**Response (200):** Updated profile

---

### DELETE /api/profiles/:id

Delete profile. Cannot delete a running profile.

**Response (204):** Deleted successfully
**Response (409):** `{ "error": "Cannot delete running profile" }`

---

### POST /api/profiles/:id/regenerate

Regenerate profile fingerprint.

**Response (200):** Profile with new fingerprint

---

### POST /api/profiles/batch

Bulk create profiles. All operations run in a single transaction (auto-rollback on error).

**Request Body:**
```json
{
  "accounts": [
    { "name": "Profile 1", "platform": "windows" },
    { "name": "Profile 2", "platform": "macos" }
  ]
}
```

**Required fields per item:** `name`, `platform`

**Response (201):** Array of created profiles
```json
[
  { "id": "...", "name": "Profile 1", "number": 1, ... },
  { "id": "...", "name": "Profile 2", "number": 2, ... }
]
```

**Response (400):** `{ "error": "Item [0] requires name and platform" }`

---

## Proxies

### POST /api/proxies

Add a proxy.

**Request Body:**
```json
{
  "type": "socks5",
  "host": "proxy.example.com",
  "port": 1080,
  "username": "user",
  "password": "pass",
  "proxy_rotation_url": "https://api.proxy.com/rotate"
}
```

**Required Fields:** `type`, `host`, `port`

`host` is normalized before saving: leading/trailing whitespace is removed (`trim`) and the value is converted to lowercase (`toLowerCase`). The normalized `host` is stored in the database.

A duplicate is determined by the normalized `host:port` pair. The `type`, `username`, `password` and `proxy_rotation_url` fields are not part of the duplicate key.

**Response (201):** Created proxy

**Response (409):** A proxy with the same `host:port` already exists
```json
{
  "error": "A proxy with the same host:port already exists"
}
```

---

### POST /api/proxies/import

Bulk import proxies.

**Request Body:**
```json
{
  "text": "socks5://user:pass@host1:1080\nhttp://host2:8080"
}
```

**Response (201):**
```json
{
  "count": 2,
  "duplicate_count": 1,
  "proxies": [...],
  "duplicates": [...]
}
```

`count` — number of newly created proxies, `duplicate_count` — number of skipped duplicates.

The same `host` normalization (trim + lowercase) as in single creation is applied to every proxy in the list. A duplicate is determined by the normalized `host:port` pair. Rows repeated within a single input list are dropped by the same sequential check after each insert: `duplicate_count` covers both matches with existing records and repeated rows of the list.

---

### GET /api/proxies

Get all proxies.

**Response (200):** Array of proxies

---

### GET /api/proxies/:id

Get proxy by ID.

---

### PUT /api/proxies/:id

Update proxy.

**Request Body:**
```json
{
  "host": "new-host.com",
  "port": 9090,
  "is_active": true
}
```

If the `host` field is provided, it is normalized (trim + lowercase) before checking and saving. If `host` is absent, the current value is preserved unchanged.

Before updating, a conflict check is performed against the normalized `host:port` pair (for fields actually provided in the request; missing ones are taken from the current record). If it matches another record, **409** is returned and the record is not modified. Updating a record to its own current normalized `host:port` is allowed.

**Response (200):** Updated proxy

**Response (409):** A proxy with the same `host:port` already exists
```json
{
  "error": "A proxy with the same host:port already exists"
}
```

---

### DELETE /api/proxies/:id

Delete proxy.

---

### POST /api/proxies/:id/check

Check proxy (with auto-rotation if configured).

**Response (200):**
```json
{
  "ok": true,
  "ip": "1.2.3.4"
}
```

**Response (502):**
```json
{
  "error": "Rotation error",
  "details": "Timeout"
}
```

---

### POST /api/proxies/distribute/preview

Pre-check proxies before distribution. Sequentially checks the source set of the selected
mode (with rotation when configured) and returns the results **without** changing profile
assignments. Does not return proxy username/password.

**Request Body:**
```json
{
  "mode": "used"
}
```

**Parameters:** `mode` — `used` (unique proxies assigned to at least one profile) or
`all` (all proxies from the table, regardless of `is_active`).

**Response (200):**
```json
{
  "mode": "used",
  "profiles_count": 10,
  "checked_count": 5,
  "working_count": 4,
  "failed_count": 1,
  "working_proxy_ids": [1, 2, 3, 4]
}
```

- `profiles_count` — total number of profiles (target group);
- `checked_count` — number of checked proxies;
- `working_count` / `failed_count` — working and failed proxies;
- `working_proxy_ids` — numeric IDs of working proxies, passed to the second phase.

Each proxy is checked the same way as `POST /api/proxies/:id/check` (rotation → wait →
check); technical fields (`is_active`, `last_ip`, location) are updated. An error on one
proxy does not stop the rest — such proxy is treated as failed.

**Response (400):** invalid `mode`.

---

### POST /api/proxies/distribute

Confirmed distribution of working proxies across all profiles. Does not re-check the
network. Updates only `profiles.proxy_id` in a single SQLite transaction. Does not return
proxy username/password.

**Request Body:**
```json
{
  "mode": "used",
  "working_proxy_ids": [1, 2, 3, 4]
}
```

**Parameters:**
- `mode` — the same mode as in preview;
- `working_proxy_ids` — working proxy IDs from the preview response.

The backend re-validates that all passed IDs belong to the valid source of the selected
mode; on mismatch the operation is rejected without changes.

**Distribution logic:** accounts are processed in a stable order (`profiles.number`); for
each account a random proxy is picked from the remaining ones in the current cycle; when
working proxies run out, the full list is restored (cycle restarts). Within one cycle a
proxy is not repeated.

**Response (200):**
```json
{
  "assigned_profiles": 10,
  "used_proxies": 4
}
```

**Response (400):**
- `working_proxy_ids` contains proxies outside the valid source for the selected mode;
- `working_proxy_ids` is empty — «No working proxies to distribute»; assignments are not changed.

---

### GET /api/proxies/:id/timezone

Get timezone by proxy IP address. Requires prior proxy check.

**Response (200):**
```json
{
  "timezone": "Europe/Berlin"
}
```

**Response (500):**
```json
{
  "error": "Proxy IP not determined. Run proxy check first.",
  "code": "BAD_GATEWAY"
}
```

---

## Cookies

### GET /api/cookies/:profileId

Get profile cookies.

**Response (200):** Array of cookies

---

### POST /api/cookies/:profileId/import

Import cookies.

**Request Body:**
```json
{
  "format": "json",
  "content": "[{\"name\":\"session\",\"value\":\"abc123\",\"domain\":\".example.com\"}]"
}
```

**Formats:** `json`, `netscape`

**Response (200):**
```json
{
  "count": 1
}
```

---

### GET /api/cookies/:profileId/export?format=json

Export cookies.

**Parameters:** `format` (json | netscape)

**Response (200):** Array of cookies or Netscape format text

---

### DELETE /api/cookies/:profileId

Delete all profile cookies.

---

## Browser Management

### POST /api/browser/:id/start

Start browser. Automatically checks proxy if assigned. Browser launches with anti-detect args: `--fingerprint-timezone` (timezone from GeoIP proxy, fallback — profile), `--lang=en-US`, `--no-first-run`, `--no-default-browser-check`, `--disable-session-crashed-bubble`. On `ERR_ADDRESS_IN_USE` error, automatically retries up to 3 times.

**Optional request body:**
```json
{
  "run_id": "run-123"
}
```

`run_id` — automation run identifier. When provided, extension loading stages (`browser_connection`, `cdp_extension_loading`) and failures are written to the linked run log (`logs/runs/<run_id>/<profile>.log`). Omitting `run_id` (manual profile launch) keeps those stages out of a run log. Contains no secrets. The automation client (e.g. `stAuto0`, which receives `--run-id` from the executor) is expected to pass it in this body.

**Wallet auto-login (manual launch, no `run_id`):** after the browser starts and extensions load, a wallet-field preflight is performed:

- If `wallet_evm_address` and `wallet_password` are both non-empty, the existing Zerion auto-login runs. Before and after login (including on failure) all page tabs are closed and a single `about:blank` tab remains.
- If at least one wallet field is missing or empty, auto-login is skipped; tabs are still normalized to a single `about:blank`.
- A login error does not stop the browser: it is written to the profile log without the password, EVM address, or URLs; the launch returns a successful state.
- Manual auto-login is never triggered for automation requests that include `run_id`.
- Password, EVM address, and URLs are never logged.

**Info tab:** at the very end of the launch (after extension loading and manual
auto-login, before the response) a tab opens with URL
`http://127.0.0.1:<port>/profile-info/<profileId>`, where `<port>` is the actual
MultiManager server port that accepted the start request
(`req.socket.localPort`). If a blank `about:blank` tab remains after the startup
operations (auto-login / tab normalization), the page opens in that tab
(`Target.attachToTarget` + `Page.navigate`); otherwise a new target is created
(`Target.createTarget`, e.g. for automation/MM launches). The page is accessible
without auth on loopback only (see the "Profile Info" section). A failure to open
the tab does not stop an already successful launch: it is logged safely (only
`profileId` and an error category); the tab URL is never logged.

**Response (200):**
```json
{
  "status": "success",
  "profile_id": "f81d4fae-...",
  "pid": 48210,
  "cdp_port": 9331,
  "ws_endpoint": "http://127.0.0.1:9331"
}
```

**Response (412):** Proxy unavailable
```json
{
  "error": "Proxy unavailable",
  "details": "Connection refused"
}
```

**Response (502):** Proxy rotation error

---

### POST /api/browser/:id/stop

Stop browser. Graceful shutdown via CDP:

1. `Browser.close` on a browser-level WebSocket (2 s timeout) — Chromium itself closes tabs and flushes persistent storage (including SQLite WAL).
2. Wait for process exit up to 8 seconds.
3. On timeout — graceful signal: Unix `SIGTERM`, Windows `taskkill /PID <pid> /T` without `/F`.
4. If the process is still running — force kill: Unix `SIGKILL`, Windows `taskkill /PID <pid> /T /F`.

On Windows a short fixed wait (2–3 s) is always applied after `taskkill` without `/F`: Chromium may ignore WM_CLOSE, so a force kill follows. Unavailable CDP or a `Browser.close` error does not block the fallback termination. A repeated stop/shutdown for the same profile is ignored (`stoppingProfiles`).

**Response (200):**
```json
{
  "status": "stopped"
}
```

---

### POST /api/browser/shutdown

Mass stop all running browsers. Each profile is stopped via CDP graceful shutdown: `Browser.close` → wait for process exit → graceful signal (`SIGTERM` / `taskkill /T`) → force kill (`SIGKILL` / `taskkill /T /F`).

**Response (200):**
```json
{
  "stopped": 3
}
```

---

### GET /api/browser/:id/status

Get browser status.

**Response (200):**
```json
{
  "id": "f81d4fae-...",
  "status": "running",
  "pid": 48210
}
```

---

### POST /api/browser/:id/clean

Clean profile cache. Only available for stopped profiles.

**Response (200):**
```json
{
  "status": "cleaned"
}
```

**Response (409):**
```json
{
  "error": "Cannot clean cache of running profile"
}
```

---

### GET /api/browser/profile-windows

Get list of profile-to-window bindings.

**Response (200):**
```json
[
  {
    "profileId": "f81d4fae-...",
    "pid": 48210,
    "handle": "12345"
  }
]
```

---

### POST /api/browser/:id/type

Human-like text input via CDP. Simulates real typing with 50–150 ms delays and 3% typos with Backspace.

**Request Body:**
```json
{
  "text": "Hello, world!"
}
```

**Required fields:** `text`

**Response (200):**
```json
{
  "status": "success"
}
```

**Response (400):** `{ "error": "Text field is required" }`
**Response (404):** `{ "error": "Profile not found" }`
**Response (409):** `{ "error": "Profile is not running" }`
**Response (502):** `{ "error": "CDP port not found" }`

---

### POST /api/browser/:id/zerion-login

Auto-login to Zerion extension (extension ID: `klghhnkeealcohjjanjjdaeeggmfmlpl`).

**Request Body:**
```json
{
  "password": "zerion_password"
}
```

**Response (200):**
```json
{
  "status": "success"
}
```

**Response (404):** `{ "error": "Profile not found" }`
**Response (409):** `{ "error": "Profile is not running" }`
**Response (502):** `{ "error": "CDP port not found" }`

---

## Multi-Control (Window Sync) — v0.15.0

Broadcasts actions from master window to all slave windows via CDP (Chrome DevTools Protocol).

**Architecture:**
- **DOM input capture**: CDP binding `Runtime.addBinding('__MM_SYNC_BIND__')` injected into master page via `SYNC_EVENT_SCRIPT`. DOM events (mousemove, mousedown, mouseup, wheel, keydown, keyup) + `visibilitychange` → `window.__MM_SYNC_BIND__(JSON)` → `cdpManager.onEvent` → `inputCapture.injectFromCdp()` → `controller`
- **Native hooks (OS-level)**: C++ addon `WH_KEYBOARD_LL` intercepts ALL keys at OS level, including browser shortcuts (Ctrl+T, Ctrl+W). HTTP POST → `/api/multi-control/os-keyboard`
- **Mouse smoothing**: MouseSmoother (ghost-cursor `path()`: cubic Bézier + Fitts's Law + overshoot) + `setTimeout` dispatch loop + `flush()` before click
- **Scroll**: Split into series of `wheel` dispatches (SCROLL_STEP_PX=40, SCROLL_TICK_MS=16)
- **Multi-tab**: HTTP `/json` polling every 300ms to detect natively opened tabs. Tab mapping 1:N via `Map<masterTargetId, Map<slaveId, slaveTargetId>>` + `tabIndex` matrix
- **Focus activation**: Chain `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()` for DOM input focus in slaves
- **Double dispatch**: When typing in DOM elements, keys are sent to slaves twice (CDP + native hook)

> **Platform Limitation:** Native OS keyboard hooks (WH_KEYBOARD_LL) are only available on Windows. On macOS/Linux, keyboard synchronization uses CDP-only mode — browser chrome shortcuts (Ctrl+T, Ctrl+W) are not captured.

### GET /api/multi-control/status

Get multi-control status.

**Response (200):**
```json
{
  "active": true,
  "masterId": "f81d4fae-...",
  "slaveCount": 3,
  "slaves": ["uuid-1", "uuid-2", "uuid-3"]
}
```

---

### POST /api/multi-control/start

Start multi-control. Sets master profile.

**Request Body:**
```json
{
  "masterId": "f81d4fae-..."
}
```

**Response (200):**
```json
{
  "status": "active",
  "masterId": "f81d4fae-...",
  "mode": "cdp"
}
```

**Response (412):** `{ "error": "CDP port unavailable" }`

---

### POST /api/multi-control/stop

Stop multi-control. Detaches all slaves.

**Response (200):**
```json
{
  "status": "stopped"
}
```

---

### POST /api/multi-control/slave/add

Add slave profile.

**Request Body:**
```json
{
  "profileId": "uuid-slave-1"
}
```

**Response (200):**
```json
{
  "status": "added",
  "profileId": "uuid-slave-1",
  "slaveCount": 1
}
```

**Response (409):** `{ "error": "Multi-control not active" }`

---

### POST /api/multi-control/slave/remove

Remove slave profile.

**Request Body:**
```json
{
  "profileId": "uuid-slave-1"
}
```

**Response (200):**
```json
{
  "status": "removed",
  "profileId": "uuid-slave-1"
}
```

---

### POST /api/multi-control/window-position

Set window position for a slave profile.

**Request Body:**
```json
{
  "profileId": "uuid-slave-1",
  "x": 100,
  "y": 100,
  "width": 800,
  "height": 600
}
```

**Response (200):**
```json
{
  "status": "ok"
}
```

---

### GET /api/multi-control/cdp-status

Get CDP connection status.

**Response (200):**
```json
{
  "f81d4fae-...": true,
  "uuid-slave-1": true,
  "uuid-slave-2": true
}
```

---

### POST /api/multi-control/os-keyboard

Receive keyboard events from OS-level hook (Electron main process, WH_KEYBOARD_LL C++ addon).

Intercepts ALL keys at OS level, including browser shortcuts (Ctrl+T, Ctrl+W, etc.) and address bar input.

> **Double Dispatch:** When typing in a DOM element (textarea, input), the key is sent to slave twice — once via CDP SYNC_EVENT_SCRIPT and once via this endpoint.

**Request Body:**
```json
{
  "type": "keyDown",
  "key": "l",
  "code": "KeyL",
  "windowsVirtualKeyCode": 76,
  "ctrlKey": true,
  "shiftKey": false,
  "altKey": false,
  "metaKey": false
}
```

**Response (200):**
```json
{
  "ok": true
}
```

---

### POST /api/multi-control/focus-windows

Focus all multi-control windows (slaves first, then master).

**Response (200):**
```json
{
  "focused": true
}
```

---

## Internal API

### GET /api/internal/profiles?range=001-010

Get profiles by number range. Secret fields (passwords, auth tokens, proxy credentials) are not returned.

**Parameters:** `range` — number range in `NNN-NNN` format

**Response (200):** Array of profiles (without secret fields)

**Response (400):** `{ "error": "Invalid range format: 001-010" }`

---

### GET /api/internal/profiles/:id/zerion-extension

Return the runtime ID of the Zerion extension for a specific profile. Used by the `stAuto0` client when initializing a wallet: the import URL is built with the actual extension ID instead of a stale constant. The runtime ID is computed via `resolveRuntimeId()` (priority: exact path match in `Default/Secure Preferences`, then `manifest.key`); the extension directory name is not the runtime ID.

**Parameters:** `:profileId` — profile UUID

**Response (200):**
```json
{ "id": "abcdefghijklmnopabcdefghijklmnop" }
```

**Errors (400):** `{ "error": "Invalid extension list in the profile" }`, `{ "error": "No Zerion extension found in the profile" }`, `{ "error": "Failed to resolve the Zerion runtime ID" }`, `{ "error": "Zerion runtime ID has an invalid format" }`

**Error (404):** `{ "error": "Profile not found" }`

---

### GET /api/internal/profile-storage

Return the actual directory where MultiManager stores its standard profiles. Used by the `stAuto0` migration script (`migrate_profile_dirs.py`) to copy profile data into the correct directory. The path honors the `MULTIMANAGER_DATA_DIR` environment variable.

Requires the `Authorization: Bearer <token>` header.

**Parameters:** none

**Response (200):**
```json
{
  "profiles_dir": "C:\\Users\\stalcker\\AppData\\Roaming\\MultiManager\\profiles"
}
```

The endpoint accepts no parameters, changes no state, and does not touch the database. The directory is neither created nor checked for existence.

**Error (401):** missing or invalid Bearer token.

**Error (500):** configuration error (for example, an invalid `MULTIMANAGER_DATA_DIR`).

---

## Extensions

### GET /api/extensions

Get list of installed extensions.

**Response (200):**
```json
[
  {
    "id": "my-extension",
    "name": "My Extension",
    "version": "1.0.0",
    "description": "Extension description",
    "enabled": true,
    "path": "/path/to/extension"
  }
]
```

> **Note:** If the extension's `manifest.json` uses i18n placeholders like `__MSG_appName__`, they are automatically resolved via `_locales/<locale>/messages.json`. The locale is chosen based on the system language with a fallback to `en`. If resolution fails, the raw manifest value is returned.

---

### POST /api/extensions

Install an extension from a directory on disk.

**Request Body:**
```json
{
  "name": "my-extension",
  "path": "/path/to/unpacked/extension"
}
```

**Response (201):** Installed extension

---

### DELETE /api/extensions/:id

Delete an extension.

**Response (204):** Deleted successfully

---

### POST /api/extensions/:id/toggle

Toggle extension enabled state.

**Response (200):**
```json
{
  "id": "my-extension",
  "enabled": true
}
```

---

### POST /api/extensions/:id/assign-all

Assign the extension to all profiles. The extension ID is added to the `extensions` field of every profile in the database. Profiles that already have the extension assigned are skipped.

**Response (200):**
```json
{
  "assigned": 5
}
```

`assigned` — number of profiles that were assigned the extension.

**Response (404):** `{ "error": "Extension not found" }`

---

### POST /api/extensions/from-store

Install an extension from Chrome Web Store by URL or ID.

**Request Body:**
```json
{
  "url": "https://chrome.google.com/webstore/detail/extension-name/abcdefghijklmnopqrstuvwxyzabcdef"
}
```

Extension ID is 32 `[a-z]` characters, auto-extracted from the URL.

**Response (201):** Installed extension

---

### POST /api/extensions/from-zip

Install an extension from a ZIP or CRX archive.

**Request Body:**
```json
{
  "name": "my-extension",
  "zipPath": "/path/to/extension.zip"
}
```

If the archive has a single root directory, it is stripped automatically.
Supports CRX v2 and CRX v3 formats.

**Response (201):** Installed extension

---

## Logs

### GET /api/logs

Get recent system log entries (core.log).

**Parameters:** `limit` (default 100)

**Response (200):** Array of log entries

---

### GET /api/logs/tail

Get last N bytes of system log.

**Parameters:** `bytes` (default 10240)

**Response (200):**
```json
{
  "content": "...",
  "size": 51200
}
```

---

### GET /api/logs/profile/:profileId

Get logs for a specific profile.

**Parameters:** `limit` (default 100)

**Response (200):** Array of log entries

---

### GET /api/logs/files

Get list of all log files.

**Response (200):**
```json
[
  {
    "name": "core.log",
    "size": 51200,
    "modified": "2024-01-01T00:00:00.000Z"
  }
]
```

---

## Window Arranger

### GET /api/window-arranger/windows

Get list of current windows on screen.

**Response (200):**
```json
[
  {
    "id": "12345",
    "name": "CloakBrowser - Profile 1",
    "x": 0,
    "y": 0,
    "width": 1920,
    "height": 1080
  }
]
```

---

### GET /api/window-arranger/windows/grouped

Get windows grouped by profile.

**Response (200):**
```json
[
  {
    "profileId": "f81d4fae-...",
    "profileName": "My Profile",
    "profileNumber": 1,
    "windows": [
      {
        "id": "12345",
        "name": "CloakBrowser - Profile 1",
        "x": 0,
        "y": 0,
        "width": 1920,
        "height": 1080
      }
    ]
  }
]
```

---

### POST /api/window-arranger/grid

Arrange all windows in a grid (tile mode).

**Response (200):**
```json
{
  "arranged": 4,
  "cols": 2,
  "rows": 2,
  "screen": { "width": 1920, "height": 1080 }
}
```

---

### POST /api/window-arranger/grid/grouped

Arrange windows in a grid grouped by profile. Each profile's windows are placed in their own screen zone.

**Response (200):**
```json
{
  "arranged": 4,
  "groups": 2,
  "screen": { "width": 1920, "height": 1080 }
}
```

---

### POST /api/window-arranger/cascade

Arrange windows in cascade (overlapping with 30px offset).

**Response (200):**
```json
{
  "arranged": 4,
  "offset": 30
}
```

---

### POST /api/window-arranger/cascade/grouped

Arrange windows in cascade grouped by profile.

**Response (200):**
```json
{
  "arranged": 4,
  "offset": 30
}
```

---

### POST /api/window-arranger/focus/:windowId

Focus a specific window.

**Response (200):**
```json
{
  "focused": "12345"
}
```

---

### POST /api/window-arranger/close-all-tabs

Close all tabs in every running profile.

For each profile a new `about:blank` tab is created first, then the original
page tabs are closed (except the newly created one). The created tab is never
closed. An error in one profile does not stop the others. URLs and links are
never logged.

**Response (200):**
```json
{
  "total": 2,
  "success": 1,
  "failed": 1,
  "profiles": [
    {
      "profileId": "f81d4fae-...",
      "profileName": "My Profile",
      "success": true,
      "closed": 5,
      "kept": 1,
      "errors": []
    },
    {
      "profileId": "f81d4fae-...",
      "profileName": "Another Profile",
      "success": false,
      "closed": 0,
      "kept": 0,
      "errors": [],
      "error": "CDP port is unavailable for profile ..."
    }
  ]
}
```

Fields:

- `total` — number of processed running profiles;
- `success` / `failed` — profiles without errors / with errors;
- `profiles[]` — per-profile result:
  - `profileId`, `profileName`;
  - `success` — whether the operation finished without errors;
  - `closed` — how many original tabs were closed;
  - `kept` — how many tabs were kept (the created `about:blank`);
  - `errors[]` — partial close errors per target (`targetId` + `error`);
  - `error` — whole-profile error (e.g. CDP port unavailable).

---

### POST /api/window-arranger/open-links

Open the given links in every running profile.

**Request body:**
```json
{
  "links": ["https://example.com/page1", "https://example.com/page2"]
}
```

`links` — an array of strings. Empty strings are skipped, order is preserved. A
separate tab is created for each non-empty link in each running profile. Processing
continues after an individual link or profile error. URLs are never logged and do
not appear in error messages.

**Errors (400):** `links` is not an array of strings — `{ "error": "links must be
an array of strings", "code": "BAD_REQUEST" }`.

**Response (200):**
```json
{
  "total": 3,
  "created": 5,
  "failed": 1,
  "profiles": [
    {
      "profileId": "f81d4fae-...",
      "profileName": "My Profile",
      "success": true,
      "created": 3,
      "failed": 0,
      "errors": []
    },
    {
      "profileId": "f81d4fae-...",
      "profileName": "Another Profile",
      "success": false,
      "created": 2,
      "failed": 1,
      "errors": [{ "error": "CDP error" }]
    }
  ]
}
```

Fields:

- `total` — number of non-empty links;
- `created` — total tabs created;
- `failed` — total failed operations;
- `profiles[]` — per-profile result:
  - `profileId`, `profileName`;
  - `success` — whether all links of the profile were processed without errors;
  - `created` / `failed` — per-profile success / failure;
  - `errors[]` — per-link errors (no URL);
  - `error` — whole-profile error (e.g. CDP port unavailable).

---

## Fingerprint Generator

### POST /api/fingerprint/generate

Generate a random fingerprint for the specified platform. Does not create a profile.

**Request Body:**
```json
{
  "platform": "macos"
}
```

**Required Fields:** `platform` (windows | macos | linux)

**Response (200):**
```json
{
  "platform": "macos",
  "user_agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)...",
  "screen_resolution": "2560x1600",
  "hardware_cores": 10,
  "hardware_memory": 16,
  "color_depth": 24,
  "webgl_renderer": "Apple GPU",
  "fingerprint_seed": "a1b2c3d4-..."
}
```

---

## Settings

### GET /api/settings/automation

Get automation settings (scripts and projects directory paths).

If paths are not configured in the database, default values are used:
- `stAuto0Path`: `~/AI/stAuto0` (on Windows: `C:\Users\<user>\AI\stAuto0`)
- `pythonPath`: `~/AI/stAuto0/venv/Scripts/python.exe` (on Windows)

**Response (200):**
```json
{
  "stAuto0Path": "C:\\Users\\stalcker\\AI\\stAuto0",
  "pythonPath": "C:\\Users\\stalcker\\AI\\stAuto0\\venv\\Scripts\\python.exe",
  "parallelLimit": 2,
  "availableProjects": ["concrete", "allscale", ...]
}
```

---

### PUT /api/settings/automation

Update automation settings. If paths are not provided, default values are used (`~/AI/stAuto0` and `~/AI/stAuto0/venv/Scripts/python.exe`).

**Request Body:**
```json
{
  "stAuto0Path": "/path/to/stAuto0",
  "pythonPath": "/path/to/python",
  "parallelLimit": 3
}
```

**Response (200):**
```json
{
  "status": "success",
  "syncResult": { "added": 2, "removed": 0, "total": 5 }
}
```

---

### GET /api/settings/cloakbrowser-version

Get current CloakBrowser version. Priority: (1) manual setting, (2) auto-detected from cache, (3) default.

**Response (200):**
```json
{
  "manual": "",
  "detected": "146.0.7680.177",
  "current": "146.0.7680.177",
  "default": "146.0.7680.177"
}
```

### PUT /api/settings/cloakbrowser-version

Set CloakBrowser version manually. Send `{"version": ""}` to reset to auto-detection.

**Request body:**
```json
{
  "version": "146.0.7680.177"
}
```

**Response (200):**
```json
{
  "status": "success",
  "version": "146.0.7680.177"
}
```

---

## Projects (Automation Matrix)

### GET /api/projects

List of all projects from database.

**Response (200):**
```json
[
  {
    "name": "concrete",
    "display_name": "concrete",
    "module_path": "projects.concrete",
    "class_name": "",
    "is_active": 1,
    "default_config": "{}",
    "created_at": "2026-07-13 12:00:00",
    "updated_at": "2026-07-13 12:00:00"
  }
]
```

---

### POST /api/projects/sync

Scan `stAuto0/projects/*.py` + `stAuto0/config/projects.py`, add new projects, deactivate removed ones. Config projects take precedence. Ignores `__init__.py`, `base.py`, `loader.py`. If `stAuto0_path` is not configured, default path `~/AI/stAuto0` is used.

**Response (200):**
```json
{
  "added": 2,
  "removed": 0,
  "total": 5
}
```

---

### GET /api/projects/:name

Get a single project with its profiles from the matrix.

**Response (200):**
```json
{
  "name": "concrete",
  "display_name": "Concrete Points",
  "is_active": 1,
  "profiles": [
    { "project_name": "concrete", "profile_id": "uuid", "is_enabled": 1 }
  ]
}
```

**Response (404):** `{ "error": "Project not found" }`

---

### PUT /api/projects/:name

Update project settings (display_name, is_active, default_config, module_path, class_name).

**Request Body:**
```json
{
  "display_name": "Concrete Points",
  "is_active": 1,
  "default_config": "{\"referral_code\": \"ABC\"}"
}
```

**Response (200):** Updated project object

**Response (404):** `{ "error": "Project not found" }`

---

### DELETE /api/projects/:name

Delete a project from the database.

**Response (204):** Successfully deleted
**Response (404):** `{ "error": "Project not found" }`

---

## Matrix

### GET /api/matrix

Full matrix: Projects×Profiles. Projects from database (only `is_active=1`), profiles, and checkbox marks.

**Response (200):**
```json
{
  "projects": [
    {
      "name": "concrete",
      "display_name": "Concrete",
      "is_active": 1,
      "allowed_profile_ids": ["uuid1", "uuid2"]
    }
  ],
  "profiles": [
    { "id": "uuid", "number": 1, "name": "auto_001", "status": "stopped" }
  ],
  "matrix": [
    {
      "project_name": "concrete",
      "profile_id": "uuid",
      "is_enabled": 1,
      "config_override": "{}",
      "profile_name": "auto_001",
      "project_display": "Concrete"
    }
  ]
}
```

### PUT /api/matrix

Batch update matrix checkboxes. Atomic transaction.

**Request Body:**
```json
{
  "entries": [
    { "project_name": "concrete", "profile_id": "uuid", "is_enabled": 1 },
    { "project_name": "allscale", "profile_id": "uuid", "is_enabled": 0 }
  ]
}
```

**Response (200):**
```json
{
  "updated": 2
}
```

---

## Runs

### GET /api/runs

List runs with pagination. Sorted by `created_at DESC`.

**Parameters:** `?page=1&limit=20`

**Response (200):**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Run 2026-07-13 12:00",
      "status": "pending",
      "parallel_limit": 2,
      "total_tasks": 5,
      "completed_tasks": 0,
      "success_tasks": 0,
      "failed_tasks": 0,
      "started_at": null,
      "completed_at": null,
      "created_at": "2026-07-13 12:00:00"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### POST /api/runs

Create a new run from currently enabled matrix entries (`is_enabled=1`).

**Request Body:**
```json
{
  "name": "Daily run 2026-07-13",
  "parallel_limit": 3
}
```

**Response (201):**
```json
{
  "run_id": "uuid",
  "tasks_created": 10,
  "name": "Daily run 2026-07-13"
}
```

**Response (400):** `{ "error": "No enabled entries in matrix" }`

### GET /api/runs/:id

Get run with all run_tasks.

**Response (200):**
```json
{
  "id": "uuid",
  "name": "Daily run",
  "status": "running",
  "parallel_limit": 2,
  "total_tasks": 5,
  "completed_tasks": 2,
  "success_tasks": 2,
  "failed_tasks": 0,
  "tasks": [
    {
      "id": 1,
      "run_id": "uuid",
      "project_name": "concrete",
      "profile_id": "uuid",
      "status": "success",
      "exit_code": 0,
      "log_file_path": "logs/runs/uuid/auto_001.log",
      "attempts": 1,
      "started_at": "2026-07-13 12:00:00",
      "completed_at": "2026-07-13 12:05:00"
    }
  ]
}
```

### POST /api/runs/:id/start

Start run execution. Only for `pending` status.

**Response (200):**
```json
{
  "status": "started",
  "run_id": "uuid"
}
```

### POST /api/runs/:id/cancel

Cancel run execution. For each profile with an already running Python process, the browser is first stopped through the MultiManager lifecycle (`POST /api/browser/:id/stop` — CDP graceful shutdown), then the Python process is forcibly terminated. A repeated stop of one profile (simultaneous cancel and regular `close()` from stAuto0) does not create a second shutdown flow — protected by `stoppingProfiles`. Marks all running/pending tasks as `failed` and sets the run status to `cancelled`.

**Response (200):**
```json
{
  "status": "cancelled",
  "run_id": "uuid"
}
```

---

## Internal API (stAuto0 Callback)

### POST /api/internal/runs/:id/task-status

Callback endpoint for stAuto0. Updates status of one matrix cell. Localhost only.

**Request Body:**
```json
{
  "project_name": "concrete",
  "profile_name": "auto_001",
  "status": "success",
  "attempts": 2
}
```

**Response (200):**
```json
{
  "ok": true
}
```

---

## Profile Statuses

| Status | Description |
|--------|-------------|
| `stopped` | Profile is stopped |
| `starting` | Profile is starting |
| `running` | Profile is running |

---

## Error Codes

| Code | Description |
|------|-------------|
| 200 | Success |
| 201 | Resource created |
| 204 | Deleted successfully |
| 400 | Bad request |
| 401 | Unauthorized |
| 404 | Resource not found |
| 409 | Conflict (running profile, etc.) |
| 412 | Proxy unavailable |
| 500 | Internal server error |
| 502 | Proxy/rotation error / CDP port not found |
| 503 | Auth token not initialized |
