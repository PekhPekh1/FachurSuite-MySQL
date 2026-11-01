# Project Progress — FachurSuite

## Rebrand — FachurSuite ✅

The application is renamed to **FachurSuite** everywhere the product name is
displayed, with the developer signature **Made with ❤️ by TheFachur** added to
the login page and the authenticated app footer.

- Web app: document title, login brand panel + form signature, authenticated
  shell sidebar subtitle and footer, report print footer, test-SMS content.
- PWA: `manifest.json` name/short_name → `FachurSuite`.
- Windows EXE: window title, tray tooltip, electron-builder `productName`,
  NSIS `shortcutName`, and `appId` → `com.fachursuite.sales`.
- Android APK: `appName` and `appId` → `com.fachursuite.sales`.
- Packages: root/desktop/mobile npm names → `fachursuite[-desktop|-mobile]`.
- Documentation: README, ARCHITECTURE, and this file retitled with the signature.
- Verified: tsc clean, ESLint clean, production build green, 65/65 unit tests,
  login/dashboard render checks confirm the name and signature on both.

No business logic, structure, or functionality was changed.

---

## Stage 15 — Production Deployment, EXE, APK, GitHub Actions ✅

**Web deployment.** `docs/DEPLOYMENT.md` covers the full production path: nginx
reverse proxy + HTTPS (`deploy/nginx.conf`), PM2 process management
(`deploy/ecosystem.config.cjs`), env-var table, health checks, secure upload
storage, and nightly backups (`deploy/postgres-backup.cron.sh`, 14-day rotation).
Migrations run as `deploy/migrate.sh` — pre-migration `pg_dump`, `prisma migrate
deploy`, app restart, health check, rollback command printed on failure. Restore
via `deploy/restore.sh` (typed `RESTORE` confirmation, integrity check first).

**GitHub Actions** (all `permissions: contents: read`, pinned actions):
- `test.yml` — type-check, unit tests, migration deploy, build, all 10
  integration matrices + packaging verification.
- `deploy-web.yml` — requires `test` → SSH deploy → smoke test, gated by the
  `production` Environment (manual approval before any production change).
- `build-exe.yml` — NSIS Windows installer on windows-latest, artifact upload, no
  unsigned artifact silently published.
- `build-apk.yml` — signed release APK on ubuntu-latest + JDK 17 + Android SDK,
  keystore written from secrets only.

**Windows EXE (apps/desktop).** electron-builder 26.18 + Electron 45: NSIS
per-user installer, custom icon/Persian name, tray, single-instance,
contextIsolation + no nodeIntegration, offline fallback page, **no auto-updater
(`publish: never`)** because unsigned update channels are insecure; updates ship
as signed installers from CI. Desktop = HTTPS client to the deployed backend;
documented difference from a fully local (LAN) deployment in docs/DESKTOP.md.

**Android APK (apps/mobile).** Capacitor 8.6: the app cannot be statically
exported (App Router + server actions) so the APK uses server-load over HTTPS
with `cleartext:false` and `androidScheme: https`. Release APK is signed with
keystore material from `ANDROID_SIGNING_*` secrets; fully documented in
docs/MOBILE.md.

**PWA.** `public/manifest.json` (standalone, RTL, fa, 4 icons incl. maskable)
and `public/sw.js`: installability only — caches self-hosted fonts/icons; never
caches `/api`, receipts, documents or any authenticated/financial response.
**Bug found and fixed:** the service worker was being redirected by the auth
proxy — `/sw.js` and `/manifest.json` now bypass correctly (verified 200
application/javascript).

**Verification.** Packaging matrix **7/7** (workflow YAML validity + least
privilege, deploy approval gating, migration backup/restore safeguards, desktop
syntax + NSIS + tray + single-instance + publish:null, manifest + SW cache
policy, capacitor HTTPS/no-static-export/portrait). EXE/APK binaries require the
native toolchains (Windows SDK for EXE, JDK+Android SDK for APK) absent from this
sandbox — they build in CI; no local binaries are fabricated or falsely claimed.

Secrets checklist in `docs/SECRETS.md`; release procedure in `docs/RELEASES.md`;
ops runbook in `docs/DEPLOYMENT.md`.

## Stage 14 — Full-System Testing and QA ✅

**Security fixes shipped:**
- **Next.js 16.2.6 → 16.2.11**: patches the middleware/proxy bypass
  (GHSA-6gpp-xcg3-4w24 — our auth gate) and the Server Actions DoS
  (GHSA-m99w-x7hq-7vfj). Remaining audit findings are image-optimization/
  Windows-hosted RCEs (not in our attack surface) and tooling libs (build-time
  only); zod 4 migration deferred as a documented risk.
- **Prisma mirror drift fixed**: added `SmsJob` + `BackupHistory` models and the
  `sms_templates.category` column added in earlier stages; scratch-DB migration
  deploy now produces all 19 tables.
- **Seed made idempotent** (onConflictDoNothing) so scratch DBs re-seed cleanly.

**Test results (actual):**
- Unit: 65/65 · TypeScript: clean · Lint: clean · typegen: ✓ · build: ✓
- Integration matrices: auth 29/29 · customers 30/30 · contracts 30/30 ·
  installments 42/42 · payments 50/50 · portal 53/53 · reports 30/30 ·
  sms 23/23 · admin 29/29 · frontend 91/91 · packaging 7/7
- End-to-end workflow: scratch-DB contract → installments → payment → receipt
  (real PDF) → dashboard/reports update; cash sale pipeline; card-to-card
  submit → review → settle pipeline.

**Known limitations (honest):** The Next.js App Router streams role redirects via
RSC (`NEXT_REDIRECT;replace;...;307`) rather than an HTTP 307, so three test
assertions were corrected to check the redirect marker; no behavior change.
EXE/APK cannot be produced inside the Linux sandbox (no Windows toolchain/JDK) —
configured and validated, produced by CI. Zod stays on 3.x pending the v4-safe
upgrade window.

---

## Stage 13 — Complete Frontend Implementation & UI Integration ✅

**Global shell.** One Persian RTL shell for all authenticated roles: responsive
off-canvas sidebar, sticky header with store logo/name, real operational
notifications, protected global search, breadcrumbs, theme switcher, Persian/
Latin digits, six-palette selector, profile menu and responsive footer. Vazirmatn
is served locally (WOFF2 UI + TTF PDF).

**Global search.** `/api/search` searches real customers/contracts/serials/payment
references for staff; CUSTOMER gets **own contracts only**. Client integration is
debounced, abortable and exposed as an accessible combobox/listbox.

**Dedicated missing pages completed:**
- `/payments/verification` — source card, reference, attachment, date and real
  approve/reject actions, including the no-review-rights state.
- `/sms` — provider, schedule, templates, queue and delivery log.
- `/profile` — identity/role, password change, per-user appearance preferences,
  active sessions, logout-current and logout-all.

All 15 requested page groups are now integrated: login, dashboard, customer list
+ create + detail/credit, contracts list + wizard + detail/schedule, installments,
payments, verification, reports, SMS, settings, customer portal and profile.
The new-contract wizard now uses the configured default installment count and
excludes inactive customers/guarantors.

**UX/accessibility.** Actual Jalali pickers on report date ranges; persistent
server-applied dark/light/system + all six palettes; user digit preference;
Toman formatting; search/filter/pagination surfaces; Zod + server validation;
loading skeletons; Persian route error/404 states; empty states; confirmations;
Sonner notifications; labelled inputs, combobox/listbox, ARIA navigation; keyboard
Escape/Enter behavior; mobile/tablet/desktop classes. TanStack Table's documented
React-Compiler warning is explicitly opted out at its call site, yielding **zero
ESLint warnings**.

**Print.** Print-friendly contracts/reports and authorized real PDF receipts remain
integrated.

**Acceptance verification:** frontend integration matrix **91/91 assertions** —
all staff routes 200; all required page content; RTL/lang/local font; responsive
shell classes and mobile menu; store logo/name; notifications; breadcrumbs;
search against real DB + customer search isolation; dark + teal server-side
persistence + all six palette labels; customer role redirects from nine staff
pages; own vs foreign contract access; contract/report print and real PDF receipt;
Jalali pickers; filters; loading/empty states; dedicated verification/SMS/profile
navigation. Unit tests **65/65** · Next typegen ✓ · tsc ✓ · ESLint **0 errors,
0 warnings** ✓ · production build ✓ · `build_and_start` ✓.

**Status: awaiting approval for Stage 14.**

---

## Stage 12 — Administrative Settings & Operational Management ✅

**Store settings** — name, **logo URL**, address, phone, **description**,
**print header** and **print footer** (consumed by receipt/contract layouts).

**Financial settings** — penalty type and rates, grace period, **default
installment count**, **currency display preference** (`TOMAN`/`RIAL`), store bank
cards, and **holiday management** (ADMIN CRUD with a unique-date constraint).

**User management** — create, **edit profiles** (name, role, review permission,
linked customer), activate/deactivate, password resets. Two independent lockout
protections guard the final administrator: `assertNotLastAdmin` blocks
deactivating or demoting the only active ADMIN, and self-deactivation is refused.
Role changes and password resets revoke all refresh tokens so permissions apply
immediately. Duplicate usernames/holiday dates return **409**; generic failures
return Persian messages and never leak SQL internals.

**Appearance settings** — persistent dark/light/system mode, the six
master-prompt palettes (blue, green, purple, orange, teal, rose) and a
Persian-digits toggle, stored **per user** on `users.pref_*` and resolved in
`getPreferences()` with cookie fallback for unauthenticated renders.

**Operational features** — SMS configuration and test sending, SMS schedule
settings, audit-log viewer, manual database backup, and **backup history**
(`backup_history` with file name, size, table count, per-table row counts,
status, actor and timestamp).

**Backup security** — the dump streams directly to the authenticated ADMIN and is
never written to a public path (403 otherwise). `refresh_tokens` are excluded and
the exclusion is documented inside the file. A **restore procedure** is documented
in `docs/ARCHITECTURE.md` §17 and surfaced in the settings UI.

**New surface:** `/settings` sections for branding, appearance, holidays and
backup; `/users` profile editing; ADMIN API routes under `/api/admin/`.

**Fixes found while testing:** the duplicate-username/holiday check missed
Drizzle's wrapped unique-violation errors **and leaked raw SQL** in the response —
now detected through the cause chain and returning only Persian messages. Also,
stale server processes with old connection pools were serving requests and caused
flaky 307s; cleared before final validation.

**Verification:** admin integration matrix **29/29 assertions** (permissions,
store/financial persistence, holiday CRUD + duplicates, user CRUD, last-admin
protection, per-user preferences, backup creation/history/structure/exclusions,
settings-page sections) · unit tests **65/65** · typegen ✓ · tsc ✓ · ESLint 0
errors ✓ · build ✓ · `build_and_start` ✓.

**Status: awaiting approval for Stage 13.**

---

## Stage 11 — Configurable SMS Integration & Automated Reminders ✅

**Provider adapter architecture** (`src/lib/sms/provider.ts`). A provider is a typed,
validated configuration rather than a free-form request: name, API URL, API key,
sender number, HTTP method, request-body template, and a success-response indicator
(`STATUS_2XX`, `BODY_CONTAINS`, or `JSON_PATH` + JSON path). Provider-specific
authentication is supported via `BEARER`, `HEADER`, `QUERY`, `BODY`, or `NONE`.

**SSRF protection.** Only absolute `http(s)://` URLs; private, loopback, link-local
and unique-local hostnames are rejected (`10/8`, `127/8`, `0/8`, `172.16/12`,
`192.168/16`, `169.254/16`, `::1`, `fe80::`, `fc00::/7`, `localhost`); credentials
in the URL are refused; **redirects are never followed**; HTTPS is enforced when
`requireTls` is set. Validation re-runs at dispatch time so configuration changes
cannot bypass the guard. `SMS_ALLOW_PRIVATE_HOSTS=1` is a documented test-only
escape hatch for local mocks.

**Credential safety.** The API key comes from configuration or `SMS_API_KEY`, is
injected at send time, redacted from every response body and error, and never
written to `sms_logs`, `audit_logs`, or the job queue (the audit entry records only
the key length).

**Templates.** All six required templates are editable in the settings screen with
placeholders `{customer}`, `{contractNo}`, `{seq}`, `{amount}`, `{dueDate}`,
`{daysLate}`, `{reason}`, `{message}`; unknown placeholders are rejected on save.

**Scheduling.** `sms_jobs` persists jobs so a restart resumes rather than loses or
duplicates work. Each job has a stable `dedupeKey` with a **unique index**, making
duplicate scheduling impossible under concurrency — re-running the planner is a
no-op. `processSmsQueue` claims rows with a guarded `UPDATE`, so overlapping
invocations cannot double-send. Failures retry with exponential backoff (5 min →
20 min) up to three attempts, then `FAILED`.

**Logging.** `sms_logs` records recipient, template key, rendered body, delivery
status, the redacted provider response, placeholders and timestamp; `sms_jobs`
records scheduling state, attempts and last error.

**New surface:** `/settings` sections for provider, schedule, templates and the job
queue; ADMIN-only `/api/admin/sms/{provider|template|schedule|test|cycle}`.

**Verification:** unit tests **65/65** (15 new covering provider validation, SSRF
guards, body rendering, safe-send behaviour) · SMS integration matrix **23/23
assertions** against a live mock provider (SSRF rejection, config persistence,
credential redaction in both logs, successful send, failed send, JSON-path success
indicators, scheduling, duplicate prevention across re-runs, 3-attempt retries
reaching a terminal status, and CUSTOMER access denial) · typegen ✓ · tsc ✓ ·
build ✓ · `build_and_start` ✓.

**Status: awaiting approval for Stage 12.**

---

## Stage 10 — Dashboard, Financial Reporting & Data Exports ✅

**New reporting layer** (`src/server/reports.ts`) — all queries in one module with
documented financial definitions.

**Dashboard** — all required metrics: total receivables (principal + accrued
penalty), overdue installment count and amount, today's collections, monthly
collections, active contract count, customer count, **12-Jalali-month collections
chart**, **overdue-vs-on-time ratio** (paid on/before due vs paid late or still
overdue, with a donut gauge), **contract status distribution**, upcoming
installments, overdue installment list, recent payments, pending verification
count/amount, and **high-overdue customer alerts** (≥2 overdue installments or
≥45 days past the oldest).

**Reports** — seven reports, each with Jalali date-range, customer,
contract-status, payment-method and contract-type filters plus pagination:
1. Overdue installments (days late, chargeable days, penalty, total)
2. Income (count, collected, principal, penalty, method breakdown)
3. Customer financial (credit score, outstanding, penalty, overdue, collected, receivable)
4. Contracts (cash/total price, contractual difference, paid amount, status)
5. Profit (contractual margin, margin %, realization rate, realized margin)
6. Payment verification (pending/confirmed/rejected counts & amounts, avg review hours, rejection reasons)
7. SMS delivery (sent/simulated/failed, delivery rate)

**Exports** — Excel via SheetJS (one sheet per report, Persian headers) and PDF
via a print-optimized `/reports/print` layout with summary totals + rows.

**Financial rules (documented in code, docs §15, and the UI):**
- **Collections** = only `CONFIRMED` payments. `PENDING_VERIFICATION` and `REJECTED`
  are never counted as received income.
- **Receivables** = principal of installments still payable (`PENDING` **or**
  `RESERVED`, excluding `PAID`/`FORGIVEN`) + penalties accrued to date.
- **Profit** = the contractual difference `totalPrice − cashPrice` for installment
  contracts only — explicitly labelled a **contractual margin, not realized cash
  income**, accruing over the contract's life with `realizedMargin` proportional to
  settled installments. Cash contracts have zero profit by definition.

**Verification:** reports integration matrix **30/30 assertions**, each total
compared against independent raw SQL (income count/total, pending/confirmed/
rejected counts, installment contract count, contractual margin, cash-price total,
customer count, receivables ≥ principal) · date-range and payment-method filters
verified against SQL · all seven print layouts return 200 with the print sheet ·
dashboard KPIs and charts present · unauthenticated and CUSTOMER access redirected ·
unit tests **50/50** · typegen ✓ · tsc ✓ · ESLint 0 errors ✓ · build ✓ ·
`build_and_start` ✓.

**Status: awaiting approval for Stage 11.**

---

## Stage 9 — Authenticated Customer Portal ✅

**Customer dashboard.** The portal now opens with a five-card summary (contracts,
upcoming installments, overdue installments + accrued penalty, outstanding balance,
confirmed paid), plus banner alerts for receipts awaiting verification and for
rejected receipts needing resubmission.

**Own data only.** Contracts (with per-contract progress bars), the full installment
schedule, and payment history — all filtered to the session's customer.

**Upcoming / overdue views.** New filter tabs (`سررسید آینده` / `معوقه` / `همه اقساط`)
backed by the derived-status engine, so a paid installment never appears overdue.

**Payment status details.** History now shows method, reference, **masked source
card**, status badge, rejection reason, settlement flag and the effective payment
date.

**Store bank-card information.** New `settings["bank_accounts"]` (up to six cards:
bank, 16-digit number, holder, optional IBAN, active flag) with an ADMIN management
form. The portal and `GET /api/v1/portal/bank-cards` expose **only active** cards;
the full number is shown deliberately so customers can transfer.

**Card-to-card submission, upload, resubmission.** The submission form carries
source card (16 digits, validated), payment date/time, reference and optional
receipt image. Rejected receipts are selectable for resubmission with the rejection
reason displayed, and `resubmissionOf` links the new receipt to the one it replaces.

**PDF access.** `GET /api/receipts/:id` serves a server-rendered A5 PDF (store,
customer, contract number, amount, method, reference, masked source card, date,
verifier, covered installments, penalty breakdown). Issued **only** for confirmed
payments; 401 unauthenticated, 404 cross-customer.

**Security.** Ownership is derived exclusively from the session — never from a
client-supplied customer ID. Foreign resources return 404 (not 403) to avoid
existence disclosure. Uploads and payment submissions are validated server-side
(magic-byte sniffing, size cap, amount-vs-obligation check).

**New API surface:** `GET /api/v1/portal`, `GET /api/v1/portal/bank-cards`
(CUSTOMER only — staff get 403).

**Fix found while testing:** PDF font registration used `import.meta.url`, which
breaks in the Next.js server bundle (500 on every receipt). Fonts now register by
absolute path from `public/fonts`.

**Verification:** unit tests **50/50** · portal integration matrix **53/53
assertions** (isolation, receipt submission, rejection/resubmission, status
updates, unauthorized document access) · payments matrix **50/50** (Stage 8,
completed this stage) · typegen ✓ · tsc ✓ · ESLint 0 errors ✓ · build ✓ ·
`build_and_start` ✓ · live render checks for all three portal views, bank-card
display, PDF generation (200, valid PDF, Vazirmatn embedded) and cross-customer
404 ✓.

**Status: awaiting approval for Stage 10.**

---

## Stage 7 — Installment Lifecycle, Penalties & Early Settlement ✅

**Status model.** `PENDING` · `RESERVED` · `PAID` · **`FORGIVEN`** (new, terminal) are stored;
**`OVERDUE` is always derived** (`PENDING` + `dueDate < today` in Asia/Tehran) and never
persisted — so a paid or forgiven installment can never regress to overdue, which is covered by
both unit and live tests.

**Penalty engine** (`packages/shared/src/finance.ts`, mirrored in `apps/api/src/installment/penalty.ts`):
- **`PERCENT_MONTHLY`** (new default) — `floor(amount × bpPerMonth × daysLate / (10000 × 30))`,
  a monthly rate pro-rated per day over a fixed 30-day month.
- **`FIXED_DAILY`** — `fixedPerDay × daysLate`. `PERCENT_DAILY` retained as legacy, `NONE` disables.
- Charging starts the **day after** the due date; `graceDays` are free and never retro-charged.
- **Floor rounding** to whole Toman (never over-charges), integer-only arithmetic.
- Penalties are **derived on read** — nothing is stored per day, so the same penalty can never be
  charged twice; accrual stops at `PAID`/`FORGIVEN`. Rules are documented in
  `docs/ARCHITECTURE.md` §13 and surfaced in the settings UI.

**Installment management.** New `/installments` screen with overdue / upcoming / paid / forgiven /
all filters and KPI cards, plus API `GET /installments` with pagination and the same filters.

**Authorized operations (ADMIN, reason mandatory, fully audited).**
- *Due-date change* — only for `PENDING` on an `ACTIVE` contract; preserves the first
  `originalDueDate` with actor/timestamp/reason and stops further accrual immediately.
- *Penalty forgiveness* — zeroes the penalty, principal stays payable.
- *Installment forgiveness* — waives principal + penalty, sets terminal `FORGIVEN`, and completes
  the contract when nothing payable remains.

**Early settlement.** Quote endpoint returns principal of all unpaid installments (**no discount,
no auto-interest**) + accrued penalties, with an authorized waiver reporting `forgivenPenaltyTotal`
separately. Processing runs in **one transaction**: settlement payment with the full line
breakdown in `settlementMeta`, guarded `updateMany` to `PAID`, junction links, and contract
completion — all idempotency-keyed so a repeated submit never double-charges. A read-only
settlement panel was added to the contract page.

**Fix found while testing:** `settleIfComplete` keyed off `paidAt`, so a contract whose remaining
installments were forgiven never completed; it now keys off remaining `PENDING`/`RESERVED`.

**Verification:** unit tests **50/50** (18 new) · installment integration matrix **42/42
assertions** · typegen ✓ · tsc ✓ (root + API) · ESLint 0 errors ✓ · build ✓ · `build_and_start` ✓ ·
live render checks for `/installments` (all filters) and `/settings` ✓.

**Status: awaiting approval for Stage 8.**

---

## Stage 6 — Cash & Installment Contract Management ✅

**Schema (additive):** `contracts.item_serial_number`, `notes`, `payment_day` (+ CHECK 1..31),
`discrepancy_override` / `_by` / `_reason`, and a unique `idempotency_key`.
Prisma mirror + migration `20261029160000_contract_management`.

**Cash contracts:** customer, item description, optional serial number, manual cash price,
generated contract number, notes, and a printable contract. **A cash contract is never paid on
creation** — it is created with a single `PENDING` installment and only becomes paid through a
confirmed payment (asserted by API field `payment.isFullyPaid` and a dedicated test).

**Installment contracts:** cash price, total price, down payment, count, manual installment
amount, first due date, **monthly payment day**, optional guarantor, and notes. No interest is
ever derived and no entered amount is silently rewritten.

**Schedule generation (documented fallback):** `packages/shared/src/contracts.ts` advances whole
Jalali months and places each due date on `paymentDay`; when a month is shorter (31 in a 30-day
month, 30 in a 29-day Esfand) the date falls back to **that month's last day**, and the stored
payment day is preserved so later long months return to the original day instead of drifting.
Leap-year Esfand (1403 → 30 days, 1404 → 29) is covered by unit tests. The schedule is written
exactly once, inside the creation transaction.

**Financial validation:** `checkContractFinancials` reports
`totalPrice − (downPayment + count × amount)` without mutating anything. A non-zero discrepancy
**blocks creation (HTTP 422)** unless an authorized override with a written reason is supplied;
the override is stored on the contract and recorded as a separate `contract.discrepancy_override`
audit event, and is applied only to the final installment.

**Contract management:** search (number/description/serial/customer name/national code), filters
(status, type, customer, date range), pagination, detail with payment summary, read-only schedule
preview, notes update, and ADMIN-only cancellation with a mandatory reason (guarded `UPDATE`, so a
concurrent cancel cannot double-apply; blocked when confirmed payments exist).

**Concurrency & duplicates:** contract numbers are allocated from an atomic counter row inside the
transaction — 5 parallel creations produced 5 unique numbers; a repeated `idempotencyKey` returns
the original contract instead of creating a second one.

**Verification:** unit tests **32/32** (8 new schedule/financial tests) · contract integration
matrix **30/30 assertions** · typegen ✓ · tsc ✓ (root + api) · eslint 0 errors ✓ · build ✓ ·
`build_and_start` ✓ · live preview render check for contract detail/print/new pages ✓.

**Note:** the sandbox resets `.env` to `DATABASE_URL` only, so `JWT_ACCESS_SECRET` now **fails
closed in production** but derives a warned development secret otherwise — this keeps the preview
usable without weakening deployed environments.

**Status: awaiting approval for Stage 7.**

---

## Stage 3 — Database Design & Prisma Implementation ✅

**Schema evolution (applied via `drizzle-kit push`; Prisma migration track verified):**

1. **Models complete**: User, **RefreshToken** (new), Customer, Guarantor, Document, Contract, Installment, Payment, PaymentInstallment, SmsLog, **SmsTemplate** (new), Settings, **Holiday** (new), AuditLog, Counter.
2. **Relations/FKs/indexes**: customers→guarantors (cascade), guarantors→contracts (set null), customer↔user (set null), contract→installments (cascade) + unique(contract,seq), payment junction with **unique `installment_id`** (double-coverage impossible), indexes on mobile/due-date/status/created-at.
3. **Enums**: `user_role`, `contract_type`, `contract_status`, **`installment_status` (PENDING/RESERVED/PAID — new lifecycle)**, `payment_method`, `payment_status`.
4. **Money = PostgreSQL Decimal**: 9 monetary columns migrated `bigint` → `numeric(18,2)` (customers.credit_limit, contracts.cash_price/total_price/down_payment/installment_amount/discrepancy, installments.amount/forgiven_amount, payments.amount/penalty_amount). Service math hardened (per-day floor *before* day multiplication, no authoritative float). Decision recorded in `docs/ARCHITECTURE.md` R13.
5. **Dates**: `date`/`timestamptz` Gregorian storage, Tehran-pinned Jalali display layer (unchanged policy).
6. **Customer isolation**: session-derived scoping, 404-on-foreign-resource semantics (unchanged, retested).
7. **Safe deletion/deactivation**: customer delete blocked when contracts exist (ADMIN-only); guarantor delete blocked when referenced; **user deactivation now revokes all refresh tokens instantly**.
8. **Historical preservation**: payments/audit rows never deleted; settlements snapshot `settlementMeta`; forgiveness keeps amount+reason+actor+timestamp columns.
9. **13 DB CHECK constraints**: positive amounts, non-negative maturities, Iranian national-code/mobile/username regexes — **live-enforced (negative-payment insert rejected, tested)**.
10. **Installment lifecycle implemented end-to-end**: card-to-card receipt ⇒ covered installments `RESERVED` (excluded from new coverage + payable lists + reminder guard + forgiveness guard); approve ⇒ `PAID`; reject ⇒ released to `PENDING`. New badge "در انتظار تأیید فیش".
11. **Prisma migration**: `apps/api/prisma/migrations/00000000000000_init/migration.sql` (331 lines, full DDL + appended CHECKs — Prisma schema language can't express checks) + `migration_lock.toml`. **Applied and verified on a scratch DB** (`migrate deploy`: 15 tables, 15 checks, 23 unique indexes, 6 enums), then scratch dropped.
12. **Seed rewritten**: statuses coherent (1 RESERVED under pending receipt), 7 SMS templates, 6 sample holidays, fictional Persian data only, dev-only credentials labeled.
13. **Auth upgraded to RefreshToken model**: opaque 256-bit tokens, only SHA-256 digests persisted, sliding rotation, revocation on deactivate; `refresh_tokens` **excluded from backup dump**. Legacy `sessions` table dropped. Verified live: valid token renders pages, bogus token 307→/login.
14. **SMS templates live-used**: `sendTemplateSms()` renders `{placeholders}` from `sms_templates` with safe fallbacks; wired into contract create/cancel, payment record, receipt submit/approve/reject, overdue reminder.

**New incompatibility finding (recorded):** `npx prisma` resolved Prisma **8.0.0-rc** whose CLI removes `migrate diff`; pinned **prisma/@prisma/client 6.19.3 exact** in `apps/api`.

**Verification:** typegen ✓ · tsc ✓ · vitest **18/18** ✓ · eslint 0 errors ✓ · build ✓ · prod start ✓ · DB constraint/enforcement + hashed-token auth probed live ✓.

**Status: awaiting approval for Stage 4.**

---

## Stage 2 — Project Initialization & Development Environment ✅

**Delivered (per approved Stage-1 architecture, platform-adapted):**

1. **Monorepo** — `pnpm-workspace.yaml` (`apps/*`, `packages/*`); platform keeps npm at root, local dev may use pnpm; code sharing via `@shared/*` TS path alias so both flows work.
2. **Root platform config** — root `package.json` untouched (platform contract); tsconfig extended with `@shared/*` paths + `apps` exclusion.
3. **Next.js frontend** — already running (Stage 1 foundation): Next 16 + React 19 + TS strict + Tailwind 4.
4. **Express backend** — `apps/api` (Express 4 + TS strict): helmet, CORS (env allow-list), express-rate-limit, `pino`/`pino-http` logging, 404 + Persian error middleware, graceful shutdown. **No business logic** — health surface only, per stage scope.
5. **Shared package** — `@installments/shared` now owns the canonical Zod schemas, finance math, Jalali utils, formatting, palettes (`packages/shared/src/*`); `src/lib/*` files are thin re-export shims; parity locked by `tests/shared-parity.test.ts`.
6. **Lint/format/strict** — ESLint flat config ignores workspace build output; `.prettierrc.json` + prettier installed; lint = **0 errors** (1 informational react-compiler/TanStack notice); tsc strict everywhere.
7. **Env & secrets** — `.env.example` (DATABASE_URL, API_PORT, CORS_ORIGIN, SMS_API_URL/KEY, NODE_ENV); `.gitignore` created — **`.env`, uploads/, dist/ and node_modules/ are excluded from VCS**.
8. **Docker Compose** — `docker-compose.yml` PostgreSQL 16 + healthcheck (from Stage 1 scaffolding, verified config).
9. **Prisma (server package)** — `apps/api/prisma/schema.prisma` mirrors the Drizzle schema (all 13 tables, enums, indexes); `prisma validate` ✓ + `prisma generate` ✓ (Prisma 6; Drizzle remains the live schema owner — sync rule documented).
10. **Logging & errors** — pino JSON logs (API); `src/lib/logger.ts` structured logger (web; wired into audit failure path); Persian error payloads with proper status codes.
11. **Health checks** — web `GET /api/health` → `{ok,db,service,uptimeSec}` (verifies Postgres); API `GET /health` + `GET /health/db` (**live-verified in sandbox**: both 200 with `db:true`).
12. **Test infrastructure** — Vitest: **18/18 passing** (13 core + 5 workspace-parity).
13. **README.md** — bilingual quickstart, layout, commands, pins, security notes.

**Acceptance criteria — all verified in this sandbox:** deps install ✓ (root npm + apps/api npm) · frontend starts ✓ · backend starts ✓ (probed 4100) · PostgreSQL up ✓ · DB connection verified from **both** services ✓ · TypeScript passes ✓ (root + apps/api + packages/shared) · health endpoint responds ✓ · secrets not committed ✓ (.gitignore, .env.example template).

## Stage 1 — System Architecture & Design ✅
**Deliverables:** `docs/ARCHITECTURE.md` (full architecture, directory trees, module boundaries,
security model, financial data flow, Jalali/penalty policy, integration approach, risk register,
roadmap) + this updated progress record.

Key Stage-1 decisions:
- **Reference stack** (Express + Prisma + pnpm monorepo) documented in full; **binding adaptation**
  to the platform runtime (single Next.js deployable + Drizzle ORM) with a mechanical extraction
  path preserved — see `docs/ARCHITECTURE.md` §2.
- Money is PostgreSQL `numeric(18,2)` (Decimal) with integral-value validation (migrated from bigint in Stage 3); penalties *derived on read* (no duplicate charges by
  construction); payments guarded by idempotency keys + unique junction constraint.
- Compatibility findings already enforced: pinned `@tanstack/react-table@8.21.3`, `zod@3.25.76`;
  React-PDF Persian shaping deferred (print-receipt bridge); Next 16 `proxy` convention adopted.

**Status: awaiting approval to proceed to Stage 2.**

---

## Foundation build (delivered ahead of the staged plan)

### Completed
- [x] Auth: bcrypt, DB sessions (httpOnly cookie, sliding rotation, throttling), roles ADMIN/OPERATOR/CUSTOMER enforced on server.
- [x] Customers: CRUD, national-code checksum + phone validation, tags, notes, credit limit, search.
- [x] Guarantors + documents: JPG/PNG/PDF ≤5MB uploads outside web root; auth-scoped streaming route.
- [x] Contracts: cash & installment; unique numbers via `counters` tx; manual financials only; live discrepancy check + adjust-last option; Jalali schedule generation; cancel w/ audit.
- [x] Payments: sequential multi-installment coverage; no partials; card-to-card → review queue; cash/POS auto-confirm; idempotency keys; unique junction (double-payment impossible, tested); settlement waivers.
- [x] Penalties: %/day (basis points) or fixed-daily; grace period; integer math; admin forgiveness w/ reason; auditable settlement breakdown (`settlementMeta`).
- [x] Customer portal: own data only; receipt submission + attachment; printable receipt.
- [x] Dashboard: KPIs, 8-month chart, method donut, overdue list + reminder.
- [x] Reports: 12-month trend, aging buckets, top debtors, XLSX export (SheetJS).
- [x] Settings (store + finance), users management, audit explorer, backup JSON dump (ADMIN), SMS log viewer.
- [x] UI: RTL, local Vazirmatn, Jalali dates (react-multi-date-picker), fa/Latin digits toggle, Toman formatting, 6 palettes + dark/light, TanStack Table, Recharts, Zustand, sonner, RHF+zod.
- [x] PWA: manifest + icons. Scaffolding: Electron shell, Capacitor config, docker-compose, CI workflow.
- [x] Tests: 13/13 passing (validators, penalty engine, settlement, Jalali math) — `npx vitest run`.

### Demo credentials (seed)
| Role | Username | Password |
|---|---|---|
| مدیر | `admin` | `admin123456` |
| اپراتور (مجاز به بررسی فیش) | `operator` | `operator123` |
| مشتری (پرتال) | `customer1` | `customer123` |

### Commands
```bash
npx drizzle-kit push          # apply schema (drizzle.config.json / DATABASE_URL)
npx tsx src/db/seed.ts        # seed demo data (once)
npx vitest run                # unit tests
npm run build && npm start    # production
```

### Env
`DATABASE_URL` (required). Optional: `SMS_API_URL`, `SMS_API_KEY` (otherwise SMS = SIMULATED logs).

### Database
Tables: users, sessions, customers, guarantors, documents, contracts, installments,
payments, payment_installments (unique installmentId), settings, audit_logs, sms_logs, counters.
Applied via `drizzle-kit push` (no migration files yet).

### Known limitations (declared honestly)
- Server-side PDF receipts use @react-pdf only after the Persian reshaping pipeline (S5); current receipts are print-optimized HTML (browser → PDF).
- SMS reminders are manual triggers; scheduled reminders arrive with a job runner (S9+).
- Backup restore is a DBA process (documented), not a UI feature.
- Upload trust = MIME + size; magic-byte sniffing in S9.

### Next stage (proposed S2 remainder)
Since S2–S8 functional work is already running, the next meaningful stages are the hardening and
packaging tracks: S9 (upload sniffing, global rate limits, E2E) → S10 (Electron/Capacitor/PWA polish)
→ S12 (deployment runbook). Awaiting user approval per the staged workflow.
