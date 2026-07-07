# API Reference

REST API for anti-detect browser management. All requests require an authorization header.

## Authentication

```http
Authorization: Bearer <token>
```

Token is generated on first launch or passed via `--api-token=SECRET`.

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

## Profiles

### POST /api/profiles

Create a new profile. Fingerprint is auto-generated.

**Request Body:**
```json
{
  "name": "My Profile",
  "platform": "windows",
  "proxy_id": 1,
  "extensions": ["ext1", "ext2"],
  "tags": ["tag1"],
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

**Response (201):** Created proxy

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
  "proxies": [...]
}
```

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

Start browser. Automatically checks proxy if assigned.

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

Stop browser. Force-kills after 5 seconds if not terminated.

**Response (200):**
```json
{
  "status": "stopped"
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

## Multi-Control (Window Sync) — v0.13.0

Broadcasts actions from master window to all slave windows via CDP (Chrome DevTools Protocol).

**Architecture:**
- **DOM input capture**: CDP binding `Runtime.addBinding('__MM_SYNC_BIND__')` injected into master page via `SYNC_EVENT_SCRIPT`. DOM events (mousemove, mousedown, mouseup, wheel, keydown, keyup) + `visibilitychange` → `window.__MM_SYNC_BIND__(JSON)` → `cdpManager.onEvent` → `inputCapture.injectFromCdp()` → `controller`
- **Native hooks (OS-level)**: C++ addon `WH_KEYBOARD_LL` intercepts ALL keys at OS level, including browser shortcuts (Ctrl+T, Ctrl+W). HTTP POST → `/api/multi-control/os-keyboard`
- **Mouse smoothing**: MouseSmoother (ghost-cursor `path()`: cubic Bézier + Fitts's Law + overshoot) + `setTimeout` dispatch loop + `flush()` before click
- **Scroll**: Split into series of `wheel` dispatches (SCROLL_STEP_PX=40, SCROLL_TICK_MS=16)
- **Multi-tab**: HTTP `/json` polling every 300ms to detect natively opened tabs. Tab mapping 1:N via `Map<masterTargetId, Map<slaveId, slaveTargetId>>` + `tabIndex` matrix
- **Focus activation**: Chain `Target.activateTarget` → `Page.bringToFront` → `DOM.focus` → `body.focus()` for DOM input focus in slaves
- **Double dispatch**: When typing in DOM elements, keys are sent to slaves twice (CDP + native hook)

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

Get profiles by number range. Returns decrypted secrets.

**Parameters:** `range` — number range in `NNN-NNN` format

**Response (200):** Array of profiles with decrypted secrets

**Response (400):** `{ "error": "Invalid range format: 001-010" }`

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

## Tasks

### GET /api/tasks

Get list of all tasks.

**Response (200):** Array of tasks

---

### POST /api/tasks

Create a task.

**Request Body:**
```json
{
  "name": "My Task",
  "script_name": "script.sh",
  "schedule_type": "interval",
  "params": "{}",
  "is_active": 1
}
```

**Required Fields:** `name`, `script_name`, `schedule_type`

**Response (201):** Created task

---

### GET /api/tasks/:id

Get task by ID.

**Response (200):** Task
**Response (404):** `{ "error": "Task not found" }`

---

### PUT /api/tasks/:id

Update task.

**Response (200):** Updated task

---

### DELETE /api/tasks/:id

Delete task.

**Response (204):** Deleted successfully

---

### GET /api/tasks/:id/executions

Get task execution history.

**Response (200):** Array of executions

---

### POST /api/tasks/:id/run

Run task manually.

**Response (200):**
```json
{
  "status": "running",
  "execution_id": 1
}
```

**Response (404):** `{ "error": "Task not found" }`

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

### GET /api/settings/crypto-status

Get crypto module status (AES-256-GCM encryption for profile secret fields).

**Response (200):**
```json
{
  "initialized": true,
  "hasMasterKey": true,
  "keySource": "keytar",
  "passwordMode": false,
  "encryptedFields": ["email_password", "twitter_password", "twitter_auth_token", "discord_password", "discord_token", "wallet_password"]
}
```

---

### POST /api/settings/set-master-password

Set master password (enables passwordMode). Minimum 8 characters.

**Request Body:**
```json
{
  "password": "my_strong_password"
}
```

**Response (200):**
```json
{
  "status": "success",
  "passwordMode": true
}
```

**Response (400):** `{ "error": "Password must be at least 8 characters" }`

---

### POST /api/settings/change-master-password

Change master password.

**Request Body:**
```json
{
  "old_password": "old_password",
  "new_password": "new_password"
}
```

**Response (200):**
```json
{
  "status": "success"
}
```

**Response (400):** `{ "error": "Invalid old password" }`

---

### GET /api/settings/recovery-key

Get recovery key (requires master password).

**Response (200):**
```json
{
  "recoveryKey": "recovery-key-here"
}
```

**Response (400):** `{ "error": "Crypto module not initialized" }`

---

### GET /api/settings/automation

Get automation settings (scripts and projects directory paths).

**Response (200):**
```json
{
  "scripts_dir": "",
  "projects_dir": ""
}
```

---

### PUT /api/settings/automation

Update automation settings.

**Request Body:**
```json
{
  "scripts_dir": "/path/to/scripts",
  "projects_dir": "/path/to/projects"
}
```

**Response (200):** Updated settings

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
