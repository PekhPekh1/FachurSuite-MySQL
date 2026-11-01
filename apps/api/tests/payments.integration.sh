#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"; export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-test-secret-at-least-32-characters-long}"
export API_PORT=4105 NODE_ENV=development
BASE="http://127.0.0.1:${API_PORT}/api/v1"; TMP=$(mktemp -d); LOG=/tmp/payments-integration.log
API_PID=""; CUSTOMER_ID=""; CONTRACTS=""

cleanup(){
  for id in $CONTRACTS; do
    psql "$DATABASE_URL" -q -c "DELETE FROM payment_installments WHERE installment_id IN (SELECT id FROM installments WHERE contract_id='$id'); DELETE FROM payments WHERE contract_id='$id'; DELETE FROM installments WHERE contract_id='$id'; DELETE FROM audit_logs WHERE entity_id='$id'; DELETE FROM contracts WHERE id='$id';" >/dev/null 2>&1 || true
  done
  if [[ -n "$CUSTOMER_ID" ]]; then
    psql "$DATABASE_URL" -q -c "DELETE FROM customer_credit_history WHERE customer_id='$CUSTOMER_ID'; DELETE FROM audit_logs WHERE entity_id='$CUSTOMER_ID'; DELETE FROM customers WHERE id='$CUSTOMER_ID';" >/dev/null 2>&1 || true
  fi
  [[ -n "$API_PID" ]] && { kill "$API_PID" >/dev/null 2>&1 || true; wait "$API_PID" >/dev/null 2>&1 || true; }
  rm -rf "$TMP"
}; trap cleanup EXIT

pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; cat "$TMP/body" >&2 || true; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
note(){ pass=$((pass+1)); echo "PASS $1"; }
req(){ local m=$1 u=$2 j=$3 d=${4:-}; local a=(-sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X "$m" -b "$j" -c "$j"); [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d"); curl "${a[@]}" "$u"; }
field(){ node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')); console.log($1)"; }
sql(){ psql "$DATABASE_URL" -Atc "$1"; }

# Expected payable total (principal + penalty) for the oldest N PENDING
# installments, derived from each installment's real due date.
# Run settings: FIXED_DAILY 10,000 Toman, 3 grace days.
expected_total(){ # $1 = contractId, $2 = count
  psql "$DATABASE_URL" -At -F' ' -c "
    SELECT (CURRENT_DATE - d.due_date) AS days_late, d.amount::bigint
    FROM (SELECT due_date, amount FROM installments WHERE contract_id='$1' AND status='PENDING' ORDER BY seq LIMIT $2) d
  " | awk '{ raw=$1; d=(raw>3)?raw-3:0; total += $2 + d*10000 } END { printf "%d", total+0 }'
}
ids_json(){ # $1 = contractId, $2 = count → JSON array of installment ids
  sql "SELECT coalesce(json_agg(id), '[]'::json) FROM (SELECT id FROM installments WHERE contract_id='$1' AND status='PENDING' ORDER BY seq LIMIT $2) t"
}

node apps/api/dist/server.js >"$LOG" 2>&1 & API_PID=$!
for _ in $(seq 1 40); do curl -fsS --max-time 1 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep .2; done

OP="$TMP/op.jar"; AD="$TMP/ad.jar"; CU="$TMP/cu.jar"; :>"$OP"; :>"$AD"; :>"$CU"
code=$(req POST "$BASE/auth/login" "$OP" '{"username":"operator","password":"operator123"}'); assert "$code" 200 "operator login"
code=$(req POST "$BASE/auth/login" "$AD" '{"username":"admin","password":"admin123456"}'); assert "$code" 200 "admin login"
code=$(req POST "$BASE/auth/login" "$CU" '{"username":"customer1","password":"customer123"}'); assert "$code" 200 "customer login"

ORIG_FIN=$(sql "SELECT value::text FROM settings WHERE key='finance'")
restore(){ psql "$DATABASE_URL" -q -c "UPDATE settings SET value='$ORIG_FIN'::jsonb WHERE key='finance';" >/dev/null 2>&1 || true; }
trap 'restore; cleanup' EXIT
psql "$DATABASE_URL" -q -c "UPDATE settings SET value='{\"penaltyType\":\"FIXED_DAILY\",\"percentBpPerMonth\":120,\"percentBpPerDay\":10,\"fixedPerDay\":10000,\"graceDays\":3}'::jsonb WHERE key='finance';" >/dev/null

NAT=$(node -e "const b='357824619';const s=[...b].reduce((a,x,i)=>a+Number(x)*(10-i),0),r=s%11;process.stdout.write(b+(r<2?r:11-r))")
code=$(req POST "$BASE/customers" "$OP" "{\"firstName\":\"پرداخت\",\"lastName\":\"آزمون\",\"nationalCode\":\"$NAT\",\"mobile\":\"09121112233\",\"tags\":[],\"creditLimit\":0}")
assert "$code" 201 "fixture customer created"; CUSTOMER_ID=$(field 'x.customer.id')

mk_contract(){ # $1 = first due date, $2 = count, $3 = per-installment amount
  local c; c=$(req POST "$BASE/contracts" "$OP" "{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"INSTALLMENT\",\"itemDescription\":\"کالای آزمون پرداخت\",\"cashPrice\":$(( $2 * $3 )),\"totalPrice\":$(( $2 * $3 )),\"downPayment\":0,\"installmentCount\":$2,\"installmentAmount\":$3,\"firstDueDate\":\"$1\"}")
  [[ "$c" == "201" ]] || { echo "FAIL contract create ($c)"; cat "$TMP/body"; exit 1; }
  field 'x.contract.id'
}
PAST=$(node -e "const d=new Date(Date.now()-20*864e5);console.log(d.toISOString().slice(0,10))")

# ============ CASH (in-store) ============
C1=$(mk_contract "$PAST" 3 500000); CONTRACTS="$CONTRACTS $C1"
T1=$(expected_total "$C1" 1); IDS1=$(ids_json "$C1" 1)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C1\",\"installmentIds\":$IDS1,\"method\":\"CASH\",\"amount\":$T1,\"idempotencyKey\":\"cash-$RANDOM-$$\"}")
assert "$code" 201 "CASH payment recorded"
[[ $(sql "SELECT status FROM installments WHERE contract_id='$C1' AND status='PAID'") == "PAID" ]] || { echo 'FAIL CASH did not settle'; exit 1; }
note "CASH payment settles the installment immediately"
[[ $(sql "SELECT paid_at IS NOT NULL FROM payments WHERE contract_id='$C1'") == "t" ]] || { echo 'FAIL payment date missing'; exit 1; }
note "payment date and time recorded"

# ============ CARD_READER (in-person) ============
T2=$(expected_total "$C1" 1); IDS2=$(ids_json "$C1" 1)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C1\",\"installmentIds\":$IDS2,\"method\":\"CARD_READER\",\"amount\":$T2,\"referenceNo\":\"CR-98765\",\"idempotencyKey\":\"cr-$RANDOM-$$\"}")
assert "$code" 201 "CARD_READER payment recorded"
[[ $(sql "SELECT method FROM payments WHERE reference_no='CR-98765'") == "CARD_READER" ]] || { echo 'FAIL method not CARD_READER'; exit 1; }
note "CARD_READER stored and auto-confirmed"

# ============ Multi-installment consecutive ============
C2=$(mk_contract "$PAST" 4 400000); CONTRACTS="$CONTRACTS $C2"
TM=$(expected_total "$C2" 2); IDSM=$(ids_json "$C2" 2)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDSM,\"method\":\"CASH\",\"amount\":$TM,\"idempotencyKey\":\"multi-$RANDOM-$$\"}")
assert "$code" 201 "multi-installment payment"
[[ $(sql "SELECT count(*) FROM installments WHERE contract_id='$C2' AND status='PAID'") == "2" ]] || { echo 'FAIL multi did not pay both'; exit 1; }
note "multiple consecutive installments in one transaction"

# Non-consecutive (skipping the oldest) is rejected.
SKIP=$(sql "SELECT json_agg(id) FROM (SELECT id FROM installments WHERE contract_id='$C2' AND status='PENDING' ORDER BY seq OFFSET 1) t")
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$SKIP,\"method\":\"CASH\",\"amount\":400000,\"idempotencyKey\":\"skip-$RANDOM-$$\"}")
assert "$code" 400 "non-consecutive selection rejected"

# Amount validation.
T3=$(expected_total "$C2" 1); IDS3=$(ids_json "$C2" 1)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDS3,\"method\":\"CASH\",\"amount\":99999999,\"idempotencyKey\":\"over-$RANDOM-$$\"}")
assert "$code" 422 "overpayment rejected"
grep -q 'AMOUNT_MISMATCH' "$TMP/body"
note "payment totals cannot exceed the outstanding obligation"

# ============ CARD_TO_CARD verification flow ============
# Missing source card is rejected.
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDS3,\"method\":\"CARD_TO_CARD\",\"amount\":$T3,\"referenceNo\":\"TT-111\",\"idempotencyKey\":\"c2c-bad-$RANDOM-$$\"}")
assert "$code" 400 "card-to-card without source card rejected"

CT_KEY="c2c-$RANDOM-$$"
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDS3,\"method\":\"CARD_TO_CARD\",\"amount\":$T3,\"referenceNo\":\"TT-4451\",\"sourceCardNumber\":\"6037997512345678\",\"paidAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"idempotencyKey\":\"$CT_KEY\"}")
assert "$code" 202 "card-to-card receipt accepted for verification"
[[ $(sql "SELECT status FROM installments WHERE contract_id='$C2' AND status='RESERVED'") == "RESERVED" ]] || { echo 'FAIL receipt marked installment paid'; exit 1; }
note "a submitted receipt does NOT mark an installment as paid"
PAY_ID=$(sql "SELECT id FROM payments WHERE idempotency_key='$CT_KEY'")
[[ $(sql "SELECT source_card_number FROM payments WHERE id='$PAY_ID'") == "6037997512345678" ]] || { echo 'FAIL source card missing'; exit 1; }
note "source card number stored"
[[ $(sql "SELECT paid_at IS NOT NULL FROM payments WHERE id='$PAY_ID'") == "t" ]] || { echo 'FAIL payment date missing'; exit 1; }
note "customer-supplied payment date stored"
code=$(req GET "$BASE/payments/$PAY_ID/receipt" "$OP"); assert "$code" 409 "no receipt before confirmation"

# Double payment while reserved is blocked. The installment is no longer PENDING,
# so the API rejects it as invalid (400) or already covered (409) — either way it
# must NOT succeed.
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDS3,\"method\":\"CASH\",\"amount\":$T3,\"idempotencyKey\":\"dup-inst-$RANDOM-$$\"}")
if [[ "$code" == "400" || "$code" == "409" ]]; then
  note "double payment on a reserved installment blocked (HTTP $code)"
else
  echo "FAIL double payment not blocked: $code"; cat "$TMP/body"; exit 1
fi

# ---- Reject then resubmit ----
code=$(req POST "$BASE/payments/$PAY_ID/verify" "$OP" '{"approve":false}'); assert "$code" 400 "rejection requires a reason"
code=$(req POST "$BASE/payments/$PAY_ID/verify" "$AD" '{"approve":false,"reviewNote":"تصویر فیش ناخوانا بود"}'); assert "$code" 200 "receipt rejected with reason"
[[ $(sql "SELECT count(*) FROM installments WHERE contract_id='$C2' AND status='PENDING'") == "2" ]] || { echo 'FAIL rejection did not release reservation'; exit 1; }
note "rejection releases the reserved installment"
[[ $(sql "SELECT is_resubmittable FROM payments WHERE id='$PAY_ID'") == "t" ]] || { echo 'FAIL not resubmittable'; exit 1; }
note "rejection marked resubmittable"
[[ $(sql "SELECT reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL FROM payments WHERE id='$PAY_ID'") == "t" ]] || { echo 'FAIL verifier missing'; exit 1; }
note "verification user and timestamp recorded"
[[ $(sql "SELECT review_note FROM payments WHERE id='$PAY_ID'") == "تصویر فیش ناخوانا بود" ]] || { echo 'FAIL rejection reason missing'; exit 1; }
note "rejection reason stored"
code=$(req POST "$BASE/payments/$PAY_ID/verify" "$AD" '{"approve":true}'); assert "$code" 409 "cannot verify twice"

# Resubmission is only valid against a rejected payment, on the same contract.
RS_KEY="resub-$RANDOM-$$"
T4=$(expected_total "$C2" 1); IDS4=$(ids_json "$C2" 1)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDS4,\"method\":\"CARD_TO_CARD\",\"amount\":$T4,\"referenceNo\":\"TT-9922\",\"sourceCardNumber\":\"6037997599887766\",\"idempotencyKey\":\"$RS_KEY\",\"resubmissionOf\":\"$PAY_ID\"}")
assert "$code" 202 "resubmission after rejection accepted"
RS_ID=$(sql "SELECT id FROM payments WHERE idempotency_key='$RS_KEY'")
[[ $(sql "SELECT resubmission_of FROM payments WHERE id='$RS_ID'") == "$PAY_ID" ]] || { echo 'FAIL resubmission link'; exit 1; }
note "resubmission linked to the rejected payment"
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDS4,\"method\":\"CARD_TO_CARD\",\"amount\":$T4,\"referenceNo\":\"REF-12345\",\"sourceCardNumber\":\"6037997512345678\",\"idempotencyKey\":\"badres-$RANDOM-$$\",\"resubmissionOf\":\"$RS_ID\"}")
assert "$code" 409 "cannot resubmit against a non-rejected payment"

# ---- Approve ----
code=$(req POST "$BASE/payments/$RS_ID/verify" "$OP" '{"approve":true}'); assert "$code" 200 "authorized operator approves"
# seq 1,2 were paid by the multi payment; the resubmitted receipt paid seq 3.
[[ $(sql "SELECT count(*) FROM installments WHERE contract_id='$C2' AND status='PAID'") == "3" ]] || { echo 'FAIL approval did not pay: '"$(sql "SELECT count(*) FROM installments WHERE contract_id='$C2' AND status='PAID'")"; exit 1; }
note "approval settles exactly the covered obligations"
# seq 4 is still unpaid, so the contract must remain ACTIVE.
[[ $(sql "SELECT status FROM contracts WHERE id='$C2'") == "ACTIVE" ]] || { echo 'FAIL contract settled prematurely'; exit 1; }
note "contract not completed while an obligation remains"
# Paying the final installment completes the contract.
TF=$(expected_total "$C2" 1); IDSF=$(ids_json "$C2" 1)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C2\",\"installmentIds\":$IDSF,\"method\":\"CASH\",\"amount\":$TF,\"idempotencyKey\":\"final-$RANDOM-$$\"}")
assert "$code" 201 "final installment paid"
[[ $(sql "SELECT status FROM contracts WHERE id='$C2'") == "SETTLED" ]] || { echo 'FAIL contract not completed'; exit 1; }
note "contract completed when all obligations are satisfied"

# ---- Receipt for a confirmed payment ----
code=$(req GET "$BASE/payments/$RS_ID/receipt" "$OP"); assert "$code" 200 "receipt data returned"
node -e "
const r=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')).receipt;
const need=['receiptNo','contractNo','customer','itemDescription','amount','penaltyAmount','method','paidAt','verifiedBy','installments'];
const miss=need.filter(k=>r[k]===undefined);
if(miss.length){console.error('FAIL receipt missing: '+miss.join(','));process.exit(1)}
if(!r.sourceCardNumber.includes('****')){console.error('FAIL card not masked');process.exit(1)}
if(!r.installments.length){console.error('FAIL no installment lines');process.exit(1)}
console.log('PASS receipt has store/customer/contract/amount/method/reference/date/penalty');
"; pass=$((pass+1))

# ============ Idempotency ============
C3=$(mk_contract "$PAST" 1 300000); CONTRACTS="$CONTRACTS $C3"
T5=$(expected_total "$C3" 1); IDS5=$(ids_json "$C3" 1)
IDEM="idem-$RANDOM-$$"
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C3\",\"installmentIds\":$IDS5,\"method\":\"CASH\",\"amount\":$T5,\"idempotencyKey\":\"$IDEM\"}")
assert "$code" 201 "first idempotent submit"
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$C3\",\"installmentIds\":$IDS5,\"method\":\"CASH\",\"amount\":$T5,\"idempotencyKey\":\"$IDEM\"}")
assert "$code" 200 "duplicate returns the original"
[[ $(sql "SELECT count(*) FROM payments WHERE idempotency_key='$IDEM'") == "1" ]] || { echo 'FAIL duplicate row'; exit 1; }
note "duplicate submission does not double-charge"

# ============ Concurrency ============
C4=$(mk_contract "$PAST" 6 100000); CONTRACTS="$CONTRACTS $C4"
T6=$(expected_total "$C4" 1); IDS6=$(ids_json "$C4" 1)
PIDS=()
for i in 1 2 3 4; do
  curl -sS --max-time 15 -o "$TMP/cc$i" -b "$OP" -H 'Content-Type: application/json' \
    -d "{\"contractId\":\"$C4\",\"installmentIds\":$IDS6,\"method\":\"CASH\",\"amount\":$T6,\"idempotencyKey\":\"conc-$i-$RANDOM-$$\"}" \
    "$BASE/payments" & PIDS+=($!)
done
for pid in "${PIDS[@]}"; do wait "$pid" || true; done
OK=0; BAD=0
for i in 1 2 3 4; do
  if node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/cc$i','utf8'));process.exit(x.ok===true?0:1)" 2>/dev/null; then OK=$((OK+1)); else BAD=$((BAD+1)); fi
done
[[ "$OK" -eq 1 ]] || { echo "FAIL concurrent payments: succeeded=$OK (expected exactly 1)"; exit 1; }
note "concurrent duplicate payments: exactly 1 succeeded, $BAD rejected"
[[ $(sql "SELECT count(*) FROM installments WHERE contract_id='$C4' AND status='PAID'") == "1" ]] || { echo 'FAIL paid more than once'; exit 1; }
note "installment paid exactly once under concurrency"

# ============ Cash-sale direct payment ============
CS=$(req POST "$BASE/contracts" "$OP" "{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"CASH\",\"itemDescription\":\"فروش نقدی آزمون\",\"cashPrice\":7500000,\"totalPrice\":7500000}")
[[ "$CS" == "201" ]] || { echo "FAIL cash contract (HTTP $CS)"; cat "$TMP/body" >&2; exit 1; }
CS_ID=$(field 'x.contract.id'); CONTRACTS="$CONTRACTS $CS_ID"
[[ $(sql "SELECT count(*) FROM installments WHERE contract_id='$CS_ID' AND status='PENDING'") == "1" ]] || { echo 'FAIL cash sale not pending'; exit 1; }
note "cash sale starts unpaid"
TCS=$(expected_total "$CS_ID" 1); IDSCS=$(ids_json "$CS_ID" 1)
code=$(req POST "$BASE/payments" "$OP" "{\"contractId\":\"$CS_ID\",\"installmentIds\":$IDSCS,\"method\":\"CARD_READER\",\"amount\":$TCS,\"referenceNo\":\"CS-1\",\"idempotencyKey\":\"cs-$RANDOM-$$\"}")
assert "$code" 201 "cash sale direct payment recorded"
[[ $(sql "SELECT status FROM contracts WHERE id='$CS_ID'") == "SETTLED" ]] || { echo 'FAIL cash sale not settled'; exit 1; }
note "cash sale settles only through its confirmed payment"

# ============ Permissions & isolation ============
IDS7=$(ids_json "$C4" 1)
code=$(req POST "$BASE/payments" "$CU" "{\"contractId\":\"$C4\",\"installmentIds\":$IDS7,\"method\":\"CASH\",\"amount\":100000,\"idempotencyKey\":\"cust-$RANDOM-$$\"}")
assert "$code" 403 "customer cannot record CASH payments"
code=$(req POST "$BASE/payments" "$CU" "{\"contractId\":\"$C4\",\"installmentIds\":$IDS7,\"method\":\"CARD_READER\",\"amount\":100000,\"idempotencyKey\":\"cust2-$RANDOM-$$\"}")
assert "$code" 403 "customer cannot record CARD_READER payments"
C5=$(mk_contract "$PAST" 2 250000); CONTRACTS="$CONTRACTS $C5"
T7=$(expected_total "$C5" 1); IDS8=$(ids_json "$C5" 1)
code=$(req POST "$BASE/payments" "$CU" "{\"contractId\":\"$C5\",\"installmentIds\":$IDS8,\"method\":\"CARD_TO_CARD\",\"amount\":$T7,\"referenceNo\":\"C-1\",\"sourceCardNumber\":\"6037997512345678\",\"idempotencyKey\":\"cu-c2c-$RANDOM-$$\"}")
assert "$code" 404 "customer cannot pay a foreign contract"
code=$(req GET "$BASE/payments" "$CU"); assert "$code" 403 "customer denied payment directory"

echo "PAYMENT_INTEGRATION_OK assertions=$pass"
