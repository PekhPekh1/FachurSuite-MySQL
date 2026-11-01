#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"; export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-test-secret-at-least-32-characters-long}"
export API_PORT=4102 NODE_ENV=development
BASE="http://127.0.0.1:${API_PORT}/api/v1"; TMP=$(mktemp -d); LOG=/tmp/installments-customers-integration.log; API_PID=""; TEST_ID=""
NATIONAL=$(node - <<'NODE'
const b='123450987'; const s=[...b].reduce((a,x,i)=>a+Number(x)*(10-i),0),r=s%11; process.stdout.write(b+(r<2?r:11-r));
NODE
)
G_NATIONAL=$(node - <<'NODE'
const b='214365870'; const s=[...b].reduce((a,x,i)=>a+Number(x)*(10-i),0),r=s%11; process.stdout.write(b+(r<2?r:11-r));
NODE
)
cleanup(){
  if [[ -n "$TEST_ID" ]]; then
    while IFS= read -r f; do [[ -n "$f" ]] && rm -f "uploads/$f"; done < <(psql "$DATABASE_URL" -Atc "SELECT stored_name FROM documents WHERE owner_id='$TEST_ID'" 2>/dev/null || true)
    psql "$DATABASE_URL" -q <<SQL >/dev/null 2>&1 || true
DELETE FROM documents WHERE owner_id='$TEST_ID';
DELETE FROM guarantors WHERE customer_id='$TEST_ID';
DELETE FROM customer_credit_history WHERE customer_id='$TEST_ID';
DELETE FROM audit_logs WHERE entity_id='$TEST_ID';
DELETE FROM customers WHERE id='$TEST_ID';
SQL
  fi
  [[ -n "$API_PID" ]] && { kill "$API_PID" >/dev/null 2>&1 || true; wait "$API_PID" >/dev/null 2>&1 || true; }
  rm -rf "$TMP"
}; trap cleanup EXIT
pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; cat "$TMP/body" >&2 || true; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
request(){ local method=$1 url=$2 jar=$3 data=${4:-}; local a=(-sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -X "$method" -b "$jar" -c "$jar"); [[ -n "$data" ]] && a+=(-H 'Content-Type: application/json' -d "$data"); curl "${a[@]}" "$url"; }
login(){ request POST "$BASE/auth/login" "$3" "{\"username\":\"$1\",\"password\":\"$2\"}"; }
json_field(){ node -e "const b=require('fs').readFileSync('$TMP/body','utf8'); let x=JSON.parse(b); console.log($1)"; }

node apps/api/dist/server.js >"$LOG" 2>&1 & API_PID=$!
for _ in $(seq 1 30); do curl -fsS --max-time 1 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep .2; done
OP="$TMP/op.jar"; AD="$TMP/admin.jar"; CU="$TMP/customer.jar"; :>"$OP"; :>"$AD"; :>"$CU"
code=$(login operator operator123 "$OP"); assert "$code" 200 "operator login"
code=$(login admin admin123456 "$AD"); assert "$code" 200 "admin login"

INVALID='{"firstName":"آزمایش","lastName":"کاربر","nationalCode":"1234567890","mobile":"09125556677","tags":[],"creditLimit":0}'
code=$(request POST "$BASE/customers" "$OP" "$INVALID"); assert "$code" 400 "invalid national checksum"
CREATE="{\"firstName\":\"آزمایش\",\"lastName\":\"مرحله پنجم\",\"nationalCode\":\"$NATIONAL\",\"mobile\":\"09125556677\",\"secondaryPhone\":\"02122334455\",\"address\":\"نشانی ساختگی آزمون\",\"occupation\":\"آزمونگر\",\"notes\":\"داده کاملاً ساختگی\",\"tags\":[\"آزمون\",\"جدید\"],\"creditLimit\":12000000}"
code=$(request POST "$BASE/customers" "$OP" "$CREATE"); assert "$code" 201 "customer creation"
TEST_ID=$(json_field 'x.customer.id')
grep -q '"creditScore":500' "$TMP/body"
code=$(request POST "$BASE/customers" "$OP" "$CREATE"); assert "$code" 409 "duplicate national code"

code=$(request GET "$BASE/customers?q=$NATIONAL&page=1&pageSize=10" "$OP"); assert "$code" 200 "customer search"
grep -q "$TEST_ID" "$TMP/body"; grep -q '"pagination"' "$TMP/body"
code=$(request GET "$BASE/customers?page=1&pageSize=1&isActive=true&blacklisted=false" "$OP"); assert "$code" 200 "pagination and filtering"
grep -q '"pageSize":1' "$TMP/body"

code=$(request PATCH "$BASE/customers/$TEST_ID" "$OP" '{"occupation":"کارشناس آزمون","mobile":"09125556678","tags":["آزمون","ویرایش"]}'); assert "$code" 200 "customer editing"
grep -q 'کارشناس آزمون' "$TMP/body"
code=$(request PATCH "$BASE/customers/$TEST_ID" "$OP" '{"creditScore":999}'); assert "$code" 400 "credit score injection rejected"
code=$(request GET "$BASE/customers/$TEST_ID" "$OP"); assert "$code" 200 "customer detail and summaries"
grep -q '"summaries"' "$TMP/body"; grep -q '"creditHistory"' "$TMP/body"

code=$(request POST "$BASE/customers/$TEST_ID/blacklist" "$OP" '{"blacklisted":true,"reason":"آزمون مجوز"}'); assert "$code" 403 "operator cannot blacklist"
code=$(request POST "$BASE/customers/$TEST_ID/blacklist" "$AD" '{"blacklisted":true,"reason":"آزمون مجوز مدیر"}'); assert "$code" 200 "admin blacklists customer"
code=$(request POST "$BASE/customers/$TEST_ID/credit/recalculate" "$OP" '{}'); assert "$code" 200 "deterministic credit recalculation"
grep -q '"score":0' "$TMP/body"

code=$(request POST "$BASE/customers/$TEST_ID/guarantors" "$OP" '{"fullName":"ضامن آزمایشی","nationalCode":"1234567890","mobile":"09123334455"}'); assert "$code" 400 "guarantor validation"
G_CREATE="{\"fullName\":\"ضامن آزمایشی\",\"nationalCode\":\"$G_NATIONAL\",\"mobile\":\"09123334455\",\"relation\":\"همکار\"}"
code=$(request POST "$BASE/customers/$TEST_ID/guarantors" "$OP" "$G_CREATE"); assert "$code" 201 "guarantor creation"
G_ID=$(json_field 'x.guarantor.id')
code=$(request PATCH "$BASE/guarantors/$G_ID" "$OP" '{"relation":"دوست"}'); assert "$code" 200 "guarantor editing"
code=$(request GET "$BASE/customers/$TEST_ID/guarantors" "$OP"); assert "$code" 200 "guarantor listing"
grep -q "$G_ID" "$TMP/body"
code=$(request DELETE "$BASE/guarantors/$G_ID" "$OP"); assert "$code" 200 "guarantor deactivation"
code=$(request GET "$BASE/customers/$TEST_ID/guarantors" "$OP"); assert "$code" 200 "inactive guarantor hidden"
! grep -q "$G_ID" "$TMP/body"

printf 'not really a jpeg' > "$TMP/fake.jpg"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$OP" -F 'category=NATIONAL_CARD' -F "file=@$TMP/fake.jpg;type=image/jpeg" "$BASE/customers/$TEST_ID/documents")
assert "$code" 400 "file magic-byte validation"
printf '%%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%%%EOF\n' > "$TMP/sample.pdf"
code=$(curl -sS --max-time 8 -o "$TMP/body" -w "%{http_code}" -b "$OP" -F 'category=NATIONAL_CARD' -F "file=@$TMP/sample.pdf;type=application/pdf" "$BASE/customers/$TEST_ID/documents")
assert "$code" 201 "secure document upload"
DOC_ID=$(json_field 'x.document.id')
code=$(curl -sS --max-time 8 -o "$TMP/download" -w "%{http_code}" -b "$OP" "$BASE/documents/$DOC_ID"); assert "$code" 200 "authorized document download"
grep -q '%PDF-' "$TMP/download"

code=$(login customer1 customer123 "$CU"); assert "$code" 200 "customer login for isolation"
OWN_ID=$(psql "$DATABASE_URL" -Atc "SELECT customer_id FROM users WHERE username='customer1'")
code=$(request GET "$BASE/customers/$OWN_ID" "$CU"); assert "$code" 200 "customer reads own profile"
code=$(request GET "$BASE/customers/$TEST_ID" "$CU"); assert "$code" 404 "customer denied foreign profile"
code=$(request GET "$BASE/documents/$DOC_ID" "$CU"); assert "$code" 404 "customer denied foreign document"
code=$(request GET "$BASE/customers" "$CU"); assert "$code" 403 "customer denied customer directory"

code=$(request POST "$BASE/customers/$TEST_ID/deactivate" "$OP" '{"reason":"آزمون"}'); assert "$code" 403 "operator cannot deactivate"
code=$(request POST "$BASE/customers/$TEST_ID/deactivate" "$AD" '{"reason":"غیرفعال‌سازی آزمایشی"}'); assert "$code" 200 "admin deactivates without deletion"
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM customers WHERE id='$TEST_ID' AND is_active=false") == 1 ]] || { echo 'FAIL deactivation did not preserve row'; exit 1; }
code=$(request GET "$BASE/customers?isActive=false&q=$NATIONAL" "$AD"); assert "$code" 200 "inactive filter"
grep -q "$TEST_ID" "$TMP/body"
AUDITS=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM audit_logs WHERE entity_id IN ('$TEST_ID','$G_ID','$DOC_ID')")
[[ "$AUDITS" -ge 6 ]] || { echo "FAIL missing audit events count=$AUDITS"; exit 1; }

echo "CUSTOMER_INTEGRATION_OK assertions=$pass audits=$AUDITS"
