#!/usr/bin/env bash
# Stage 13: frontend navigation, role integration, RTL/responsive shell, theme
# persistence, global search isolation, all required pages and print surfaces.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"; cd "$ROOT"
if [[ -f .env ]]; then set -a; source .env; set +a; fi
: "${DATABASE_URL:?DATABASE_URL is required}"
BASE="http://127.0.0.1:3000"; TMP=$(mktemp -d)
ADMIN_TOKEN=""; CUSTOMER_TOKEN=""; OP_TOKEN=""; ORIG_STORE=""; ORIG_PREFS=""

cleanup(){
  for token in "$ADMIN_TOKEN" "$CUSTOMER_TOKEN" "$OP_TOKEN"; do
    [[ -z "$token" ]] && continue
    hash=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$token")
    psql "$DATABASE_URL" -q -c "DELETE FROM refresh_tokens WHERE token_hash='$hash';" >/dev/null 2>&1 || true
  done
  [[ -n "$ORIG_STORE" ]] && psql "$DATABASE_URL" -q -c "UPDATE settings SET value='$ORIG_STORE'::jsonb WHERE key='store';" >/dev/null 2>&1 || true
  if [[ -n "$ORIG_PREFS" ]]; then
    IFS='|' read -r t p d <<<"$ORIG_PREFS"
    psql "$DATABASE_URL" -q -c "UPDATE users SET pref_theme='$t', pref_palette='$p', pref_fa_digits='$d' WHERE username='admin';" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}; trap cleanup EXIT

pass=0
assert(){ [[ "$1" == "$2" ]] || { echo "FAIL $3 expected=$2 got=$1" >&2; exit 1; }; pass=$((pass+1)); echo "PASS $3"; }
note(){ pass=$((pass+1)); echo "PASS $1"; }
sql(){ psql "$DATABASE_URL" -Atc "$1"; }
mk_session(){
  local username=$1; local token="ui-${username}-$(date +%s)-$RANDOM"; local hash
  hash=$(node -e "console.log(require('crypto').createHash('sha256').update(process.argv[1]).digest('hex'))" "$token")
  psql "$DATABASE_URL" -q -c "INSERT INTO refresh_tokens(token_hash,user_id,expires_at) SELECT '$hash', id, now()+interval '1 day' FROM users WHERE username='$username';" >/dev/null
  echo "$token"
}
fetch(){ # token, path, output
  curl -sS --max-time 30 -H "Cookie: refresh_token=$1" "$BASE$2" -o "$3" -w "%{http_code}"
}
contains(){ grep -q "$2" "$1" || { echo "FAIL missing text: $2"; exit 1; }; note "$3"; }

# Wait for the managed preview.
for _ in $(seq 1 40); do curl -fsS --max-time 2 "$BASE/api/health" >/dev/null 2>&1 && break; sleep .25; done

ADMIN_TOKEN=$(mk_session admin)
CUSTOMER_TOKEN=$(mk_session customer1)
OP_TOKEN=$(mk_session operator)
ADMIN_ID=$(sql "SELECT id FROM users WHERE username='admin'")
CUSTOMER_ID=$(sql "SELECT customer_id FROM users WHERE username='customer1'")
CUSTOMER_DETAIL=$(sql "SELECT id FROM customers ORDER BY created_at LIMIT 1")
CONTRACT_ID=$(sql "SELECT id FROM contracts ORDER BY created_at LIMIT 1")
OWN_CONTRACT=$(sql "SELECT id FROM contracts WHERE customer_id='$CUSTOMER_ID' ORDER BY created_at LIMIT 1")
CONFIRMED_PAYMENT=$(sql "SELECT id FROM payments WHERE status='CONFIRMED' ORDER BY created_at DESC LIMIT 1")

# ---------- Public/login ----------
code=$(curl -sS --max-time 20 -o "$TMP/login.html" -w "%{http_code}" "$BASE/login")
assert "$code" "200" "login page renders"
contains "$TMP/login.html" "ورود به حساب کاربری" "login form has Persian labels"
grep -q 'font-family: "Vazirmatn"' src/app/globals.css && [[ -s public/fonts/Vazirmatn-Regular.woff2 ]] || { echo "FAIL local Vazirmatn font missing"; exit 1; }
note "Vazirmatn is loaded locally"

# ---------- Staff route navigation ----------
declare -a ROUTES=(
  "/" "/customers" "/customers/new" "/customers/$CUSTOMER_DETAIL"
  "/contracts" "/contracts/new" "/contracts/$CONTRACT_ID" "/contracts/$CONTRACT_ID/print"
  "/installments" "/payments" "/payments/verification" "/reports" "/reports/print?report=income"
  "/sms" "/settings" "/users" "/audit" "/profile"
)
for route in "${ROUTES[@]}"; do
  safe=$(echo "$route" | tr '/?&=' '____')
  code=$(fetch "$ADMIN_TOKEN" "$route" "$TMP/admin${safe}.html")
  assert "$code" "200" "admin navigation $route"
done

# ---------- Required page content ----------
contains "$TMP/admin_.html" "داشبورد" "dashboard content"
contains "$TMP/admin_customers.html" "مشتری جدید" "customer list and create link"
contains "$TMP/admin_customers_new.html" "کد ملی" "customer form validation fields"
contains "$TMP/admin_customers_$CUSTOMER_DETAIL.html" "امتیاز اعتباری" "customer credit report"
contains "$TMP/admin_contracts.html" "قرارداد جدید" "contract list"
contains "$TMP/admin_contracts_new.html" "روز پرداخت ماهانه" "new contract wizard"
contains "$TMP/admin_contracts_$CONTRACT_ID.html" "جدول اقساط" "contract detail schedule"
contains "$TMP/admin_installments.html" "اقساط معوقه" "installment management"
contains "$TMP/admin_payments.html" "همه پرداخت‌ها" "payment management"
contains "$TMP/admin_payments_verification.html" "صف بررسی" "payment verification page"
contains "$TMP/admin_reports.html" "گزارش‌های مالی و عملیاتی" "reports page"
contains "$TMP/admin_sms.html" "مدیریت پیامک" "SMS management page"
contains "$TMP/admin_settings.html" "اطلاعات و برندینگ فروشگاه" "administrative settings"
contains "$TMP/admin_profile.html" "تغییر رمز عبور" "profile and password management"
contains "$TMP/admin_profile.html" "نشست‌های فعال" "session management"

# ---------- Global shell ----------
SHELL="$TMP/admin_.html"
contains "$SHELL" 'dir="rtl"' "full RTL document"
contains "$SHELL" 'lang="fa"' "Persian document language"
contains "$SHELL" "جستجوی مشتری، قرارداد یا پیگیری" "global search input"
contains "$SHELL" "اعلان‌ها" "notification center"
contains "$SHELL" "منوی کاربری" "profile menu"
contains "$SHELL" "پوسته رنگی" "palette selector"
contains "$SHELL" "تغییر حالت روشن/تیره" "theme switcher"
contains "$TMP/admin_customers_new.html" "مسیر صفحه" "accessible breadcrumbs"
contains "$SHELL" "max-lg:translate-x" "responsive sidebar classes"
contains "$SHELL" "lg:pe-68" "desktop shell offset"
contains "$SHELL" "باز کردن منو" "mobile menu control"

# Store logo + name in header/sidebar (temporary local logo path).
ORIG_STORE=$(sql "SELECT value::text FROM settings WHERE key='store'")
psql "$DATABASE_URL" -q -c "UPDATE settings SET value = value || '{\"logoUrl\":\"/icon-192.png\",\"storeName\":\"فروشگاه رابط آزمون\"}'::jsonb WHERE key='store';" >/dev/null
code=$(fetch "$ADMIN_TOKEN" "/" "$TMP/logo.html"); assert "$code" "200" "shell with store branding renders"
contains "$TMP/logo.html" "/icon-192.png" "store logo shown"
contains "$TMP/logo.html" "فروشگاه رابط آزمون" "store name shown"

# ---------- Theme/palette/digit persistence ----------
ORIG_PREFS=$(sql "SELECT pref_theme||'|'||pref_palette||'|'||pref_fa_digits FROM users WHERE id='$ADMIN_ID'")
psql "$DATABASE_URL" -q -c "UPDATE users SET pref_theme='dark', pref_palette='teal', pref_fa_digits=false WHERE id='$ADMIN_ID';" >/dev/null
code=$(fetch "$ADMIN_TOKEN" "/profile" "$TMP/theme.html"); assert "$code" "200" "profile with stored theme renders"
contains "$TMP/theme.html" 'class="dark"' "dark mode applied server-side"
contains "$TMP/theme.html" 'data-palette="teal"' "teal palette applied server-side"
for color in "آبی" "سبز" "بنفش" "نارنجی" "فیروزه‌ای" "رز"; do
  grep -q "$color" "$TMP/theme.html" || { echo "FAIL palette missing: $color"; exit 1; }
done
note "all six color palettes are available"

# ---------- Breadcrumb route ----------
contains "$TMP/admin_customers_new.html" "خانه" "breadcrumb home link"
contains "$TMP/admin_customers_new.html" "مشتریان" "breadcrumb section label"
contains "$TMP/admin_customers_new.html" "ثبت جدید" "breadcrumb current page"

# ---------- Global search, backed by real DB ----------
code=$(curl -sS --max-time 15 -o "$TMP/search-admin.json" -w "%{http_code}" -H "Cookie: refresh_token=$ADMIN_TOKEN" "$BASE/api/search?q=%D8%B9%D9%84%DB%8C")
assert "$code" "200" "admin global search API"
node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/search-admin.json'));if(!x.results.some(r=>r.type==='customer'))process.exit(1)" || { echo "FAIL admin search missing real customer"; exit 1; }
note "global search returns real customer records"
code=$(curl -sS --max-time 15 -o "$TMP/search-customer.json" -w "%{http_code}" -H "Cookie: refresh_token=$CUSTOMER_TOKEN" "$BASE/api/search?q=%D9%85%D8%B1%DB%8C%D9%85")
assert "$code" "200" "customer global search API"
node -e "const x=JSON.parse(require('fs').readFileSync('$TMP/search-customer.json'));if(x.results.length!==0)process.exit(1)" || { echo "FAIL customer search leaked foreign customer"; cat "$TMP/search-customer.json"; exit 1; }
note "customer global search cannot leak another customer"

# ---------- Customer role navigation ----------
code=$(fetch "$CUSTOMER_TOKEN" "/portal" "$TMP/portal.html"); assert "$code" "200" "customer portal navigation"
contains "$TMP/portal.html" "خلاصه حساب شما" "customer dashboard"
contains "$TMP/portal.html" "برنامه اقساط من" "customer schedule"
contains "$TMP/portal.html" "سوابق پرداخت" "customer payment history"
code=$(fetch "$CUSTOMER_TOKEN" "/profile" "$TMP/profile-customer.html"); assert "$code" "200" "customer profile navigation"
contains "$TMP/profile-customer.html" "خروج از همه دستگاه‌ها" "customer session controls"
for route in /customers /contracts /installments /payments /reports /sms /settings /users /audit; do
  curl -sS --max-time 15 -o "$TMP/blocked.html" -H "Cookie: refresh_token=$CUSTOMER_TOKEN" "$BASE$route"
  # Next.js may begin streaming the layout before a nested page redirects; in
  # that case HTTP is 200 but NEXT_REDIRECT;/portal;307 is embedded in the RSC.
  grep -q 'NEXT_REDIRECT;replace;/portal;307' "$TMP/blocked.html" || { echo "FAIL customer not blocked from $route"; exit 1; }
  note "customer blocked from staff page $route"
done
# Customer may access only an owned contract detail.
code=$(fetch "$CUSTOMER_TOKEN" "/contracts/$OWN_CONTRACT" "$TMP/own-contract.html"); assert "$code" "200" "customer can open own contract detail"
FOREIGN=$(sql "SELECT id FROM contracts WHERE customer_id<>'$CUSTOMER_ID' ORDER BY created_at LIMIT 1")
curl -sS --max-time 15 -o "$TMP/foreign-contract.html" -H "Cookie: refresh_token=$CUSTOMER_TOKEN" "$BASE/contracts/$FOREIGN"
grep -Eq 'NEXT_HTTP_ERROR_FALLBACK;404|صفحه یافت نشد' "$TMP/foreign-contract.html" || { echo "FAIL customer can open another customer's contract"; exit 1; }
note "customer cannot open another customer's contract"

# ---------- Print/PDF surfaces ----------
code=$(fetch "$ADMIN_TOKEN" "/contracts/$CONTRACT_ID/print" "$TMP/contract-print.html"); assert "$code" "200" "print-friendly contract layout"
contains "$TMP/contract-print.html" "چاپ / ذخیره PDF" "contract print control"
code=$(curl -sS --max-time 30 -o "$TMP/receipt.pdf" -w "%{http_code}" -H "Cookie: refresh_token=$ADMIN_TOKEN" "$BASE/api/receipts/$CONFIRMED_PAYMENT")
assert "$code" "200" "authorized PDF receipt access"
[[ $(head -c 5 "$TMP/receipt.pdf") == "%PDF-" ]] || { echo "FAIL receipt is not a PDF"; exit 1; }
note "receipt route returns a real PDF"
code=$(fetch "$ADMIN_TOKEN" "/reports/print?report=income" "$TMP/report-print.html"); assert "$code" "200" "print-friendly report layout"
contains "$TMP/report-print.html" "receipt-sheet" "report print sheet"

# ---------- Filters, date pickers, pagination, empty/loading states ----------
contains "$TMP/admin_reports.html" "انتخاب تاریخ" "Jalali report date pickers"
contains "$TMP/admin_customers.html" "همه وضعیت‌ها" "customer filters"
contains "$TMP/admin_contracts.html" "همه انواع" "contract filters"
contains "$TMP/admin_payments.html" "همه روش‌ها" "payment filters"
grep -q "Skeleton" "src/app/(app)/loading.tsx" || { echo "FAIL loading skeleton missing"; exit 1; }
note "global loading skeleton implemented"
grep -Rqs "EmptyState" "src/app/(app)" || { echo "FAIL empty states missing"; exit 1; }
note "empty states integrated across pages"

# ---------- Dedicated page navigation in sidebar ----------
for label in "بررسی پرداخت‌ها" "مدیریت پیامک" "پروفایل و نشست‌ها"; do
  grep -q "$label" "$SHELL" || { echo "FAIL sidebar/menu missing $label"; exit 1; }
done
note "dedicated verification, SMS and profile pages are navigable"

echo "FRONTEND_INTEGRATION_OK assertions=$pass"
