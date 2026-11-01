# Desktop Application (Windows EXE)

## Architecture

The Windows EXE is an **Electron desktop client** that loads the deployed
production backend over HTTPS. It is not a fully local application and does not
bundle PostgreSQL or the Next.js server. This is a deliberate, supported
deployment architecture:

- Simple install, no local database to maintain or back up.
- Business rules, auth, and financial integrity all stay on the server.
- One version of truth for every store operator and the customer portal.

A **fully local deployment** is also supported (single machine or LAN): deploy
the Node + PostgreSQL stack on a workstation and point the client at
`http://127.0.0.1:3000` or the LAN hostname. See DEPLOYMENT.md. The client then
works without internet but still enforces the same server-side security, because
requests still go through the app server rather than direct-to-database.

Never point the client at an arbitrary remote URL — the backend is derived at
build time and validated by the server-side security stack.

## Building the installer

CI (GitHub Actions, `build-exe.yml`, windows-latest) runs:

```
apps/desktop/npm ci
node --check main.cjs && node --check preload.cjs
apps/desktop/npm run build:exe    # electron-builder --win --publish never
```

The `apps/desktop/dist-installer/*.exe` artifact is uploaded per release tag or
manual dispatch.

## electron-builder configuration (`apps/desktop/electron-builder.yml`)

- `appId: ir.store.installmentsales`, Persian product name.
- Icon from `apps/desktop/assets/icon.png`.
- **NSIS installer**: per-user (no admin required), user-chosen directory,
  desktop and Start-Menu shortcuts (`فروش اقساطی`).
- **System tray**: `apps/desktop/main.cjs` creates a tray icon with باز کردن /
  خروج, single-instance lock, graceful window restore.
- **Signing:** when `WINDOWS_CSC_LINK` + `WINDOWS_CSC_KEY_PASSWORD` are present
  the installer is Authenticode-signed; otherwise the build is unsigned (internal
  testing only).
- **No auto-updater:** `publish: never`. Version updates are signed installers
  from the release workflow. This is a deliberate choice — an unsigned updater
  channel would be an insecure supply chain.

## Local development

```
cd apps/desktop
npm install
DESKTOP_BACKEND_URL=http://127.0.0.1:3000 npm start
```
