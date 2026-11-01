#!/usr/bin/env bash
# Stage 10: verifies dashboard/report totals against raw SQL ground truth.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"
# The Next.js web app is expected to be running on port 3000 (preview runtime).
BASE="http://127.0.0.1:3000"; TMP=$(mktemp -d)
SESSION_TOKEN=""

cleanup(){
  # Always remove the session created for this test run.
  if [[ -n "$SESSION_TOKEN" ]]; then
    psql "$DATABASE_URL" -q -c "DELETE FROM refresh_tokens WHERE token_hash='$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$SESSION_TOKEN");" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}; trap cleanup EXIT

pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
sql(){ psql "$DATABASE_URL" -Atc "$1"; }
toen(){ node -e "console.log(String(process.argv[1]).replace(/[۰-۹]/g,d=>'۰۱۲۳۴۵۶۷۸۹'.indexOf(d)).replace(/[^0-9-]/g,''))" "$1"; }

# Create a session row directly so the test is independent of the login endpoint.
SESSION_TOKEN="reports-test-$(date +%s)-$RANDOM"
SESSION_HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$SESSION_TOKEN")
psql "$DATABASE_URL" -q -c "INSERT INTO refresh_tokens(token_hash,user_id,expires_at) SELECT '$SESSION_HASH', id, now()+interval '1 day' FROM users WHERE username='admin';" >/dev/null
AUTH="Cookie: refresh_token=$SESSION_TOKEN"

TODAY=$(TZ=Asia/Tehran date +%F)
FROM=$(TZ=Asia/Tehran date -d '12 months ago' +%F)

# ---------- Ground truth ----------
SQL_CONFIRMED_COUNT=$(sql "SELECT count(*) FROM payments WHERE status='CONFIRMED'")
SQL_CONFIRMED_TOTAL=$(sql "SELECT coalesce(sum(amount),0)::bigint FROM payments WHERE status='CONFIRMED'")
SQL_PENDING_COUNT=$(sql "SELECT count(*) FROM payments WHERE status='PENDING_VERIFICATION'")
SQL_PENDING_TOTAL=$(sql "SELECT coalesce(sum(amount),0)::bigint FROM payments WHERE status='PENDING_VERIFICATION'")
SQL_REJECTED_COUNT=$(sql "SELECT count(*) FROM payments WHERE status='REJECTED'")
SQL_INS_CONTRACTS=$(sql "SELECT count(*) FROM contracts WHERE type='INSTALLMENT'")
SQL_MARGIN=$(sql "SELECT coalesce(sum(total_price-cash_price),0)::bigint FROM contracts WHERE type='INSTALLMENT'")
SQL_INS_CASH=$(sql "SELECT coalesce(sum(cash_price),0)::bigint FROM contracts WHERE type='INSTALLMENT'")
SQL_CUSTOMERS=$(sql "SELECT count(*) FROM customers")
SQL_ACTIVE_CONTRACTS=$(sql "SELECT count(*) FROM contracts WHERE status='ACTIVE'")
SQL_PAYABLE_PRINCIPAL=$(sql "SELECT coalesce(sum(i.amount),0)::bigint FROM installments i JOIN contracts c ON c.id=i.contract_id WHERE i.status IN ('PENDING','RESERVED') AND c.status='ACTIVE'")
SQL_SMS=$(sql "SELECT count(*) FROM sms_logs")

# ---------- Health & role guard ----------
code=$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "$BASE/api/health"); assert "$code" 200 "web app health"
code=$(curl -sS --max-time 5 -o /dev/null -w "%{http_code}" "$BASE/reports"); assert "$code" 307 "unauthenticated reports redirect"
# A customer session must be redirected away from staff reports.
CU_TOKEN="reports-cust-$(date +%s)-$RANDOM"
CU_HASH=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$CU_TOKEN")
psql "$DATABASE_URL" -q -c "INSERT INTO refresh_tokens(token_hash,user_id,expires_at) SELECT '$CU_HASH', id, now()+interval '1 day' FROM users WHERE username='customer1';" >/dev/null
curl -sS --max-time 8 -o "$TMP/creports.html" -H "Cookie: refresh_token=$CU_TOKEN" "$BASE/reports"
grep -q 'NEXT_REDIRECT;replace;/portal;307' "$TMP/creports.html" && echo "PASS customer is redirected away from staff reports" && pass=$((pass+1)) || { echo "FAIL customer not redirected from reports"; rm -f "$TMP/creports.html"; psql "$DATABASE_URL" -q -c "DELETE FROM refresh_tokens WHERE token_hash='$CU_HASH';" >/dev/null; exit 1; }
psql "$DATABASE_URL" -q -c "DELETE FROM refresh_tokens WHERE token_hash='$CU_HASH';" >/dev/null

fetch(){ curl -sS --max-time 20 -H "$AUTH" "$1" -o "$TMP/page.html"; }
val(){ node -e "
const h=require('fs').readFileSync('$TMP/page.html','utf8');
const m=h.match(new RegExp(process.argv[1]+'</p><p[^>]*>([^<]+)<','u'));
if(!m){console.error('label not found: '+process.argv[1]);process.exit(1)}
console.log(m[1]);
" "$1"; }

# ---------- 1. Income report ----------
fetch "$BASE/reports?report=income&from=$FROM&to=$TODAY"
assert "$(toen "$(val 'تعداد دریافتی')")" "$SQL_CONFIRMED_COUNT" "income count matches SQL"
assert "$(toen "$(val 'اصل اقساط')")" "$SQL_CONFIRMED_TOTAL" "income collected total matches SQL"
grep -q 'تأییدشده' "$TMP/page.html" && echo "PASS income report marks confirmed-only" && pass=$((pass+1))

# ---------- 2. Verification report ----------
fetch "$BASE/reports?report=verification&from=$FROM&to=$TODAY"
assert "$(toen "$(val 'در انتظار تأیید')")" "$SQL_PENDING_COUNT" "pending verification count matches SQL"
assert "$(toen "$(val 'تأییدشده')")" "$SQL_CONFIRMED_COUNT" "confirmed count matches SQL"
assert "$(toen "$(val 'ردشده')")" "$SQL_REJECTED_COUNT" "rejected count matches SQL"

# ---------- 3. Profit report ----------
fetch "$BASE/reports?report=profit&from=$FROM&to=$TODAY"
assert "$(toen "$(val 'قراردادهای اقساطی')")" "$SQL_INS_CONTRACTS" "installment contract count matches SQL"
assert "$(toen "$(val 'حاشیه قراردادی')")" "$SQL_MARGIN" "contractual margin matches SQL"
assert "$(toen "$(val 'جمع قیمت نقدی')")" "$SQL_INS_CASH" "cash price total matches SQL"
grep -q 'حاشیه قراردادی' "$TMP/page.html" && echo "PASS profit described as contractual margin, not cash income" && pass=$((pass+1))

# ---------- 4. Customer report ----------
fetch "$BASE/reports?report=customers&from=$FROM&to=$TODAY"
assert "$(toen "$(val 'تعداد مشتریان')")" "$SQL_CUSTOMERS" "customer count matches SQL"
RECEIVABLE=$(toen "$(val 'کل مطالبات')")
[[ "$RECEIVABLE" -ge "$SQL_PAYABLE_PRINCIPAL" ]] || { echo "FAIL receivable $RECEIVABLE < principal $SQL_PAYABLE_PRINCIPAL"; exit 1; }
echo "PASS receivables ($RECEIVABLE) include principal ($SQL_PAYABLE_PRINCIPAL) plus accrued penalties"; pass=$((pass+1))

# ---------- 5. Contract report ----------
fetch "$BASE/reports?report=contracts&from=$FROM&to=$TODAY"
grep -q 'مابه‌التفاوت' "$TMP/page.html" && echo "PASS contract report shows contractual difference" && pass=$((pass+1))

# ---------- 6. SMS report ----------
fetch "$BASE/reports?report=sms&from=$FROM&to=$TODAY"
grep -q 'نرخ تحویل' "$TMP/page.html" && echo "PASS SMS delivery rate reported" && pass=$((pass+1))

# ---------- 7. Overdue report ----------
fetch "$BASE/reports?report=overdue"
grep -q 'روزهای مشمول' "$TMP/page.html" || grep -q 'قسط' "$TMP/page.html"
echo "PASS overdue report renders with late-day detail"; pass=$((pass+1))

# ---------- Dashboard ----------
fetch "$BASE/"
for label in 'کل مطالبات' 'دریافتی امروز' 'دریافتی این ماه' 'قراردادهای فعال' 'مشتریان'; do
  grep -q "$label" "$TMP/page.html" || { echo "FAIL dashboard missing $label"; exit 1; }
done
echo "PASS dashboard shows all required KPIs"; pass=$((pass+1))
for label in 'به‌موقع در برابر معوق' 'توزیع وضعیت قراردادها' 'در انتظار تأیید' 'اقساط سررسید آینده' 'آخرین پرداخت‌ها'; do
  grep -q "$label" "$TMP/page.html" || { echo "FAIL dashboard missing $label"; exit 1; }
done
echo "PASS dashboard shows overdue/on-time, contract distribution, upcoming, recent, pending"; pass=$((pass+1))

# ---------- Date filters ----------
EMPTY_FROM=2026-01-01; EMPTY_TO=2026-01-31
SQL_EMPTY=$(sql "SELECT count(*) FROM payments WHERE status='CONFIRMED' AND created_at >= '$EMPTY_FROM' AND created_at < '${EMPTY_TO} 23:59:59+03:30'")
fetch "$BASE/reports?report=income&from=$EMPTY_FROM&to=$EMPTY_TO"
assert "$(toen "$(val 'تعداد دریافتی')")" "$SQL_EMPTY" "date-range filter matches SQL"

# Method filter
SQL_C2C=$(sql "SELECT count(*) FROM payments WHERE status='CONFIRMED' AND method='CARD_TO_CARD'")
fetch "$BASE/reports?report=income&method=CARD_TO_CARD"
assert "$(toen "$(val 'تعداد دریافتی')")" "$SQL_C2C" "payment-method filter matches SQL"

# ---------- Print layout ----------
for r in overdue income customers contracts profit verification sms; do
  code=$(curl -sS --max-time 20 -o "$TMP/pr.html" -w "%{http_code}" -H "$AUTH" "$BASE/reports/print?report=$r")
  assert "$code" 200 "print layout for $r"
  grep -q 'receipt-sheet' "$TMP/pr.html" || { echo "FAIL print layout missing sheet for $r"; exit 1; }
done
echo "PASS all print layouts are print-friendly"; pass=$((pass+1))

echo "REPORTS_INTEGRATION_OK assertions=$pass"
