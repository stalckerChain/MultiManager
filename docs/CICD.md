# CI/CD - Process Build and Release

## Current Process (Manual)

Project does not use automated CI/CD. Build and publishing are done manually.

### Release Checklist

1. Update version in package.json, gui/package.json, CHANGELOG.md, README.md
2. Run tests: npm test, npm run lint, npm run typecheck
3. Build GUI without publishing: cd gui && npm run build -- --publish never
4. Verify: launch installer, check Core, profiles, browser, WebSocket
5. Publish artifacts manually: cd gui && npm run build -- --publish always
6. Create GitHub Release with tag vX.Y.Z

## Updates (Manual Only)

MultiManager has no runtime auto-updater: the app does not check update servers,
download, or install updates at startup or on quit. Updating is always performed
manually by the user by installing a new build.

- `gui/src/main/updater.js` no longer exists.
- The `electron-updater` dependency was removed from `gui/package.json` and `gui/package-lock.json`.
- Production builds are made with `--publish never`; publishing release artifacts
  is a manual step and is not treated as runtime auto-update.
- CloakBrowser has its own separate install/update mechanism (`npx cloakbrowser update`).
