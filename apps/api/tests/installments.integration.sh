#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"; export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-test-secret-at-least-32-characters-long}"
export API_PORT=4104 NODE_ENV=development
BASE="http://127.0.0.1:${API_PORT}/api/v1"; TMP=$(mktemp -d); LOG=/tmp/installments-lifecycle-integration.log
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
req(){ local m=$1 u=$2 j=$3 d=${4:-}; local a=(-sS --max-time 10 -o "$TMP/body" -w "%{http_code}" -X "$m" -b "$j" -c "$j"); [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d"); curl "${a[@]}" "$u"; }
field(){ node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')); console.log($1)"; }
sql(){ psql "$DATABASE_URL" -Atc "$1"; }

node apps/api/dist/server.js >"$LOG" 2>&1 & API_PID=$!
for _ in $(seq 1 40); do curl -fsS --max-time 1 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep .2; done

OP="$TMP/op.jar"; AD="$TMP/ad.jar"; CU="$TMP/cu.jar"; :>"$OP"; :>"$AD"; :>"$CU"
code=$(req POST "$BASE/auth/login" "$OP" '{"username":"operator","password":"operator123"}'); assert "$code" 200 "operator login"
code=$(req POST "$BASE/auth/login" "$AD" '{"username":"admin","password":"admin123456"}'); assert "$code" 200 "admin login"

# Deterministic settings for the whole matrix: 1.2%/month, 3 grace days.
ORIGINAL_FINANCE=$(sql "SELECT value::text FROM settings WHERE key='finance'")
psql "$DATABASE_URL" -q -c "UPDATE settings SET value='{\"penaltyType\":\"PERCENT_MONTHLY\",\"percentBpPerMonth\":120,\"percentBpPerDay\":10,\"fixedPerDay\":50000,\"graceDays\":3}'::jsonb WHERE key='finance';" >/dev/null
restore_finance(){ psql "$DATABASE_URL" -q -c "UPDATE settings SET value='$ORIGINAL_FINANCE'::jsonb WHERE key='finance';" >/dev/null 2>&1 || true; }
trap 'restore_finance; cleanup' EXIT

NAT=$(node -e "const b='246813579';const s=[...b].reduce((a,x,i)=>a+Number(x)*(10-i),0),r=s%11;process.stdout.write(b+(r<2?r:11-r))")
code=$(req POST "$BASE/customers" "$OP" "{\"firstName\":\"اقساط\",\"lastName\":\"آزمون\",\"nationalCode\":\"$NAT\",\"mobile\":\"09124445566\",\"tags\":[],\"creditLimit\":0}")
assert "$code" 201 "fixture customer created"; CUSTOMER_ID=$(field 'x.customer.id')

mk_contract(){ # $1 = first due date, $2 = count, $3 = amount
  # paymentDay is omitted so it derives from the Jalali day of firstDueDate,
  # keeping the first installment exactly on the requested date.
  local body="{\"customerId\":\"$CUSTOMER_ID\",\"type\":\"INSTALLMENT\",\"itemDescription\":\"کالای آزمون چرخه اقساط\",\"cashPrice\":$(( $2 * $3 )),\"totalPrice\":$(( $2 * $3 )),\"downPayment\":0,\"installmentCount\":$2,\"installmentAmount\":$3,\"firstDueDate\":\"$1\"}"
  local c; c=$(req POST "$BASE/contracts" "$OP" "$body"); [[ "$c" == "201" ]] || { echo "FAIL contract create ($c)"; cat "$TMP/body"; exit 1; }
  field 'x.contract.id'
}

# ---------- Overdue derivation + grace period + rounding ----------
C1=$(mk_contract "2026-01-15" 3 1000000); CONTRACTS="$CONTRACTS $C1"
code=$(req GET "$BASE/installments?contractId=$C1&status=OVERDUE" "$OP"); assert "$code" 200 "overdue listing"
OVERDUE_COUNT=$(field 'x.items.length')
[[ "$OVERDUE_COUNT" -ge 1 ]] || { echo "FAIL expected overdue rows"; exit 1; }
note "past-due pending installments are derived as OVERDUE ($OVERDUE_COUNT)"
PEN=$(field 'x.items[0].penalty'); DAYS=$(field 'x.items[0].daysLate'); AMT=$(field 'Number(x.items[0].amount)')
EXPECTED=$(node -e "console.log(Math.floor($AMT*120*$DAYS/(10000*30)))")
[[ "$PEN" == "$EXPECTED" ]] || { echo "FAIL penalty rounding: api=$PEN expected=$EXPECTED (days=$DAYS)"; exit 1; }
note "penalty matches documented floor rounding ($PEN for $DAYS days)"

# Grace period: an installment 2 days overdue (< 3 grace) must charge nothing.
GRACE_DUE=$(node -e "const d=new Date(Date.now()-2*864e5);console.log(d.toISOString().slice(0,10))")
C2=$(mk_contract "$GRACE_DUE" 1 1000000); CONTRACTS="$CONTRACTS $C2"
code=$(req GET "$BASE/installments?contractId=$C2&status=OVERDUE" "$OP"); assert "$code" 200 "grace-window listing"
[[ $(field 'x.items[0].penalty') == "0" ]] || { echo "FAIL penalty charged inside grace window"; exit 1; }
note "no penalty is charged inside the grace window"

# ---------- Upcoming filter ----------
FUTURE=$(node -e "const d=new Date(Date.now()+40*864e5);console.log(d.toISOString().slice(0,10))")
C3=$(mk_contract "$FUTURE" 2 500000); CONTRACTS="$CONTRACTS $C3"
code=$(req GET "$BASE/installments?contractId=$C3&status=UPCOMING" "$OP"); assert "$code" 200 "upcoming listing"
[[ $(field 'x.items.length') == "2" ]] || { echo "FAIL upcoming count"; exit 1; }
[[ $(field 'x.items[0].penalty') == "0" ]] || { echo "FAIL future installment has penalty"; exit 1; }
note "future installments are PENDING with no penalty"

# ---------- Due-date change (authorized only) ----------
INST_ID=$(sql "SELECT id FROM installments WHERE contract_id='$C1' ORDER BY seq LIMIT 1")
code=$(req PATCH "$BASE/installments/$INST_ID/due-date" "$OP" "{\"dueDate\":\"$FUTURE\",\"reason\":\"آزمون مجوز\"}"); assert "$code" 403 "operator cannot change due date"
code=$(req PATCH "$BASE/installments/$INST_ID/due-date" "$AD" '{"dueDate":"2026-01-15","reason":"تکراری"}'); assert "$code" 400 "same date rejected"
code=$(req PATCH "$BASE/installments/$INST_ID/due-date" "$AD" "{\"dueDate\":\"$FUTURE\",\"reason\":\"تمدید با تأیید مدیر\"}"); assert "$code" 200 "admin changes due date"
[[ $(sql "SELECT to_char(original_due_date,'YYYY-MM-DD') FROM installments WHERE id='$INST_ID'") == "2026-01-15" ]] || { echo 'FAIL original due date not preserved'; exit 1; }
note "original due date preserved for audit"
[[ $(sql "SELECT count(*) FROM audit_logs WHERE entity_id='$INST_ID' AND action='installment.due_date_change'") == "1" ]] || { echo 'FAIL due-date change not audited'; exit 1; }
note "due-date change recorded in audit log"
code=$(req GET "$BASE/installments?contractId=$C1&status=OVERDUE" "$OP")
node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')); if(x.items.some(i=>i.id==='$INST_ID')){console.error('FAIL moved installment still overdue');process.exit(1)}"
note "moving the due date forward stops penalty accrual"

# ---------- Penalty forgiveness vs. whole-installment forgiveness ----------
PEN_INST=$(sql "SELECT id FROM installments WHERE contract_id='$C1' AND status='PENDING' AND due_date < CURRENT_DATE ORDER BY seq LIMIT 1")
code=$(req POST "$BASE/installments/$PEN_INST/forgive-penalty" "$OP" '{"reason":"آزمون"}'); assert "$code" 403 "operator cannot forgive penalty"
code=$(req POST "$BASE/installments/$PEN_INST/forgive-penalty" "$AD" '{"reason":"بخشودگی جریمه آزمایشی"}'); assert "$code" 200 "admin forgives penalty"
code=$(req POST "$BASE/installments/$PEN_INST/forgive-penalty" "$AD" '{"reason":"دوباره"}'); assert "$code" 409 "penalty cannot be forgiven twice"
code=$(req GET "$BASE/installments?contractId=$C1&status=OVERDUE" "$OP")
node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8'));const it=x.items.find(i=>i.id==='$PEN_INST'); if(it&&it.penalty!==0){console.error('FAIL forgiven penalty still charged');process.exit(1)}"
note "forgiven penalty is no longer charged"

FORGIVE_INST=$(sql "SELECT id FROM installments WHERE contract_id='$C3' ORDER BY seq DESC LIMIT 1")
code=$(req POST "$BASE/installments/$FORGIVE_INST/forgive" "$AD" '{"reason":"بخشودگی کامل قسط آزمایشی"}'); assert "$code" 200 "admin forgives whole installment"
[[ $(sql "SELECT status FROM installments WHERE id='$FORGIVE_INST'") == "FORGIVEN" ]] || { echo 'FAIL status not FORGIVEN'; exit 1; }
note "whole-installment forgiveness sets terminal FORGIVEN status"
code=$(req POST "$BASE/installments/$FORGIVE_INST/forgive" "$AD" '{"reason":"دوباره"}'); assert "$code" 409 "installment cannot be forgiven twice"
code=$(req PATCH "$BASE/installments/$FORGIVE_INST/due-date" "$AD" "{\"dueDate\":\"$FUTURE\",\"reason\":\"آزمون\"}"); assert "$code" 409 "forgiven installment cannot be rescheduled"

# ---------- Paid installments never become overdue ----------
PAST=$(node -e "const d=new Date(Date.now()-120*864e5);console.log(d.toISOString().slice(0,10))")
C4=$(mk_contract "$PAST" 1 700000); CONTRACTS="$CONTRACTS $C4"
PAID_INST=$(sql "SELECT id FROM installments WHERE contract_id='$C4' LIMIT 1")
psql "$DATABASE_URL" -q -c "UPDATE installments SET status='PAID', paid_at=now() WHERE id='$PAID_INST';" >/dev/null
code=$(req GET "$BASE/installments?contractId=$C4&status=OVERDUE" "$OP"); assert "$code" 200 "overdue query after payment"
[[ $(field 'x.items.length') == "0" ]] || { echo 'FAIL paid installment became overdue'; exit 1; }
note "paid installment with a past due date never becomes overdue again"
code=$(req PATCH "$BASE/installments/$PAID_INST/due-date" "$AD" "{\"dueDate\":\"$FUTURE\",\"reason\":\"آزمون\"}"); assert "$code" 409 "paid installment cannot be rescheduled"

# ---------- Early settlement ----------
C5=$(mk_contract "$PAST" 4 1000000); CONTRACTS="$CONTRACTS $C5"
code=$(req POST "$BASE/contracts/$C5/settlement/quote" "$OP" '{}'); assert "$code" 200 "settlement quote"
Q_PRINCIPAL=$(field 'x.principalTotal'); Q_PENALTY=$(field 'x.penaltyTotal'); Q_TOTAL=$(field 'x.grandTotal')
[[ "$Q_PRINCIPAL" == "4000000" ]] || { echo "FAIL settlement principal=$Q_PRINCIPAL (no interest/discount expected)"; exit 1; }
[[ "$Q_TOTAL" == "$(( Q_PRINCIPAL + Q_PENALTY ))" ]] || { echo 'FAIL settlement total mismatch'; exit 1; }
note "settlement = unpaid principal + accrued penalties, no auto interest"
code=$(req POST "$BASE/contracts/$C5/settlement/quote" "$AD" '{"waivePenalties":true}'); assert "$code" 200 "waived settlement quote"
[[ $(field 'x.penaltyTotal') == "0" ]] || { echo 'FAIL waived quote still charges penalty'; exit 1; }
[[ $(field 'x.forgivenPenaltyTotal') == "$Q_PENALTY" ]] || { echo 'FAIL forgiven penalty total mismatch'; exit 1; }
note "authorized waiver removes penalties and reports the forgiven amount"

code=$(req POST "$BASE/contracts/$C5/settlement" "$OP" "{\"idempotencyKey\":\"settle-$RANDOM-$$\",\"waivePenalties\":true}"); assert "$code" 403 "operator cannot waive penalties on settlement"
SKEY="settle-ok-$RANDOM-$$"
code=$(req POST "$BASE/contracts/$C5/settlement" "$OP" "{\"idempotencyKey\":\"$SKEY\",\"method\":\"CASH\"}"); assert "$code" 201 "settlement processed"
[[ $(sql "SELECT count(*) FROM installments WHERE contract_id='$C5' AND status<>'PAID'") == "0" ]] || { echo 'FAIL installments not all paid'; exit 1; }
[[ $(sql "SELECT status FROM contracts WHERE id='$C5'") == "SETTLED" ]] || { echo 'FAIL contract not completed'; exit 1; }
note "settlement paid every installment and completed the contract"
PAID_AMOUNT=$(sql "SELECT amount::numeric(18,0) FROM payments WHERE idempotency_key='$SKEY'")
[[ "$PAID_AMOUNT" == "$Q_TOTAL" ]] || { echo "FAIL payment amount=$PAID_AMOUNT quote=$Q_TOTAL"; exit 1; }
note "recorded payment equals the quoted settlement amount"
code=$(req POST "$BASE/contracts/$C5/settlement" "$OP" "{\"idempotencyKey\":\"$SKEY\"}"); assert "$code" 200 "duplicate settlement is idempotent"
[[ $(sql "SELECT count(*) FROM payments WHERE idempotency_key='$SKEY'") == "1" ]] || { echo 'FAIL duplicate settlement payment'; exit 1; }
note "duplicate settlement did not double-charge"
code=$(req POST "$BASE/contracts/$C5/settlement/quote" "$OP" '{}'); assert "$code" 409 "nothing left to settle"

# ---------- Customer isolation ----------
code=$(req POST "$BASE/auth/login" "$CU" '{"username":"customer1","password":"customer123"}'); assert "$code" 200 "customer login"
code=$(req GET "$BASE/installments" "$CU"); assert "$code" 403 "customer denied installment directory"
code=$(req POST "$BASE/contracts/$C1/settlement/quote" "$CU" '{}'); assert "$code" 404 "customer denied foreign settlement quote"
code=$(req PATCH "$BASE/installments/$PEN_INST/due-date" "$CU" "{\"dueDate\":\"$FUTURE\",\"reason\":\"تلاش غیرمجاز\"}"); assert "$code" 403 "customer cannot change due dates"

echo "INSTALLMENT_LIFECYCLE_OK assertions=$pass"
