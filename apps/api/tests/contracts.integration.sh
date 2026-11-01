#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"; export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-test-secret-at-least-32-characters-long}"
export API_PORT=4103 NODE_ENV=development
BASE="http://127.0.0.1:${API_PORT}/api/v1"; TMP=$(mktemp -d); LOG=/tmp/installments-contracts-integration.log
API_PID=""; CUSTOMER_ID=""; CREATED=""

cleanup(){
  if [[ -n "$CREATED" ]]; then
    for id in $CREATED; do
      psql "$DATABASE_URL" -q -c "DELETE FROM installments WHERE contract_id='$id'; DELETE FROM audit_logs WHERE entity_id='$id'; DELETE FROM contracts WHERE id='$id';" >/dev/null 2>&1 || true
    done
  fi
  if [[ -n "$CUSTOMER_ID" ]]; then
    psql "$DATABASE_URL" -q -c "DELETE FROM customer_credit_history WHERE customer_id='$CUSTOMER_ID'; DELETE FROM audit_logs WHERE entity_id='$CUSTOMER_ID'; DELETE FROM customers WHERE id='$CUSTOMER_ID';" >/dev/null 2>&1 || true
  fi
  [[ -n "$API_PID" ]] && { kill "$API_PID" >/dev/null 2>&1 || true; wait "$API_PID" >/dev/null 2>&1 || true; }
  rm -rf "$TMP"
}; trap cleanup EXIT

pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; cat "$TMP/body" >&2 || true; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
req(){ local m=$1 u=$2 j=$3 d=${4:-}; local a=(-sS --max-time 10 -o "$TMP/body" -w "%{http_code}" -X "$m" -b "$j" -c "$j"); [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d"); curl "${a[@]}" "$u"; }
field(){ node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')); console.log($1)"; }

node apps/api/dist/server.js >"$LOG" 2>&1 & API_PID=$!
for _ in $(seq 1 40); do curl -fsS --max-time 1 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep .2; done

OP="$TMP/op.jar"; AD="$TMP/ad.jar"; CU="$TMP/cu.jar"; :>"$OP"; :>"$AD"; :>"$CU"
code=$(req POST "$BASE/auth/login" "$OP" '{"username":"operator","password":"operator123"}'); assert "$code" 200 "operator login"
code=$(req POST "$BASE/auth/login" "$AD" '{"username":"admin","password":"admin123456"}'); assert "$code" 200 "admin login"

NAT=$(node -e "const b='135792468';const s=[...b].reduce((a,x,i)=>a+Number(x)*(10-i),0),r=s%11;process.stdout.write(b+(r<2?r:11-r))")
code=$(req POST "$BASE/customers" "$OP" "{\"firstName\":\"قرارداد\",\"lastName\":\"آزمون\",\"nationalCode\":\"$NAT\",\"mobile\":\"09127778899\",\"tags\":[],\"creditLimit\":0}")
assert "$code" 201 "fixture customer created"; CUSTOMER_ID=$(field 'x.customer.id')

# ---- Cash contract: created unpaid ----
code=$(req POST "$BASE/contracts" "$OP" "{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"CASH\",\"itemDescription\":\"جاروبرقی آزمایشی\",\"itemSerialNumber\":\"SN-TEST-001\",\"notes\":\"یادداشت آزمون\",\"cashPrice\":4500000,\"totalPrice\":4500000}")
assert "$code" 201 "cash contract creation"
CASH_ID=$(field 'x.contract.id'); CREATED="$CREATED $CASH_ID"
code=$(req GET "$BASE/contracts/$CASH_ID" "$OP"); assert "$code" 200 "cash contract detail"
[[ $(field 'x.payment.isFullyPaid') == "false" ]] || { echo "FAIL cash contract must not be paid on creation"; exit 1; }
[[ $(field 'x.payment.confirmedAmount') == "0" ]] || { echo "FAIL cash contract should have no confirmed payments"; exit 1; }
echo "PASS cash contract is unpaid until a confirmed payment"; pass=$((pass+1))
grep -q 'SN-TEST-001' "$TMP/body" && echo "PASS serial number stored" && pass=$((pass+1))

# ---- Financial discrepancy must block, then succeed with audited override ----
BAD="{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"INSTALLMENT\",\"itemDescription\":\"یخچال آزمایشی\",\"cashPrice\":9000000,\"totalPrice\":11050000,\"downPayment\":2000000,\"installmentCount\":12,\"installmentAmount\":750000,\"firstDueDate\":\"2026-03-21\",\"paymentDay\":31}"
code=$(req POST "$BASE/contracts" "$OP" "$BAD"); assert "$code" 422 "discrepancy blocks creation"
grep -q 'FINANCIAL_DISCREPANCY' "$TMP/body"
code=$(req POST "$BASE/contracts" "$OP" "$(node -e "const o=JSON.parse(process.argv[1]);o.overrideDiscrepancy=true;o.overrideReason='تأیید مدیر فروش';process.stdout.write(JSON.stringify(o))" "$BAD")")
assert "$code" 201 "authorized override accepted"
OVR_ID=$(field 'x.contract.id'); CREATED="$CREATED $OVR_ID"
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM audit_logs WHERE entity_id='$OVR_ID' AND action='contract.discrepancy_override'") == 1 ]] || { echo 'FAIL override not audited'; exit 1; }
echo "PASS override recorded in audit log"; pass=$((pass+1))
LAST_AMOUNT=$(psql "$DATABASE_URL" -Atc "SELECT amount::numeric(18,0) FROM installments WHERE contract_id='$OVR_ID' ORDER BY seq DESC LIMIT 1")
[[ "$LAST_AMOUNT" == "800000" ]] || { echo "FAIL discrepancy not applied to last installment (got $LAST_AMOUNT)"; exit 1; }
echo "PASS discrepancy applied only to final installment"; pass=$((pass+1))

# ---- Month-end fallback: payment day 31 ----
DAYS=$(psql "$DATABASE_URL" -Atc "SELECT string_agg(to_char(due_date,'YYYY-MM-DD'), ',' ORDER BY seq) FROM installments WHERE contract_id='$OVR_ID'")
node -e "
const {toJalaali}=require('./apps/api/node_modules/jalaali-js');
const days='$DAYS'.split(',').map(d=>{const[a,b,c]=d.split('-').map(Number);return toJalaali(a,b,c);});
const bad=days.filter(j=>{const len=j.jm<=6?31:j.jm<=11?30:29;return j.jd!==Math.min(31,len);});
if(bad.length){console.error('FAIL month-end fallback',JSON.stringify(bad));process.exit(1);}
console.log('PASS month-end fallback produced valid clamped dates');
"; pass=$((pass+1))

# ---- Schedule generated exactly once ----
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM installments WHERE contract_id='$OVR_ID'") == 12 ]] || { echo 'FAIL schedule row count'; exit 1; }
echo "PASS schedule generated exactly once (12 rows)"; pass=$((pass+1))

# ---- Duplicate submission protection ----
KEY="idem-$(date +%s)-$RANDOM"
DUP="{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"CASH\",\"itemDescription\":\"کالای تکراری\",\"cashPrice\":1000000,\"totalPrice\":1000000,\"idempotencyKey\":\"$KEY\"}"
code=$(req POST "$BASE/contracts" "$OP" "$DUP"); assert "$code" 201 "first idempotent submit"
DUP_ID=$(field 'x.contract.id'); CREATED="$CREATED $DUP_ID"
code=$(req POST "$BASE/contracts" "$OP" "$DUP"); assert "$code" 200 "duplicate submit returns original"
[[ $(field 'x.contract.id') == "$DUP_ID" ]] || { echo 'FAIL duplicate created a second contract'; exit 1; }
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM contracts WHERE idempotency_key='$KEY'") == 1 ]] || { echo 'FAIL duplicate row persisted'; exit 1; }
echo "PASS duplicate request did not create a second contract"; pass=$((pass+1))

# ---- Concurrent contract numbers stay unique ----
BEFORE=$(psql "$DATABASE_URL" -Atc "SELECT count(DISTINCT contract_no) FROM contracts")
CONCURRENT_PIDS=()
for i in 1 2 3 4 5; do
  curl -sS --max-time 10 -o "$TMP/c$i" -b "$OP" -H 'Content-Type: application/json' \
    -d "{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"CASH\",\"itemDescription\":\"همزمان $i\",\"cashPrice\":500000,\"totalPrice\":500000}" \
    "$BASE/contracts" &
  CONCURRENT_PIDS+=($!)
done
# Wait only on the curl jobs — a bare `wait` would also block on the API server.
for pid in "${CONCURRENT_PIDS[@]}"; do wait "$pid" || true; done
for i in 1 2 3 4 5; do id=$(node -e "try{console.log(JSON.parse(require('fs').readFileSync('$TMP/c$i','utf8')).contract.id)}catch(e){console.log('')}"); [[ -n "$id" ]] && CREATED="$CREATED $id"; done
AFTER_ROWS=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM contracts"); AFTER_UNIQUE=$(psql "$DATABASE_URL" -Atc "SELECT count(DISTINCT contract_no) FROM contracts")
[[ "$AFTER_ROWS" == "$AFTER_UNIQUE" ]] || { echo "FAIL duplicate contract numbers rows=$AFTER_ROWS unique=$AFTER_UNIQUE"; exit 1; }
echo "PASS concurrent creation kept contract numbers unique (before=$BEFORE now=$AFTER_UNIQUE)"; pass=$((pass+1))

# ---- Search, filters, pagination ----
code=$(req GET "$BASE/contracts?q=SN-TEST-001" "$OP"); assert "$code" 200 "search by serial number"
grep -q "$CASH_ID" "$TMP/body"
code=$(req GET "$BASE/contracts?type=INSTALLMENT&status=ACTIVE&page=1&pageSize=5" "$OP"); assert "$code" 200 "type and status filters"
grep -q '"pageSize":5' "$TMP/body"
code=$(req GET "$BASE/contracts?customerId=$CUSTOMER_ID" "$OP"); assert "$code" 200 "filter by customer"

# ---- Preview endpoint performs no writes ----
PRE_BEFORE=$(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM contracts")
code=$(req POST "$BASE/contracts/preview" "$OP" "{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"INSTALLMENT\",\"itemDescription\":\"پیش‌نمایش\",\"cashPrice\":1000000,\"totalPrice\":1200000,\"downPayment\":0,\"installmentCount\":6,\"installmentAmount\":200000,\"firstDueDate\":\"2026-03-21\",\"paymentDay\":15}")
assert "$code" 200 "schedule preview"
[[ $(psql "$DATABASE_URL" -Atc "SELECT count(*) FROM contracts") == "$PRE_BEFORE" ]] || { echo 'FAIL preview wrote data'; exit 1; }
echo "PASS preview is read-only"; pass=$((pass+1))

# ---- Cancellation: permissions, reason, idempotence ----
code=$(req POST "$BASE/contracts/$DUP_ID/cancel" "$OP" '{"reason":"آزمون مجوز"}'); assert "$code" 403 "operator cannot cancel"
code=$(req POST "$BASE/contracts/$DUP_ID/cancel" "$AD" '{"reason":"xx"}'); assert "$code" 400 "cancel requires a real reason"
code=$(req POST "$BASE/contracts/$DUP_ID/cancel" "$AD" '{"reason":"انصراف مشتری آزمایشی"}'); assert "$code" 200 "admin cancels contract"
code=$(req POST "$BASE/contracts/$DUP_ID/cancel" "$AD" '{"reason":"دوباره"}'); assert "$code" 409 "cannot cancel twice"
[[ $(psql "$DATABASE_URL" -Atc "SELECT status FROM contracts WHERE id='$DUP_ID'") == "CANCELED" ]] || { echo 'FAIL cancel not persisted'; exit 1; }
echo "PASS cancellation persisted with reason"; pass=$((pass+1))

# ---- Customer isolation ----
code=$(req POST "$BASE/auth/login" "$CU" '{"username":"customer1","password":"customer123"}'); assert "$code" 200 "customer login"
code=$(req GET "$BASE/contracts/$CASH_ID" "$CU"); assert "$code" 404 "customer denied foreign contract"
code=$(req GET "$BASE/contracts" "$CU"); assert "$code" 403 "customer denied contract directory"

echo "CONTRACT_INTEGRATION_OK assertions=$pass"
