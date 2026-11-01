#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
cd "$ROOT"
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
: "${DATABASE_URL:?DATABASE_URL is required}"
export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-test-secret-at-least-32-characters-long}"
export API_PORT=4101 NODE_ENV=development
BASE="http://127.0.0.1:${API_PORT}/api/v1"
LOG=/tmp/installments-auth-integration.log
TMP=$(mktemp -d)
API_PID=""

cleanup() {
  # Always restore the fictional operator account used by negative tests.
  psql "$DATABASE_URL" -q -c "UPDATE users SET is_active=true WHERE username='operator';" >/dev/null 2>&1 || true
  if [[ -n "$API_PID" ]]; then kill "$API_PID" >/dev/null 2>&1 || true; wait "$API_PID" >/dev/null 2>&1 || true; fi
  rm -rf "$TMP"
}
trap cleanup EXIT

pass=0
assert_status() {
  local expected=$1 actual=$2 label=$3
  if [[ "$actual" != "$expected" ]]; then
    echo "FAIL $label: expected $expected got $actual" >&2
    cat "$TMP/body" >&2 || true
    exit 1
  fi
  pass=$((pass+1)); echo "PASS $label"
}
post_json() {
  local url=$1 data=$2 jar=${3:-}
  local args=(-sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -H "Content-Type: application/json" -d "$data")
  [[ -n "$jar" ]] && args+=(-b "$jar" -c "$jar")
  curl "${args[@]}" "$url"
}
login() {
  local username=$1 password=$2 jar=$3
  post_json "$BASE/auth/login" "{\"username\":\"$username\",\"password\":\"$password\"}" "$jar"
}
cookie_value() { awk -v name="$2" '$6 == name { value=$7 } END { print value }' "$1"; }

node apps/api/dist/server.js >"$LOG" 2>&1 & API_PID=$!
for _ in $(seq 1 30); do curl -fsS --max-time 1 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep .2; done

# 1. Successful login + authenticated-user endpoint; body must contain no token.
ADMIN="$TMP/admin.jar"; : >"$ADMIN"
code=$(login admin admin123456 "$ADMIN"); assert_status 200 "$code" "successful login"
! grep -qi 'accessToken\|refreshToken' "$TMP/body" || { echo "FAIL token exposed in login body"; exit 1; }
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$ADMIN" "$BASE/auth/me")
assert_status 200 "$code" "authenticated user endpoint"
grep -q '"role":"ADMIN"' "$TMP/body"
! grep -q 'sessionVersion' "$TMP/body" || { echo "FAIL internal session version exposed"; exit 1; }

# 2. Incorrect password.
BAD="$TMP/bad.jar"; : >"$BAD"
code=$(login admin definitely-wrong "$BAD"); assert_status 401 "$code" "incorrect password rejected"

# 3. Expired JWT access token.
ADMIN_ID=$(psql "$DATABASE_URL" -Atc "SELECT id FROM users WHERE username='admin'")
ADMIN_SV=$(psql "$DATABASE_URL" -Atc "SELECT session_version FROM users WHERE username='admin'")
EXPIRED=$(node - <<NODE
require('dotenv').config({path:'.env',quiet:true});
const {signAccessToken}=require('./apps/api/dist/security/jwt');
process.stdout.write(signAccessToken({id:'$ADMIN_ID',role:'ADMIN',customerId:null,sessionVersion:Number('$ADMIN_SV')}, Date.now()-3600_000));
NODE
)
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -H "Cookie: access_token=$EXPIRED" "$BASE/auth/me")
assert_status 401 "$code" "expired access token rejected"

# 4. Refresh rotation: cookie changes, old row revoked; reuse revokes token family.
C1="$TMP/customer1.jar"; : >"$C1"
code=$(login customer1 customer123 "$C1"); assert_status 200 "$code" "customer login"
OLD_REFRESH=$(cookie_value "$C1" refresh_token)
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$C1" -c "$C1" -X POST "$BASE/auth/refresh")
assert_status 200 "$code" "refresh token rotation"
NEW_REFRESH=$(cookie_value "$C1" refresh_token)
[[ -n "$OLD_REFRESH" && -n "$NEW_REFRESH" && "$OLD_REFRESH" != "$NEW_REFRESH" ]] || { echo "FAIL refresh cookie did not rotate"; exit 1; }
OLD_HASH=$(printf %s "$OLD_REFRESH" | sha256sum | cut -d' ' -f1)
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM refresh_tokens WHERE token_hash='$OLD_HASH' AND revoked_at IS NOT NULL") == "1" ]] || { echo "FAIL old refresh row not revoked"; exit 1; }
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -H "Cookie: refresh_token=$OLD_REFRESH" -X POST "$BASE/auth/refresh")
assert_status 401 "$code" "rotated refresh reuse rejected"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$C1" "$BASE/auth/me")
assert_status 401 "$code" "refresh reuse invalidates access family"

# Get a clean customer session for RBAC/isolation.
C2="$TMP/customer2.jar"; : >"$C2"
code=$(login customer1 customer123 "$C2"); assert_status 200 "$code" "customer relogin after family revocation"
OWN_ID=$(psql "$DATABASE_URL" -Atc "SELECT customer_id FROM users WHERE username='customer1'")
OTHER_ID=$(psql "$DATABASE_URL" -Atc "SELECT id FROM customers WHERE id <> '$OWN_ID' ORDER BY created_at LIMIT 1")
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$C2" "$BASE/customers/$OWN_ID")
assert_status 200 "$code" "customer can read own record"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$C2" "$BASE/customers/$OTHER_ID")
assert_status 404 "$code" "customer cannot read another record"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$C2" "$BASE/admin/ping")
assert_status 403 "$code" "customer denied ADMIN route"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$C2" "$BASE/operator/ping")
assert_status 403 "$code" "customer denied OPERATOR route"

# 5. Disabled account: existing access dies immediately and login is blocked.
OP="$TMP/operator.jar"; : >"$OP"
code=$(login operator operator123 "$OP"); assert_status 200 "$code" "operator login before deactivation"
psql "$DATABASE_URL" -q -c "UPDATE users SET is_active=false, session_version=session_version+1 WHERE username='operator';" >/dev/null
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$OP" "$BASE/auth/me")
assert_status 401 "$code" "deactivated account existing access rejected"
OP2="$TMP/operator-disabled.jar"; : >"$OP2"
code=$(login operator operator123 "$OP2"); assert_status 403 "$code" "deactivated account login rejected"
psql "$DATABASE_URL" -q -c "UPDATE users SET is_active=true WHERE username='operator';" >/dev/null

# 6. Logout revokes refresh and clears cookies.
LO="$TMP/logout.jar"; : >"$LO"
code=$(login customer1 customer123 "$LO"); assert_status 200 "$code" "login before logout"
LO_REFRESH=$(cookie_value "$LO" refresh_token); LO_HASH=$(printf %s "$LO_REFRESH" | sha256sum | cut -d' ' -f1)
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$LO" -c "$LO" -X POST "$BASE/auth/logout")
assert_status 200 "$code" "logout"
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM refresh_tokens WHERE token_hash='$LO_HASH' AND revoked_at IS NOT NULL") == "1" ]] || { echo "FAIL logout token not revoked"; exit 1; }

# 7. Logout-all immediately kills access JWTs on every device via session_version.
D1="$TMP/device1.jar"; D2="$TMP/device2.jar"; : >"$D1"; : >"$D2"
code=$(login customer1 customer123 "$D1"); assert_status 200 "$code" "device one login"
code=$(login customer1 customer123 "$D2"); assert_status 200 "$code" "device two login"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$D1" -c "$D1" -X POST "$BASE/auth/logout-all")
assert_status 200 "$code" "logout all devices"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$D2" "$BASE/auth/me")
assert_status 401 "$code" "second-device access immediately revoked"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$D2" -X POST "$BASE/auth/refresh")
assert_status 401 "$code" "second-device refresh revoked"

# 8. Password change, old password rejection, new password acceptance, restore.
PW="$TMP/password.jar"; : >"$PW"
code=$(login operator operator123 "$PW"); assert_status 200 "$code" "login before password change"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"currentPassword":"operator123","newPassword":"Stage4New123"}' -b "$PW" -c "$PW" "$BASE/auth/password")
assert_status 200 "$code" "password change"
OLDPW="$TMP/old-password.jar"; : >"$OLDPW"
code=$(login operator operator123 "$OLDPW"); assert_status 401 "$code" "old password rejected"
NEWPW="$TMP/new-password.jar"; : >"$NEWPW"
code=$(login operator Stage4New123 "$NEWPW"); assert_status 200 "$code" "new password accepted"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -X PATCH -H 'Content-Type: application/json' -d '{"currentPassword":"Stage4New123","newPassword":"operator123"}' -b "$NEWPW" -c "$NEWPW" "$BASE/auth/password")
assert_status 200 "$code" "development password restored"

# 9. CSRF origin check and audit/security log assertions.
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -H 'Origin: https://evil.example' -b "$ADMIN" -X POST "$BASE/auth/logout-all")
assert_status 403 "$code" "untrusted browser origin rejected"
AUDIT_COUNT=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM audit_logs WHERE action LIKE 'auth.%'")
[[ "$AUDIT_COUNT" -gt 5 ]] || { echo "FAIL authentication audit events missing"; exit 1; }
! grep -Eq 'access_token=|refresh_token=' "$LOG" || { echo "FAIL sensitive token found in security log"; exit 1; }

echo "AUTH_INTEGRATION_OK assertions=$pass audit_events=$AUDIT_COUNT"
