# Production Deployment Guide

This is the reference procedure for the web application, its API, database, and
operations. Destructive actions are marked and must be approved.

## 1. Architecture in production

```
client (browser / PWA / EXE / APK)
   │  HTTPS (nginx, TLS 1.2/1.3)
   ▼
Nginx (reverse proxy, security headers, body limits)
   │  http://127.0.0.1:3000
   ▼
Next.js (PM2-managed, production build)
   │
   ├─► PostgreSQL (DATABASE_URL via env)
   ├─► Uploads: /opt/installment-sales/uploads (never web-served)
   └─► SMS gateway (SMS_API_URL / SMS_API_KEY, env only)
```

- **Process management:** PM2 (`deploy/ecosystem.config.cjs`) — single fork
  (journal safety is in PostgreSQL, not process memory), graceful reload on
  deploy, `kill_timeout`, `max_memory_restart`, log files under
  `/var/log/installment-sales`.
- **HTTPS:** nginx `deploy/nginx.conf` (HTTP→HTTPS redirect, security headers).
- **Security:** uploads are streamed through authorised API routes; the
  `uploads/` directory is never statically served (`/uploads/` returns 404 in
  nginx), and the app enforces MIME + magic-byte checks and ≤5 MB files.
- **Logging:** Next.js JSON logs + Pino via the sibling API; PM2 log files;
  daily rotation by `logrotate` (add a rule for `/var/log/installment-sales`).

## 2. Production environment variables

Populate `.env` on the server (never commit it):

| Variable | Required | Purpose |
|---|---|---|
| `DATABASE_URL` | yes | PostgreSQL connection string |
| `JWT_ACCESS_SECRET` | yes | ≥32 random chars — **production fails closed without it** |
| `ACCESS_TOKEN_TTL_SECONDS` | no (900) | access-token lifetime |
| `REFRESH_TOKEN_TTL_DAYS` | no (7) | refresh-token lifetime |
| `SMS_API_URL` | optional | SMS provider endpoint (validated) |
| `SMS_API_KEY` | optional | SMS credential (never logged) |
| `CORS_ORIGIN` | no | API-origin allowlist when the API domain differs |
| `SMS_ALLOW_PRIVATE_HOSTS` | **no** | Never set in production (test-only SSRF bypass) |
| `NODE_ENV=production` | yes | enables secure cookies and production auth |

## 3. Database migrations

Use the versioned migrations only — never `drizzle-kit push` against production.

```bash
bash deploy/migrate.sh
```

The script checks connectivity, takes a pre-migration `pg_dump` backup, applies
`apps/api/prisma/migrations` with `prisma migrate deploy`, restarts the app, and
runs a health check. On failure it prints the exact restore command.

## 4. Backup and recovery

- **Nightly scheduled backup:** install `deploy/postgres-backup.cron.sh` under
  root cron (`0 3 * * *`). Produces a compressed `pg_dump` with a 14-day rotation
  at `/var/backups/installment-sales`.
- **In-app backup (ADMIN):** `تنظیمات → پشتیبان‌گیری` streams a JSON export to
  the requester, records it in `backup_history`, and excludes `refresh_tokens`.
  Password hashes are included — store the download securely.
- **Restore:** `bash deploy/restore.sh <file.dump>` verifies integrity, then
  requires typing `RESTORE` before replacing data. Only a `pg_dump` file is a
  full restore; the JSON export is an audit snapshot, not a restorer.

## 5. Health checks

- `GET /api/health` → `{ ok, db:true }` — wired into nginx/PM2 and the deploy
  smoke test.
- App restarts on unhealthy health-checks via PM2 + nginx probing.

## 6. Updating

Releases are **tags** (`v1.2.3`). Deploys run `.github/workflows/deploy-web.yml`,
which requires the `test` workflow to have passed and the **production**
GitHub Environment to approve, thus an authorised reviewer always signs off.

## 7. Reverse proxy notes

The deployed host expects nginx with the config above. If you front it with a
CDN, disable HTML caching for `/_next/data` and pass `X-Forwarded-*` headers so
session and rate-limit logic stay accurate.
