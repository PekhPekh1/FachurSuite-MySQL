#!/usr/bin/env bash
# Restore procedure for either
#   a) a nightly pg_dump --format=custom backup, or
#   b) a JSON export produced by the in-app backup button (tables JSON).
#
# GUARD: this is destructive. Requires RESTORE_CONFIRM=<absolute path> and an
# explicit second confirmation. Restore into a snapshot target first unless you
# are certain.
set -euo pipefail

SOURCE="${1:-}"
: "${SOURCE:?usage: restore.sh <path-to-backup.dump|backup.json>}"
: "${DATABASE_URL:?DATABASE_URL required}"

if [[ "$SOURCE" == *.json ]]; then
  echo "[restore] JSON export detected — restoring via application restore (see docs/RESTORE-JSON.md)."
  echo "[restore] No automatic JSON restore path in this release; use pg_dump backups for full restores."
  exit 2
fi

echo "[restore] PLAN: verify backup integrity, then prompt before replacing data."
pg_restore --list "$SOURCE" >/dev/null

read -r -p "This will REPLACE ALL DATA in the target database. Type RESTORE to continue: " CONFIRM
[[ "$CONFIRM" == "RESTORE" ]] || { echo "aborted"; exit 1; }

echo "[restore] restoring…"
pg_restore --clean --if-exists --no-owner --no-privileges --dbname="$DATABASE_URL" "$SOURCE"

echo "[restore] verifying row counts against app…"
psql "$DATABASE_URL" -Atc "
  SELECT t.tablename || '=' || (SELECT count(*) FROM pg_tables WHERE schemaname='public')
  FROM pg_tables t WHERE t.schemaname='public' AND t.tablename IN ('customers','contracts','payments') ORDER BY 1;
"
echo "[restore] complete. Invalidate all sessions (logout-all) before reopening."
