# GitHub Secrets Checklist

Configure these repository secrets before enabling the workflows. None of them
are hardcoded anywhere, and none are printed to logs.

## Web deployment (`deploy-web.yml`)
| Secret | Example | Purpose |
|---|---|---|
| `DEPLOY_HOST` | `sales.mystore.com` | Production hostname (used by SSH target and smoke test) |
| `DEPLOY_USER` | `deploy` | SSH user (restricted, key-only auth) |
| `DEPLOY_SSH_KEY` | -----BEGIN OPENSSH PRIVATE KEY----- | SSH private key for the deploy user |
| `DEPLOY_PORT` | `22` | SSH port |

## Windows installer (`build-exe.yml`)
| Secret | Purpose |
|---|---|
| `DEPLOY_HOST` | the backend URL the desktop client embeds |
| `WINDOWS_CSC_LINK` | base64 of `.p12` Authenticode certificate (optional — signed builds) |
| `WINDOWS_CSC_KEY_PASSWORD` | password for the certificate |

## Android APK (`build-apk.yml`)
| Secret | Purpose |
|---|---|
| `DEPLOY_HOST` | backend HTTPS host the APK connects to |
| `ANDROID_SIGNING_KEYSTORE_BASE64` | base64 of the release `.jks` keystore |
| `ANDROID_KEYSTORE_PASSWORD` | keystore password |
| `ANDROID_KEY_PASSWORD` | key password |
| `ANDROID_KEY_ALIAS` | key alias |

## Environment
Create a GitHub Environment named **production** with required reviewers, so
every production deploy needs manual approval. This is the safeguard that
prevents automatic production migrations from running without a backup plan and
human sign-off.

## Rules
- Secrets are encrypted masks; only jobs that need them reference them.
- Never echo secrets in scripts — `build-apk.yml` writes the keystore to file and
  never `cat`s it.
- `.env` on the server is not committed; `DATABASE_URL`, `JWT_ACCESS_SECRET`, and
  `SMS_API_KEY` live only there.
