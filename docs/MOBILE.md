# Mobile Application (Android APK)

## Why this APK loads a server URL

This Next.js application uses App Router server components, server actions, and
dynamic routes — it is not a static site and **cannot be exported to static
HTML**. Capacitor therefore does not bundle the app as `www/` HTML; the APK
loads the deployed backend live over HTTPS.

`apps/mobile/capacitor.config.ts`:
- `appId: ir.store.installmentsales`
- `server.url`: production backend URL (from `CAP_SERVER_URL`)
- `cleartext: false` — only HTTPS traffic is permitted
- `androidScheme: https`

Authentication uses the browser-compatible cookie session; Capacitor's webview
stores cookies exactly like a browser, so no app-specific token handling code is
needed and the same auth rules (access JWT + refresh rotation) apply end-to-end.

## Building the signed APK

On CI (`.github/workflows/build-apk.yml`, ubuntu-latest):

```
apps/mobile/npm ci
npx cap add android && npx cap sync    # generates the Android project
# keystore is written from protected secrets
apps/mobile/android/gradlew assembleRelease
```

The signed `app-release.apk` is uploaded as a workflow artifact per release tag
(`v*`) or manual run.

## Signing

Signing material is never in the repo. Add these repository secrets:

| Secret | Purpose |
|---|---|
| `ANDROID_SIGNING_KEYSTORE_BASE64` | base64 of the release keystore (.jks) |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_PASSWORD` | key password |
| `ANDROID_KEY_ALIAS` | key alias |

## Local development / debug APK

```
cd apps/mobile
npm install
CAP_SERVER_URL=http://10.0.2.2:3000 npx cap sync android  # 10.0.2.2 = emulator localhost
cd android && ./gradlew assembleDebug
```

`10.0.2.2` is the Android-emulator mapping to the host's localhost. Debug builds
are unsigned; release builds require the production keystore.

## Known limitations

- Offline mode is out of scope (business requirement). The APK requires network
  access to the backend.
- iOS is not in scope for this release.
- Push notifications are not implemented; reminders arrive on the next app open.
