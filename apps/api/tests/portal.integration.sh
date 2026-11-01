#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"; export JWT_ACCESS_SECRET="${JWT_ACCESS_SECRET:-integration-test-secret-at-least-32-characters-long}"
export API_PORT=4108 NODE_ENV=development
BASE="http://127.0.0.1:${API_PORT}/api/v1"; TMP=$(mktemp -d); LOG=/tmp/portal-integration.log
API_PID=""

cleanup(){
  # Remove only the fictional fixture rows created by this run.
  for nat in "$(ncode 445566778)" "$(ncode 112233445)" "$(ncode 998877665)"; do
    psql "$DATABASE_URL" -q -c "
      DELETE FROM payment_installments WHERE installment_id IN (SELECT id FROM installments WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id IN (SELECT id FROM customers WHERE national_code='$nat')));
      DELETE FROM payments WHERE customer_id IN (SELECT id FROM customers WHERE national_code='$nat');
      DELETE FROM installments WHERE contract_id IN (SELECT id FROM contracts WHERE customer_id IN (SELECT id FROM customers WHERE national_code='$nat'));
      DELETE FROM contracts WHERE customer_id IN (SELECT id FROM customers WHERE national_code='$nat');
      DELETE FROM customer_credit_history WHERE customer_id IN (SELECT id FROM customers WHERE national_code='$nat');
      DELETE FROM customers WHERE national_code='$nat';" >/dev/null 2>&1 || true
  done
  psql "$DATABASE_URL" -q -c "DELETE FROM users WHERE username LIKE 'portal_t_%'; DELETE FROM refresh_tokens WHERE user_id NOT IN (SELECT id FROM users);" >/dev/null 2>&1 || true
  [[ -n "$API_PID" ]] && { kill "$API_PID" >/dev/null 2>&1 || true; wait "$API_PID" >/dev/null 2>&1 || true; }
  rm -rf "$TMP"
}; trap cleanup EXIT

pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; cat "$TMP/body" >&2 || true; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
note(){ pass=$((pass+1)); echo "PASS $1"; }
req(){ local m=$1 u=$2 j=$3 d=${4:-}; local a=(-sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -X "$m" -b "$j" -c "$j"); [[ -n "$d" ]] && a+=(-H 'Content-Type: application/json' -d "$d"); curl "${a[@]}" "$u"; }
field(){ node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')); console.log($1)"; }
sql(){ psql "$DATABASE_URL" -Atc "$1"; }
ncode(){ node -e "const b='$1';const s=[...b].reduce((a,x,i)=>a+Number(x)*(10-i),0),r=s%11;process.stdout.write(b+(r<2?r:11-r))"; }

node apps/api/dist/server.js >"$LOG" 2>&1 & API_PID=$!
for _ in $(seq 1 40); do curl -fsS --max-time 1 "http://127.0.0.1:${API_PORT}/health" >/dev/null 2>&1 && break; sleep .2; done

OP="$TMP/op.jar"; AD="$TMP/ad.jar"; A="$TMP/a.jar"; B="$TMP/b.jar"; :>"$OP"; :>"$AD"; :>"$A"; :>"$B"
code=$(req POST "$BASE/auth/login" "$OP" '{"username":"operator","password":"operator123"}'); assert "$code" 200 "operator login"
code=$(req POST "$BASE/auth/login" "$AD" '{"username":"admin","password":"admin123456"}'); assert "$code" 200 "admin login"

# Bank cards for the portal.
psql "$DATABASE_URL" -q -c "INSERT INTO settings(key,value) VALUES ('bank_accounts','{\"accounts\":[{\"bankName\":\"بانک ملی\",\"cardNumber\":\"6037997512345678\",\"cardHolder\":\"فروشگاه نمونه\",\"iban\":\"IR123456789012345678901234\",\"isActive\":true},{\"bankName\":\"بانک سامان\",\"cardNumber\":\"6219861012345678\",\"cardHolder\":\"فروشگاه نمونه\",\"iban\":null,\"isActive\":false}]}'::jsonb) ON CONFLICT (key) DO UPDATE SET value=EXCLUDED.value;" >/dev/null

# ---------- Two customers with their own data ----------
NAT_A=$(ncode 445566778); NAT_B=$(ncode 112233445)
code=$(req POST "$BASE/customers" "$OP" "{\"firstName\":\"پرتال\",\"lastName\":\"الف\",\"nationalCode\":\"$NAT_A\",\"mobile\":\"09125550001\",\"tags\":[],\"creditLimit\":0}")
assert "$code" 201 "customer A created"; CID_A=$(field 'x.customer.id')
code=$(req POST "$BASE/customers" "$OP" "{\"firstName\":\"پرتال\",\"lastName\":\"باء\",\"nationalCode\":\"$NAT_B\",\"mobile\":\"09125550002\",\"tags\":[],\"creditLimit\":0}")
assert "$code" 201 "customer B created"; CID_B=$(field 'x.customer.id')

# Portal user accounts for each.
HASH_A=$(node -e "console.log(require('bcryptjs').hashSync('PortalTest123',12))")
HASH_B=$(node -e "console.log(require('bcryptjs').hashSync('PortalTest123',12))")
psql "$DATABASE_URL" -q -c "INSERT INTO users(username,password_hash,full_name,role,customer_id) VALUES ('portal_t_a','$HASH_A','پرتال الف','CUSTOMER','$CID_A'),('portal_t_b','$HASH_B','پرتال باء','CUSTOMER','$CID_B');" >/dev/null
code=$(req POST "$BASE/auth/login" "$A" '{"username":"portal_t_a","password":"PortalTest123"}'); assert "$code" 200 "customer A portal login"
code=$(req POST "$BASE/auth/login" "$B" '{"username":"portal_t_b","password":"PortalTest123"}'); assert "$code" 200 "customer B portal login"

# One overdue contract for A, one for B.
PAST=$(node -e "const d=new Date(Date.now()-15*864e5);console.log(d.toISOString().slice(0,10))")
mkc(){ req POST "$BASE/contracts" "$OP" "{\"customerId\":\"$1\",\"type\":\"INSTALLMENT\",\"itemDescription\":\"$2\",\"cashPrice\":$3,\"totalPrice\":$3,\"downPayment\":0,\"installmentCount\":1,\"installmentAmount\":$3,\"firstDueDate\":\"$PAST\"}" >/dev/null; }
mkc "$CID_A" "کالای الف" 600000; mkc "$CID_B" "کالای ب" 800000
CON_A=$(sql "SELECT id FROM contracts WHERE customer_id='$CID_A' LIMIT 1")
CON_B=$(sql "SELECT id FROM contracts WHERE customer_id='$CID_B' LIMIT 1")
INST_A=$(sql "SELECT id FROM installments WHERE contract_id='$CON_A' LIMIT 1")
INST_B=$(sql "SELECT id FROM installments WHERE contract_id='$CON_B' LIMIT 1")

# ---------- Portal dashboard is self-scoped ----------
code=$(req GET "$BASE/portal" "$A"); assert "$code" 200 "customer A portal dashboard"
[[ $(field 'x.customer.id') == "$CID_A" ]] || { echo 'FAIL portal returned wrong customer'; exit 1; }
note "portal derives the customer purely from the session"
[[ $(field 'x.contracts.length') == "1" ]] || { echo 'FAIL portal contract count'; exit 1; }
[[ $(field 'x.contracts[0].id') == "$CON_A" ]] || { echo 'FAIL portal shows a foreign contract'; exit 1; }
note "portal shows only the customer's own contracts"
[[ $(field 'x.schedule.length') == "1" ]] && [[ $(field 'x.schedule[0].contractId') == "$CON_A" ]] || { echo 'FAIL portal schedule'; exit 1; }
note "portal schedule is limited to own installments"
node -e "
const x=JSON.parse(require('fs').readFileSync('$TMP/body','utf8'));
const need=['contracts','activeContracts','upcomingCount','overdueCount','overduePenalty','outstanding','confirmedPaid'];
const miss=need.filter(k=>x.summary[k]===undefined);
if(miss.length){console.error('FAIL summary missing '+miss);process.exit(1)}
console.log('PASS dashboard summary includes upcoming/overdue/outstanding/paid');
"; pass=$((pass+1))
[[ $(field 'x.summary.overdueCount') == "1" ]] || { echo 'FAIL overdue not reported'; exit 1; }
note "overdue installments reported"

# ---------- Bank cards ----------
code=$(req GET "$BASE/portal/bank-cards" "$A"); assert "$code" 200 "bank cards endpoint"
[[ $(field 'x.accounts.length') == "1" ]] || { echo 'FAIL inactive card leaked'; exit 1; }
grep -q '6037997512345678' "$TMP/body" || { echo 'FAIL active card missing'; exit 1; }
! grep -q '6219861012345678' "$TMP/body" || { echo 'FAIL inactive card exposed'; exit 1; }
note "only active store cards are exposed"

# ---------- Role restriction ----------
code=$(req GET "$BASE/portal" "$OP"); assert "$code" 403 "staff cannot use the customer portal"
code=$(req GET "$BASE/portal" "$AD"); assert "$code" 403 "admin cannot use the customer portal"
code=$(req GET "$BASE/portal/bank-cards" "$OP"); assert "$code" 403 "staff blocked from portal bank cards"

# ---------- Cross-customer isolation ----------
code=$(req GET "$BASE/customers/$CID_B" "$A"); assert "$code" 404 "customer A cannot read customer B"
code=$(req GET "$BASE/customers/$CID_A" "$B"); assert "$code" 404 "customer B cannot read customer A"
code=$(req GET "$BASE/contracts/$CON_B" "$A"); assert "$code" 404 "customer A cannot read B's contract"
code=$(req GET "$BASE/contracts/$CON_A" "$B"); assert "$code" 404 "customer B cannot read A's contract"
code=$(req GET "$BASE/customers/$CID_A/guarantors" "$B"); assert "$code" 404 "customer B cannot list A's guarantors"
code=$(req GET "$BASE/customers/$CID_A/documents" "$B"); assert "$code" 404 "customer B cannot list A's documents"
code=$(req POST "$BASE/contracts/$CON_B/settlement/quote" "$A" '{}'); assert "$code" 404 "customer A cannot quote B's settlement"

# ---------- Receipt submission by the customer ----------
# Compute the expected total exactly as the backend engine does, for any mode.
TOTAL_A=$(node -e "
const fs=require('fs');
const s=JSON.parse(process.argv[1]);
const rows=process.argv[2].split(' ').filter(Boolean);
let total=0;
for(const r of rows){
  const [raw,amt]=r.split(':').map(Number);
  const days=Math.max(0,raw-s.graceDays);
  let pen=0;
  if(days>0){
    if(s.penaltyType==='PERCENT_MONTHLY') pen=Math.floor(amt*s.percentBpPerMonth*days/(10000*30));
    else if(s.penaltyType==='FIXED_DAILY') pen=Math.max(0,Math.round(s.fixedPerDay))*days;
    else if(s.penaltyType==='PERCENT_DAILY') pen=Math.floor(amt*s.percentBpPerDay/10000)*days;
  }
  total+=amt+pen;
}
console.log(total);
" "$(sql "SELECT value::text FROM settings WHERE key='finance'")" "$(sql "SELECT (CURRENT_DATE - due_date)||':'||amount::int FROM installments WHERE id='$INST_A'")")
KEY_A="portal-a-$RANDOM-$$"
code=$(req POST "$BASE/payments" "$A" "{\"contractId\":\"$CON_A\",\"installmentIds\":[\"$INST_A\"],\"method\":\"CARD_TO_CARD\",\"amount\":$TOTAL_A,\"referenceNo\":\"PT-A-1001\",\"sourceCardNumber\":\"6037997599887766\",\"paidAt\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\",\"idempotencyKey\":\"$KEY_A\"}")
assert "$code" 202 "customer A submits a receipt"
PAY_A=$(sql "SELECT id FROM payments WHERE idempotency_key='$KEY_A'")
[[ $(sql "SELECT status FROM installments WHERE id='$INST_A'") == "RESERVED" ]] || { echo 'FAIL receipt paid the installment'; exit 1; }
note "submitted receipt does not settle the installment"

# A customer cannot submit for another customer's contract/instalment.
code=$(req POST "$BASE/payments" "$A" "{\"contractId\":\"$CON_B\",\"installmentIds\":[\"$INST_B\"],\"method\":\"CARD_TO_CARD\",\"amount\":800000,\"referenceNo\":\"PT-X\",\"sourceCardNumber\":\"6037997599887766\",\"idempotencyKey\":\"iso-$RANDOM-$$\"}")
assert "$code" 404 "customer A cannot pay customer B's installment"
# Customers may only use CARD_TO_CARD.
code=$(req POST "$BASE/payments" "$A" "{\"contractId\":\"$CON_A\",\"installmentIds\":[\"$INST_A\"],\"method\":\"CASH\",\"amount\":$TOTAL_A,\"idempotencyKey\":\"m-$RANDOM-$$\"}")
assert "$code" 403 "customer cannot record a CASH payment"

# Payment appears in A's history as pending.
code=$(req GET "$BASE/portal" "$A"); assert "$code" 200 "portal refresh after submission"
[[ $(field 'x.payments.length') == "1" ]] || { echo 'FAIL payment not in history'; exit 1; }
[[ $(field 'x.payments[0].status') == "PENDING_VERIFICATION" ]] || { echo 'FAIL wrong status'; exit 1; }
note "payment history shows PENDING_VERIFICATION"
[[ $(field 'x.payments[0].sourceCardNumber') == "6037-****-****-7766" ]] || { echo 'FAIL card not masked'; exit 1; }
note "source card is masked in the portal"

# ---------- Rejection and resubmission ----------
code=$(req POST "$BASE/payments/$PAY_A/verify" "$A" '{"approve":true}'); assert "$code" 403 "customer cannot verify their own receipt"
code=$(req POST "$BASE/payments/$PAY_A/verify" "$AD" '{"approve":false,"reviewNote":"مبلغ واریزی با فیش مطابقت ندارد"}'); assert "$code" 200 "receipt rejected with reason"
[[ $(sql "SELECT status FROM installments WHERE id='$INST_A'") == "PENDING" ]] || { echo 'FAIL rejection did not release'; exit 1; }
note "rejection released the installment"
code=$(req GET "$BASE/portal" "$A")
[[ $(field 'x.payments[0].status') == "REJECTED" ]] || { echo 'FAIL status not REJECTED'; exit 1; }
[[ $(field 'x.payments[0].reviewNote') == "مبلغ واریزی با فیش مطابقت ندارد" ]] || { echo 'FAIL reason not exposed'; exit 1; }
[[ $(field 'x.payments[0].isResubmittable') == "true" ]] || { echo 'FAIL not resubmittable'; exit 1; }
note "rejection reason and resubmittability exposed to the owner"
# No receipt document is issued for a rejected payment.
code=$(req GET "$BASE/payments/$PAY_A/receipt" "$A"); assert "$code" 409 "no receipt for a rejected payment"

# Resubmission.
KEY_R="portal-resub-$RANDOM-$$"
code=$(req POST "$BASE/payments" "$A" "{\"contractId\":\"$CON_A\",\"installmentIds\":[\"$INST_A\"],\"method\":\"CARD_TO_CARD\",\"amount\":$TOTAL_A,\"referenceNo\":\"PT-A-2002\",\"sourceCardNumber\":\"6037997599887766\",\"idempotencyKey\":\"$KEY_R\",\"resubmissionOf\":\"$PAY_A\"}")
assert "$code" 202 "customer resubmits after rejection"
PAY_R=$(sql "SELECT id FROM payments WHERE idempotency_key='$KEY_R'")
[[ $(sql "SELECT resubmission_of FROM payments WHERE id='$PAY_R'") == "$PAY_A" ]] || { echo 'FAIL resubmission link'; exit 1; }
note "resubmission linked to the rejected payment"
# The other customer cannot see A's resubmitted payment.
code=$(req GET "$BASE/portal" "$B")
[[ $(field 'x.payments.length') == "0" ]] || { echo 'FAIL B sees A payments'; exit 1; }
note "customer B sees none of A's payments"

# ---------- Approval, status update and PDF ----------
code=$(req POST "$BASE/payments/$PAY_R/verify" "$AD" '{"approve":true}'); assert "$code" 200 "receipt approved"
[[ $(sql "SELECT status FROM installments WHERE id='$INST_A'") == "PAID" ]] || { echo 'FAIL approval did not pay'; exit 1; }
note "approval settled the installment"
[[ $(sql "SELECT status FROM contracts WHERE id='$CON_A'") == "SETTLED" ]] || { echo 'FAIL contract not completed'; exit 1; }
note "contract completed"
code=$(req GET "$BASE/portal" "$A")
[[ $(field 'x.summary.confirmedPaid') == "$TOTAL_A" ]] || { echo 'FAIL confirmed total'; exit 1; }
note "portal payment status reflects the confirmed amount"

# PDF receipt access.
code=$(req GET "$BASE/payments/$PAY_R/receipt" "$A"); assert "$code" 200 "owner can access receipt data"
node -e "
const r=JSON.parse(require('fs').readFileSync('$TMP/body','utf8')).receipt;
['receiptNo','contractNo','customer','amount','method','paidAt','verifiedBy'].forEach(k=>{if(r[k]===undefined){console.error('FAIL receipt missing '+k);process.exit(1)}});
console.log('PASS receipt contains required details');
"; pass=$((pass+1))
# Customer B must not access A's receipt.
code=$(req GET "$BASE/payments/$PAY_R/receipt" "$B"); assert "$code" 404 "customer B cannot access A's receipt"

# ---------- Document upload + unauthorized access ----------
printf '%%PDF-1.4\n1 0 obj\n<<>>\nendobj\n%%%%EOF\n' > "$TMP/receipt.pdf"
code=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -b "$A" -F 'category=RECEIPT' -F "file=@$TMP/receipt.pdf;type=application/pdf" "$BASE/customers/$CID_A/documents")
assert "$code" 201 "customer A uploads a document"
DOC_A=$(field 'x.document.id')
# A cannot upload against B's profile.
code=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -b "$A" -F 'category=RECEIPT' -F "file=@$TMP/receipt.pdf;type=application/pdf" "$BASE/customers/$CID_B/documents")
assert "$code" 404 "customer A cannot upload to B's profile"
# B cannot download A's document.
code=$(req GET "$BASE/documents/$DOC_A" "$B"); assert "$code" 404 "customer B cannot download A's document"
code=$(req GET "$BASE/documents/$DOC_A" "$A"); assert "$code" 200 "owner can download their document"
note "document access is ownership-scoped"
# Upload validation.
printf 'not a real image at all' > "$TMP/fake.jpg"
code=$(curl -sS --max-time 15 -o "$TMP/body" -w "%{http_code}" -b "$A" -F 'category=RECEIPT' -F "file=@$TMP/fake.jpg;type=image/jpeg" "$BASE/customers/$CID_A/documents")
assert "$code" 400 "upload content is validated server-side"

# ---------- Customer without a linked profile ----------
NONE_ID=$(psql "$DATABASE_URL" -Atc "INSERT INTO customers(first_name,last_name,full_name,national_code,mobile,credit_limit) VALUES('بدون','پرونده','بدون پرونده','$(ncode 998877665)','09125550009',0) RETURNING id" | head -1)
psql "$DATABASE_URL" -q -c "DELETE FROM customers WHERE id='$NONE_ID';" >/dev/null
HASH_N=$(node -e "console.log(require('bcryptjs').hashSync('PortalTest123',12))")
NID=$(psql "$DATABASE_URL" -Atc "INSERT INTO users(username,password_hash,full_name,role) VALUES ('portal_t_none','$HASH_N','بدون پرونده','CUSTOMER') RETURNING id" | head -1)
if [[ -n "$NID" ]]; then
  code=$(req POST "$BASE/auth/login" "$TMP/n.jar" '{"username":"portal_t_none","password":"PortalTest123"}') || true
  : >"$TMP/n.jar"
  req POST "$BASE/auth/login" "$TMP/n.jar" '{"username":"portal_t_none","password":"PortalTest123"}' >/dev/null
  code=$(req GET "$BASE/portal" "$TMP/n.jar"); assert "$code" 404 "user without a customer profile gets no portal data"
  psql "$DATABASE_URL" -q -c "DELETE FROM refresh_tokens WHERE user_id='$NID'; DELETE FROM users WHERE id='$NID';" >/dev/null
fi

echo "PORTAL_INTEGRATION_OK assertions=$pass"
