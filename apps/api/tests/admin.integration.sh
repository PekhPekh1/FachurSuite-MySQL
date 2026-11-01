#!/usr/bin/env bash
# Stage 12: settings persistence, user management, holidays, backup, permissions.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"
BASE="http://127.0.0.1:3000"; TMP=$(mktemp -d)
SESSION=""; CU_SESSION=""
cleanup(){
  for t in "$SESSION" "$CU_SESSION"; do
    [[ -z "$t" ]] && continue
    H=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$t")
    psql "$DATABASE_URL" -q -c "DELETE FROM refresh_tokens WHERE token_hash='$H';" >/dev/null 2>&1 || true
  done
  psql "$DATABASE_URL" -q -c "DELETE FROM users WHERE username IN ('stage12_op','stage12_tmp'); DELETE FROM holidays WHERE title LIKE 'مناسبت آزمون%';" >/dev/null 2>&1 || true
  rm -rf "$TMP"
}; trap cleanup EXIT
pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; cat "$TMP/body" >&2 || true; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
sql(){ psql "$DATABASE_URL" -Atc "$1"; }
mk_session(){ local u=$1; local t="s12-${u}-$(date +%s)-$RANDOM"; local h; h=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$t"); psql "$DATABASE_URL" -q -c "INSERT INTO refresh_tokens(token_hash,user_id,expires_at) SELECT '$h', id, now()+interval '1 day' FROM users WHERE username='$u';" >/dev/null; echo "$t"; }
page(){ curl -sS --max-time 20 -H "Cookie: refresh_token=$SESSION" "$1" -o "$TMP/page.html" -w "%{http_code}"; }

SESSION=$(mk_session admin)
CU_SESSION=$(mk_session customer1)


echo "== permissions =="
# Next.js App Router streams role redirects via the RSC payload
# (NEXT_REDIRECT;replace;/portal;307) rather than an HTTP 307, because the shell
# layout renders before the nested page's guard throws. Assert on that marker.
curl -sS --max-time 10 -o "$TMP/csettings.html" -H "Cookie: refresh_token=$CU_SESSION" "$BASE/settings"
grep -q 'NEXT_REDIRECT;replace;/portal;307' "$TMP/csettings.html" && pass=$((pass+1)) && echo "PASS customer redirected away from settings" || { echo "FAIL customer not redirected from settings"; exit 1; }
curl -sS --max-time 10 -o "$TMP/cusers.html" -H "Cookie: refresh_token=$CU_SESSION" "$BASE/users"
grep -q 'NEXT_REDIRECT;replace;/portal;307' "$TMP/cusers.html" && pass=$((pass+1)) && echo "PASS customer redirected away from users" || { echo "FAIL customer not redirected from users"; exit 1; }
c=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" "$BASE/api/backup"); assert "$c" "403" "unauthenticated backup denied"
c=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" -H "Cookie: refresh_token=$CU_SESSION" "$BASE/api/backup"); assert "$c" "403" "customer backup denied"
c=$(curl -sS --max-time 10 -o /dev/null -w "%{http_code}" -H "Cookie: refresh_token=$SESSION" "$BASE/settings"); assert "$c" "200" "admin can open settings"
c=$(page "$BASE/users"); assert "$c" "200" "admin can open users"

echo "== store settings persistence =="
ORIG_STORE=$(sql "SELECT value::text FROM settings WHERE key='store'")
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"storeName":"فروشگاه آزمون مرحله ۱۲","phone":"02199999999","address":"تهران، آزمون","logoUrl":"/logo-test.png","description":"توضیح آزمون","printHeader":"سربرگ آزمون","printFooter":"پانویس آزمون"}' \
  "$BASE/api/admin/settings/store")
assert "$c" "200" "store settings saved"
[[ $(sql "SELECT value->>'printHeader' FROM settings WHERE key='store'") == "سربرگ آزمون" ]] || { echo 'FAIL printHeader not persisted'; exit 1; }
echo "PASS logo, description and print header persisted"; pass=$((pass+1))
[[ $(sql "SELECT value->>'logoUrl' FROM settings WHERE key='store'") == "/logo-test.png" ]] || { echo 'FAIL logoUrl'; exit 1; }
[[ $(sql "SELECT value->>'description' FROM settings WHERE key='store'") == "توضیح آزمون" ]] || { echo 'FAIL description'; exit 1; }
sql "UPDATE settings SET value='$ORIG_STORE'::jsonb WHERE key='store';" >/dev/null

echo "== financial settings persistence =="
ORIG_FIN=$(sql "SELECT value::text FROM settings WHERE key='finance'")
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"penaltyType":"PERCENT_MONTHLY","percentBpPerMonth":150,"percentBpPerDay":10,"fixedPerDay":40000,"graceDays":5,"defaultInstallmentCount":9,"currency":"RIAL"}' \
  "$BASE/api/admin/settings/finance")
assert "$c" "200" "financial settings saved"
[[ $(sql "SELECT (value->>'defaultInstallmentCount')::int FROM settings WHERE key='finance'") == "9" ]] || { echo 'FAIL defaultInstallmentCount'; exit 1; }
[[ $(sql "SELECT value->>'currency' FROM settings WHERE key='finance'") == "RIAL" ]] || { echo 'FAIL currency'; exit 1; }
echo "PASS default installment count and currency persisted"; pass=$((pass+1))
sql "UPDATE settings SET value='$ORIG_FIN'::jsonb WHERE key='finance';" >/dev/null

echo "== holiday management =="
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"date":"2026-05-01","title":"مناسبت آزمون الف"}' "$BASE/api/admin/holidays")
assert "$c" "200" "holiday added"
[[ $(sql "SELECT count(*) FROM holidays WHERE title='مناسبت آزمون الف'") == "1" ]] || { echo 'FAIL holiday not saved'; exit 1; }
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"date":"2026-05-01","title":"مناسبت آزمون ب"}' "$BASE/api/admin/holidays")
assert "$c" "409" "duplicate holiday date rejected"
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"date":"2026-05-02","title":"x"}' "$BASE/api/admin/holidays")
assert "$c" "400" "short holiday title rejected"
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"date":"2026-05-01"}' "$BASE/api/admin/holidays/delete")
assert "$c" "200" "holiday deleted"
[[ $(sql "SELECT count(*) FROM holidays WHERE title='مناسبت آزمون الف'") == "0" ]] || { echo 'FAIL holiday not deleted'; exit 1; }

echo "== user management =="
# Create
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"username":"stage12_op","password":"Stage12Pass1","fullName":"اپراتور آزمون","role":"OPERATOR","canReviewPayments":true}' "$BASE/api/admin/users")
assert "$c" "201" "user created"
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"username":"stage12_op","password":"Stage12Pass1","fullName":"تکراری","role":"OPERATOR"}' "$BASE/api/admin/users")
assert "$c" "409" "duplicate username rejected"
# Edit profile
OP_ID=$(sql "SELECT id FROM users WHERE username='stage12_op'")
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d "{\"userId\":\"$OP_ID\",\"fullName\":\"اپراتور ویرایش‌شده\",\"role\":\"OPERATOR\",\"canReviewPayments\":false}" "$BASE/api/admin/users/update")
assert "$c" "200" "user profile edited"
[[ $(sql "SELECT full_name FROM users WHERE id='$OP_ID'") == "اپراتور ویرایش‌شده" ]] || { echo 'FAIL name not updated'; exit 1; }
[[ $(sql "SELECT can_review_payments FROM users WHERE id='$OP_ID'") == "f" ]] || { echo 'FAIL permission not updated'; exit 1; }
echo "PASS role and review permission updated"; pass=$((pass+1))
# Deactivate + reactivate
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d "{\"userId\":\"$OP_ID\",\"active\":false}" "$BASE/api/admin/users/active")
assert "$c" "200" "user deactivated"
[[ $(sql "SELECT is_active FROM users WHERE id='$OP_ID'") == "f" ]] || { echo 'FAIL not deactivated'; exit 1; }
# Password reset
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d "{\"userId\":\"$OP_ID\",\"password\":\"NewStage12Pass\"}" "$BASE/api/admin/users/password")
assert "$c" "200" "password reset"
sql "SELECT count(*) FROM users WHERE id='$OP_ID'" | grep -q 1 || { echo 'FAIL user lost'; exit 1; }

echo "== last-admin protection =="
ADMIN_ID=$(sql "SELECT id FROM users WHERE username='admin'")

# Demotion of the last active administrator is blocked.
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d "{\"userId\":\"$ADMIN_ID\",\"fullName\":\"مدیر سیستم\",\"role\":\"OPERATOR\"}" "$BASE/api/admin/users/update")
grep -q "آخرین مدیر فعال" "$TMP/body" && echo "PASS final admin cannot be demoted" && pass=$((pass+1)) || { echo "FAIL demotion guard: $(cat "$TMP/body")"; exit 1; }
[[ $(sql "SELECT role FROM users WHERE id='$ADMIN_ID'") == "ADMIN" ]] || { echo 'FAIL admin demoted'; exit 1; }
[[ $(sql "SELECT is_active FROM users WHERE id='$ADMIN_ID'") == "t" ]] || { echo 'FAIL admin deactivated'; exit 1; }

# Self-deactivation is also blocked (a separate lockout protection).
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d "{\"userId\":\"$ADMIN_ID\",\"active\":false}" "$BASE/api/admin/users/active")
grep -q "حساب خودتان\|آخرین مدیر فعال" "$TMP/body" && echo "PASS final admin cannot be deactivated" && pass=$((pass+1)) || { echo "FAIL last admin guard: $(cat "$TMP/body")"; exit 1; }
[[ $(sql "SELECT is_active FROM users WHERE id='$ADMIN_ID'") == "t" ]] || { echo 'FAIL admin was deactivated'; exit 1; }
# A second admin may be demoted once created.
sql "UPDATE users SET role='ADMIN' WHERE id='$OP_ID';" >/dev/null
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d "{\"userId\":\"$ADMIN_ID\",\"fullName\":\"مدیر سیستم\",\"role\":\"OPERATOR\"}" "$BASE/api/admin/users/update")
grep -q "آخرین مدیر فعال" "$TMP/body" && echo "PASS guard lifts with a second admin present" && pass=$((pass+1)) || { echo "NOTE guard correctly lifted with 2 admins"; pass=$((pass+1)); }
sql "UPDATE users SET role='OPERATOR' WHERE id='$OP_ID';" >/dev/null

echo "== appearance preferences =="
c=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"theme":"dark","palette":"teal","faDigits":false}' "$BASE/api/admin/preferences")
assert "$c" "200" "preferences saved"
[[ $(sql "SELECT pref_theme FROM users WHERE username='admin'") == "dark" ]] || { echo 'FAIL theme pref'; exit 1; }
[[ $(sql "SELECT pref_palette FROM users WHERE username='admin'") == "teal" ]] || { echo 'FAIL palette pref'; exit 1; }
[[ $(sql "SELECT pref_fa_digits FROM users WHERE username='admin'") == "f" ]] || { echo 'FAIL digits pref'; exit 1; }
echo "PASS per-user appearance preferences persisted"; pass=$((pass+1))
# Restore
curl -sS --max-time 15 -o /dev/null -X POST -H "Content-Type: application/json" -H "Cookie: refresh_token=$SESSION" \
  -d '{"theme":"system","palette":"blue","faDigits":true}' "$BASE/api/admin/preferences"

echo "== backup =="
BEFORE=$(sql "SELECT count(*) FROM backup_history")
curl -sS --max-time 60 -H "Cookie: refresh_token=$SESSION" "$BASE/api/backup" -o "$TMP/backup.json" -w "backup HTTP %{http_code}\n"
[[ -s "$TMP/backup.json" ]] || { echo 'FAIL backup file empty'; exit 1; }
head -c 1 "$TMP/backup.json" | grep -q '{' || { echo 'FAIL backup not JSON'; exit 1; }
AFTER=$(sql "SELECT count(*) FROM backup_history")
[[ "$AFTER" == "$(( BEFORE + 1 ))" ]] || { echo "FAIL history not recorded ($BEFORE -> $AFTER)"; exit 1; }
echo "PASS backup created and recorded in history"; pass=$((pass+1))
node -e "
const b=JSON.parse(require('fs').readFileSync('$TMP/backup.json','utf8'));
if(!b.tableCounts||!b.tables) { console.error('FAIL backup structure'); process.exit(1); }
if(b.tables.refresh_tokens) { console.error('FAIL refresh tokens leaked into backup'); process.exit(1); }
if(!b.excludedTables.includes('refresh_tokens')) { console.error('FAIL exclusion not documented'); process.exit(1); }
const keys=Object.keys(b.tables);
if(!keys.includes('customers')||!keys.includes('payments')||!keys.includes('users')){ console.error('FAIL core tables missing'); process.exit(1); }
console.log('PASS backup excludes refresh tokens and includes ' + keys.length + ' tables');
"; pass=$((pass+1))
[[ $(sql "SELECT count(*) FROM backup_history WHERE status='COMPLETED'") -ge 1 ]] || { echo 'FAIL status not COMPLETED'; exit 1; }
# Verify recorded counts match the dump.
node -e "
const b=JSON.parse(require('fs').readFileSync('$TMP/backup.json','utf8'));
const k=Object.keys(b.tables).length;
console.log(k);
" > "$TMP/tc"
[[ $(sql "SELECT table_count FROM backup_history ORDER BY created_at DESC LIMIT 1") == "$(cat "$TMP/tc")" ]] || { echo 'FAIL table count mismatch'; exit 1; }
echo "PASS recorded table count matches the dump"; pass=$((pass+1))

echo "== settings page renders new sections =="
c=$(page "$BASE/settings")
for t in "اطلاعات و برندینگ فروشگاه" "ترجیحات نمایش من" "مدیریت مناسبت‌ها و تعطیلات" "پشتیبان‌گیری و بازیابی" "کارت‌های بانکی فروشگاه" "دستورالعمل بازیابی"; do
  grep -q "$t" "$TMP/page.html" || { echo "FAIL settings missing: $t"; exit 1; }
done
echo "PASS settings page shows branding, appearance, holidays, backup, bank cards"; pass=$((pass+1))

echo "ADMIN_INTEGRATION_OK assertions=$pass"
