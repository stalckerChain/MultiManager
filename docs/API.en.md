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
  "notes": "Note"
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
  "notes": "New note"
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
  "ws_endpoint": "ws://127.0.0.1:3000/devtools/browser/f81d4fae-..."
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
| 502 | Proxy/rotation error |
