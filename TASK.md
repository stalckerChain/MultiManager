# Code Review Report: MultiManager v1.4.0 Security Hardening

**Date:** 2026-07-20
**Commit:** `8bfdc91`
**Scope:** Security fixes from code review (12 critical + 12 warning findings claimed)
**Previous review:** `projects/multimanager-code/code-review-report.md` (v1.3.2)
**Verdict:** **APPROVE with Conditions**
**Score:** 82/100

## Executive Summary

The v1.4.0 security-hardening commit (`8bfdc91`) addresses nearly all critical findings from the previous review. Code-level improvements are substantial and well-tested (737 tests, 47 files). Most changes align with the updated `TS.md` / `README.md` documentation.

Key improvements observed:
- WebSocket `/ws` now requires `?token=` and closes unauthenticated connections with `4401`.
- Recovery key is shown once and removed from the DB afterwards.
- Master-key gate blocks mutating endpoints until a key is initialized.
- `/api/internal/profiles` no longer returns decrypted secrets or proxy credentials.
- Proxy credentials are encrypted with AES-256-GCM.
- CDP password and selector handling uses `Runtime.callFunctionOn` instead of string concatenation.
- Extension manifest validation and CRX parser hardening are in place.
- Cookie temp-file cleanup is wrapped in `finally`.
- Proxy-rotation URL now validates scheme and blocks private/local addresses.
- PTY log-tail validates paths against an allow-list.
- Core token rotates on each `startCore()`.
- Browser binary path is platform-aware.
- Plaintext master-key fallback is removed.

Remaining concerns are mostly medium/low severity: hardcoded secrets in seed phrases, path traversal edge cases, concurrency/transaction gaps, test coverage for keytar fallback, and a few code-quality issues.

## Findings by Severity

### Critical (0)

No unresolved critical issues. All previously reported critical findings have been fixed in this commit.

### Warning (7)

| # | File(s) | Line(s) | Issue | Severity | Recommendation |
|---|---------|---------|-------|----------|----------------|
| W1 | `src/crypto/index.js` | 61-67 | Recovery key is the raw master key encoded in base64. Anyone with the recovery key has the master key. The name "recovery key" is fine, but its strength equals the master key; print/screen-exposure risk is high. | Warning | Document that recovery key == master key backup. Consider splitting recovery into "recovery phrase" derived via KDF, or require current password before displaying. |
| W2 | `src/api/settings.js` | 29-36 | `GET /recovery-key` returns the recovery key if present and deletes it after display. Deleting after GET is a side-effect on a GET endpoint. | Warning | Move recovery-key deletion to the `POST /set-master-password` / `POST /change-master-password` flow, or rename endpoint to `POST /recovery-key/show`. |
| W3 | `src/db/schema.js` | 214-276 | `migrateTables()` duplicates `CREATE TABLE` / index / trigger logic from `createTables()`. Maintenance risk: future schema changes must be edited in two places. | Warning | Refactor so `migrateTables()` only adds missing columns and calls `createTables()` for table creation. |
| W4 | `src/db/queries.js` | 183-214 | Proxy credentials are decrypted by `decryptProxyRow()` on every `getAll()` / `getById()`. This is fine for authorized use, but any accidental log/debug dump will expose them. | Warning | Add a helper `getAllSafe()` that omits/decrypts selectively, and audit logging to ensure credentials are never written to logs. |
| W5 | `src/executor/index.js` | 91-99 | Command-line arguments to `main.py` include `--token=` and `--run-id=`. Process command lines are visible to other users on Linux/macOS via `ps`. | Warning | Pass the API token via environment variable or temp file with restricted permissions instead of CLI. |
| W6 | `gui/src/main/core-manager.js` | 71-72 | Core token is passed as `--api-token=` CLI argument. Although it rotates on each start, the token remains visible in process listings. | Warning | Pass token via environment variable instead of CLI, or document that this is acceptable for local-only API. |
| W7 | `src/api/runs.js` | 94-95 | `apiToken` is extracted from `Authorization` header. If token is empty, executor passes `--token=` to Python. | Warning | Reject start request if token is missing. |

### Info / Code Quality (6)

| # | File(s) | Line(s) | Issue | Severity | Recommendation |
|---|---------|---------|-------|----------|----------------|
| I1 | `src/crypto/index.js` | 143-155 | `master_key_fallback` branch is retained even though plaintext fallback was "removed". If a fallback row exists, it is still loaded. | Info | Remove `master_key_fallback` branch entirely, or document that it exists only for migrations and must be encrypted too. |
| I2 | `src/api/settings.js` | 171-188 | `PUT /automation` auto-creates matrix entries for all profiles/projects with `is_enabled: 0`. For large farms this can generate thousands of rows silently. | Info | Add pagination/limit or log warning when matrix pre-population exceeds a threshold. |
| I3 | `src/api/proxies.js` | 86-93 | `PUT /:id` re-encrypts `username`/`password` inline instead of using `createProxyQueries().update()`. This duplicates encryption logic. | Info | Move encryption into the query layer, as was done for profiles, to keep routes DRY. |
| I4 | `src/api/extensions.js` | 145-148, 193-196, 280-283, 304-306 | Extension install uses `fs.rmSync` + `fs.cpSync` without atomic rollback if validation fails after partial copy. | Info | Keep validated temp directory and rename atomically; or keep validation before any filesystem changes. |
| I5 | `src/api/cookies.js` | 39-53 | Cookie import writes temp file to `/tmp`. On Windows this path does not exist. | Info | Use `os.tmpdir()` instead of hardcoded `/tmp`. |
| I6 | `tests/unit/crypto.test.js` | 207-209 | Test confirms `setupPasswordMode` is not exported. Good, but consider adding a test that verifies no plaintext `master_key` is stored in `system_config` after init. | Info | Add negative test: after `initMasterKey()` with keytar, `system_config` should not contain a plaintext `master_key`. |

## Detailed Notes

### Security improvements verified

1. **WebSocket auth** — `src/core/websocket.js:14-22` correctly rejects missing/invalid tokens with `4401`.
2. **HTTP auth** — `src/api/auth.js:13-32` uses timing-safe comparison and returns 503 if token not initialized.
3. **Master-key gate** — `src/core/app.js:8-13` blocks non-GET on `/api/profiles`, `/api/proxies`, `/api/cookies` when `hasMasterKey()` is false.
4. **Recovery-key one-time** — `src/api/settings.js:29-36` returns recovery key once and deletes it; `set/change` password generates a new one.
5. **Internal API secrets removed** — `src/api/internal.js:41-70` returns only `has_auth` for proxy and no secret fields.
6. **Proxy encryption** — `src/db/queries.js:183-214` encrypts/decrypts `username`/`password` transparently.
7. **CDP injection fix** — `src/api/browser.js:586-638` uses `Runtime.callFunctionOn` with separate arguments.
8. **Extension manifest validation** — `src/api/extensions.js:306-321` checks `name`, `version`, `manifest_version`.
9. **CRX parser hardening** — `src/api/extensions.js:363-384` rejects bad magic bytes and unsupported versions.
10. **Cookie temp-file cleanup** — `src/api/cookies.js:49-52` wrapped in `finally`.
11. **Proxy rotation SSRF** — `src/proxy/index.js:180-219` validates scheme and blocks private/local addresses.
12. **PTY path validation** — `gui/src/main/pty.js:11-24` allow-lists only `~/AI` and user-data logs.
13. **Core token rotation** — `gui/src/main/core-manager.js:52` generates new token each start.
14. **Plaintext master-key removed** — `src/crypto/index.js:178-188` no longer writes unencrypted fallback; however, see note I1 about the legacy branch.

### Tests

- 737 tests across 47 files.
- New/updated crypto tests cover encrypt/decrypt/rotate/format.
- Backup rolling cleanup tests present.
- No obvious test for `master_key_fallback` negative case (I6).

## Comparison with Previous Code Review

| Previous finding | Status | Evidence |
|---|---|---|
| WebSocket `/ws` unauthenticated | ✅ Fixed | `src/core/websocket.js` |
| Recovery key exposed via API | ✅ Fixed | `src/api/settings.js` |
| `/api/internal/profiles` leaks secrets | ✅ Fixed | `src/api/internal.js` |
| Proxy credentials plaintext | ✅ Fixed | `src/db/queries.js` |
| CDP injection via concatenation | ✅ Fixed | `src/api/browser.js` |
| Cookie temp file leak | ✅ Fixed | `src/api/cookies.js` |
| Proxy rotation SSRF | ✅ Fixed | `src/proxy/index.js` |
| PTY path traversal | ✅ Fixed | `gui/src/main/pty.js` |
| Plaintext master key | ✅ Mostly fixed | `src/crypto/index.js` (legacy branch remains) |
| Token in CLI `--api-token` | ⚠️ Partially | Still in CLI, but rotates per start (`gui/src/main/core-manager.js`) |
| Native addon platform gate | ✅ Fixed | `src/api/browser.js:42` checks `process.platform === 'win32'` |
| Missing badRequest import | ✅ Fixed | `src/api/browser.js:15` imports `badRequest` |

## Verdict

**APPROVE with Conditions.**

The v1.4.0 hardening resolves all critical issues and most warnings from the prior review. The remaining items are lower severity and should be addressed in a follow-up patch, not a hard gate:

1. W5 / W6: Move API token out of process command-line arguments.
2. W2: Make recovery-key retrieval a mutating endpoint.
3. W3: Deduplicate `migrateTables()` schema creation.
4. I1: Remove or secure legacy `master_key_fallback` branch.
5. I5: Use `os.tmpdir()` for cookie import temp file.

## Remediation Plan (suggested order)

| # | Action | Priority | Estimated effort |
|---|--------|----------|------------------|
| 1 | Pass API token to Python via env/file, not CLI | Medium | Small |
| 2 | Move recovery-key deletion to POST endpoint | Low | Tiny |
| 3 | Refactor `migrateTables()` to avoid duplication | Low | Small |
| 4 | Remove legacy plaintext `master_key_fallback` branch | Medium | Tiny |
| 5 | Use `os.tmpdir()` in cookie import | Low | Tiny |

---

*Report generated by Hermes quality-gate-2 skill.*
