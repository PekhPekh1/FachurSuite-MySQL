#!/usr/bin/env bash
# Server-side deploy script executed by .github/workflows/deploy-web.yml over SSH.
# Steps: pull → install → build → verify migrations → reload. Aborts before any
# destructive change unless the schema is clean.
set -euo pipefail

cd /opt/installment-sales
source .env
: "${DATABASE_URL:?DATABASE_URL required}"

echo "[deploy] pulling release"
git fetch origin main
git reset --hard origin/main

echo "[deploy] installing dependencies"
npm ci --omit=dev

echo "[deploy] building"
npm run build

echo "[deploy] applying pending migrations (with pre-migration backup)"
bash deploy/migrate.sh

echo "[deploy] final health check"
curl -fsS --max-time 10 http://127.0.0.1:3000/api/health | grep '"db":true'

echo "[deploy] done"
