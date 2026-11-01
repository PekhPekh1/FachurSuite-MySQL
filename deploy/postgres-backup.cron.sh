#!/usr/bin/env bash
# Nightly logical backup of PostgreSQL with 14-day rotation.
# Install (root cron):
#   0 3 * * * /opt/installment-sales/deploy/postgres-backup.cron.sh
set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/installment-sales}"
SOURCE_DATABASE_URL="${DATABASE_URL:?DATABASE_URL required}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$BACKUP_DIR/app_db-${STAMP}.dump"

pg_dump --format=custom --compress=9 "$SOURCE_DATABASE_URL" -f "$OUT"
echo "[backup] wrote $OUT ($(du -h "$OUT" | cut -f1))"

# Rotate: delete backups older than RETENTION_DAYS.
find "$BACKUP_DIR" -name "app_db-*.dump" -mtime "+$RETENTION_DAYS" -delete
echo "[backup] rotation complete (kept ${RETENTION_DAYS} days)"
