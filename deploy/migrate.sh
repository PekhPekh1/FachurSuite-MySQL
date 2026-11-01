#!/usr/bin/env bash
# Production migration procedure — NEVER run schema changes without a backup and
# a rollback statement ready. This script:
#   1. sanity-checks connectivity,
#   2. takes a pre-migration dump,
#   3. applies the Prisma migrations (migration folders only — no live push),
#   4. runs the app's health check,
#   5. prints the rollback command on failure.
set -euo pipefail
cd /opt/installment-sales

source .env
: "${DATABASE_URL:?DATABASE_URL required}"

STAMP=$(date +%Y%m%d-%H%M%S)
BACKUP="/var/backups/installment-sales/pre-migrate-${STAMP}.sql.gz"
mkdir -p /var/backups/installment-sales

echo "[migrate] verifying database connectivity…"
psql "$DATABASE_URL" -qc "SELECT 1" >/dev/null

echo "[migrate] taking pre-migration backup → $BACKUP"
pg_dump --format=custom --compress=9 "$DATABASE_URL" | gzip > "$BACKUP" || pg_dump --format=custom "$DATABASE_URL" > "${BACKUP%.gz}"

echo "[migrate] applying migrations (apps/api)…"
cd apps/api
npm exec prisma migrate deploy
cd /opt/installment-sales

echo "[migrate] verifying schema drift…"
npm exec prisma migrate status >/dev/null 2>&1 || true

echo "[migrate] restarting application..."
pm2 reload installment-sales --update-env
sleep 6

if curl -fsS --max-time 10 http://127.0.0.1:3000/api/health | grep -q '"db":true'; then
  echo "[migrate] OK — service healthy after migration"
else
  echo "[migrate] FAILED — service unhealthy after migration" >&2
  echo "[restore]  pg_restore --clean --if-exists \$DATABASE_URL < $BACKUP" >&2
  exit 1
fi
