# CI/CD - Process Build and Release

## Current Process (Manual)

Project does not use automated CI/CD. Build and publishing are done manually.

### Release Checklist

1. Update version in package.json, gui/package.json, CHANGELOG.md, README.md
2. Run tests: npm test, npm run lint, npm run typecheck
3. Build GUI: cd gui && npm run build
4. Verify: launch installer, check Core, profiles, browser, WebSocket
5. Publish: cd gui && npm run build -- --publish always
6. Create GitHub Release with tag vX.Y.Z

---

## Auto-Updater

electron-updater (v6.3.9) checks latest.yml on GitHub Releases at startup.
If new version available, downloads and prompts restart.

### Configuration

- gui/src/main/updater.js - check and download logic
- electron-builder generates latest.yml with --publish always
- Publishing goes to GitHub Releases tag vX.Y.Z
