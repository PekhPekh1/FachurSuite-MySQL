# FachurSuite — System Architecture: Installment & Cash Sales Management System
**Made with ❤️ by TheFachur — سند معماری (Stage 1)**

Status: **Approved for implementation** (core already implemented ahead of schedule)
Stack of record: Next.js 16 (App Router) · React 19 · TypeScript strict · Tailwind v4 · PostgreSQL · Drizzle ORM
Spec-stack mapping: Express+Prisma mono-repo is the *reference design*; see §2 for the binding adaptation.

---

## 1. System overview

Single-store retail sales system: cash sales, installment contracts, customers, guarantors,
payments with verification workflow, late penalties, SMS notifications, reports, exports,
customer portal, audit trail — all Persian/RTL/Jalali, one business, one branch.

```
┌──────────────────────────────────────────────────────────────────┐
│ Clients                                                           │
│  Browser (RTL web) ── PWA install ── Electron shell ── Capacitor  │
└───────────────┬──────────────────────────────────────────────────┘
                │ HTTPS (server components + server actions + route handlers)
┌───────────────▼──────────────────────────────────────────────────┐
│ Next.js application (single deployable)                           │
│ ┌─────────────┐  ┌──────────────────────────────┐  ┌───────────┐ │
│ │ Proxy/auth  │→ │ Server actions (mutations)   │→ │ Zod       │ │
│ │ gate        │  │ Route handlers (upload/docs/ │  │ validation│ │
│ │             │  │  backup, /api/health)        │  │ at every  │ │
│ │             │  │ RSC pages (queries)          │  │ boundary  │ │
│ └─────────────┘  └──────────────┬───────────────┘  └───────────┘ │
│                  Domain services: payments-ledger · penalties     │
│                  · contracts · notifications (SMS) · audit        │
│                  · files · settings · reports                     │
└───────────────┬──────────────────────────────────────────────────┘
                │ Drizzle ORM (node-postgres pool, transactions)
┌───────────────▼──────────────────────────────────────────────────┐
│ PostgreSQL — single source of truth                               │
│ users sessions customers guarantors documents contracts           │
│ installments payments payment_installments counters settings      │
│ audit_logs sms_logs                                               │
└──────────────────────────────────────────────────────────────────┘
External (optional): SMS gateway (SMS_API_URL/SMS_API_KEY), otherwise SIMULATED.
```

Deployable forms from one codebase: web app, installable PWA, Windows EXE (Electron
shell), Android APK (Capacitor shell) — the last three are thin shells over the same app.

---

## 2. How Next.js / Express / PostgreSQL / Prisma / shared schemas interact

### 2.1 Reference design (per master spec)
```
packages/shared  ──(zod schemas, TS types, jalali+finance utils)──┐
        │                                                        │
        ▼                                                        ▼
apps/api (Express, Prisma, JWT, Swagger) ──► PostgreSQL     apps/web (Next.js RSC/client)
        ▲                                                        │
        └──────────── JSON over HTTPS, Bearer JWT ◄──────────────┘
```
- **shared**: single source of truth for validation (zod) and money/date math; both tiers import it.
- **api**: owns transactions, RBAC, idempotency, scheduled jobs (node-cron), file storage,
  SMS dispatch, Swagger docs.  
- **web**: thin; calls the API; never touches the DB directly.
- **DB**: Prisma migrations own the schema; Postgres constraints are the last line of defense.

### 2.2 Platform adaptation (what is built and running)
The build platform mandates **one Next.js deployable with Drizzle ORM**; a long-running
Express process is out of scope of this environment. The adaptation preserves every boundary
so an Express+Prisma extraction later is *mechanical, not architectural*:

| Reference concept | Implemented as | Notes |
|---|---|---|
| `packages/shared` | `src/lib/validators.ts`, `src/lib/finance.ts` (pure), `src/lib/jalali.ts` | Imported by both client forms (RHF+zodResolver) and server actions — same schema objects. |
| Express controllers | `src/server/actions/*.ts` ('use server') + `src/app/api/*/route.ts` | Each action = validate → authorize → transaction → audit → revalidate. |
| Prisma | Drizzle ORM + `drizzle-kit push` | Schema-first TS; constraints (unique/FK/checks) in Postgres. |
| JWT access+refresh | DB session tokens (opaque, httpOnly cookie, 7-day sliding rotation) | Opaque server-side tokens are strictly stronger than bearer JWTs for a first-party app; JWT re-enters the design only if a separate API/mobile client ships. |
| node-cron jobs | Manual triggers now (reminders); penalty calc is **derived, not scheduled** | No cron needed for correctness; see §8. |
| Swagger | Server actions are typed RPC; API routes documented in §9/§11 | If Express extraction happens, Swagger ships with it. |

**Dependency rule (enforced in code review):** client → actions/routes → domain services → db.
Nothing imports upward; `src/lib/finance.ts` and `src/lib/jalali.ts` stay DB-free (proven by unit tests).

---

## 3. Repository layout

### 3.1 Running sandbox (pnpm-workspace-ready layout kept flat for now)
```
src/
  db/                 schema.ts · index.ts · seed.ts
  lib/                auth.ts · auth-constants.ts · validators.ts · finance.ts ·
                      jalali.ts · format.ts · prefs.ts · palettes.ts · settings-server.ts ·
                      audit.ts · sms.ts · store.ts
  server/actions/     auth · prefs · customers · contracts · payments · admin
  app/
    (app)/            dashboard customers contracts payments reports users audit settings portal receipts
    login/ api/ (health · upload · docs/[id] · backup)
  components/         ui · shell · controls · charts · modal · jalali-date-picker ·
                      payments-table · export-xlsx · forms/*
docs/                 ARCHITECTURE.md (this file)
tests/                core.test.ts (vitest)
electron/  capacitor.config.ts  docker-compose.yml  .github/workflows/ci.yml
```

### 3.2 Target monorepo (when multi-shell packaging starts)
```
installment-sales/
├── pnpm-workspace.yaml
├── apps/
│   ├── web/            # this Next.js app (also PWA)
│   ├── api/            # extracted Express service (optional; see §2.2)
│   ├── desktop/        # Electron shell (electron-builder → NSIS EXE)
│   └── mobile/         # Capacitor shell (→ APK/AAB)
├── packages/
│   ├── shared/         # validators, finance, jalali (verbatim move from src/lib)
│   ├── config/         # tsconfig/eslint presets
│   └── db/             # drizzle schema+client (shared by web/api)
└── infra/              # docker-compose, CI workflows
```
Promotion path: `src/lib/{validators,finance,jalali}` → `packages/shared` with no renames;
actions wrap one Express transport layer only if needed.

---

## 4. Module boundaries & dependency relationships

| Module | Responsibility | Depends on | Depended by |
|---|---|---|---|
| auth | sessions, credentials, roles, throttling | db, audit | all actions/pages |
| prefs/palettes | digits, palette, theme persistence | cookies | layout, shell |
| customers | customer/guarantor CRUD, tags, credit | db, validators, audit | contracts, portal |
| documents | upload validation, storage, scoped streaming | auth, db, audit | customers, payments |
| contracts | numbering (counters), schedule generation, discrepancy policy, cancel | db, jalali, validators, audit, sms | payments, reports |
| penalties | pure calc: grace, %/day (bp), fixed/day, forgiveness traces | finance settings | payments, contracts, reports |
| payments (ledger) | coverage resolution, idempotency, review workflow, settlement | db(tx), penalties, contracts, sms, audit | portal, receipts, reports |
| notifications (sms) | gateway-agnostic dispatch + log | settings/env | contracts, payments |
| audit | append-only trail, written **inside** business txs | db | every module |
| reports | aggregates, aging, charts data, exports | db, penalties | (UI only) |
| settings | key-value store defaults (store, finance) | db | penalties, sms, receipts |
| backup | full JSON export (ADMIN) | db, audit | (ops) |
| portal | CUSTOMER-scoped read + receipt submit | payments, customers | customers domain |

Invariants: `finance.ts`/`jalali.ts` never import db (unit-tested pure); pages never mutate;
mutations only via server actions; API routes only for binary/streaming surfaces.

---

## 5. Security architecture

### 5.1 Authentication
- Credentials bcrypt(10). Login throttling: 6 failures / 10 min / username (in-memory; moves to table if multi-instance).
- Session: `session` httpOnly cookie → random 256-bit token row; 7-day TTL, sliding rotation at 3 days, lazy purge of expired rows; server-side revocation by delete; `isActive=false` kills sessions implicitly at lookup.
- Proxy (`src/proxy.ts`, Next 16 convention) = fast unauthenticated bounce only; **never** an authorization decision point.

### 5.2 Authorization matrix (enforced in server code, UI merely hides)
| Capability | ADMIN | OPERATOR | CUSTOMER |
|---|---|---|---|
| customers/contracts read-write | ✓ | ✓ | own, read-only |
| record cash/POS payment | ✓ | ✓ | — |
| submit card-to-card receipt | ✓ | ✓ | own only |
| approve/reject payment | ✓ | only if `canReviewPayments` | — |
| forgive penalty / cancel contract | ✓ | — | — |
| users, settings, backup, audit | ✓ | — | — |
| reports | ✓ | ✓ (scoped screens) | — |

### 5.3 Customer data isolation
Hard rule: **every** CUSTOMER-scoped read/write re-derives the customer's id from the session
(`requester.customerId`), never from client input. Enforcement points: portal page, receipt page,
`createPayment`, `/api/docs/[id]`. Violations return 404 (not 403) on foreign resources to avoid
existence leaks — contract detail does this for customers.

### 5.4 Other surfaces
- Uploads: MIME allow-list (jpg/png/pdf), 5 MB cap, stored outside web root, random UUID names, streamed with `nosniff`. Follow-up noted in §11: magic-byte verification.
- Secrets: env-only (`DATABASE_URL`, `SMS_API_URL/KEY`); nothing client-exposed except `NEXT_PUBLIC_*`.
- Backup route: ADMIN-only, audit-logged, `no-store`.
- Rate limiting beyond login: to be added with reverse proxy rules (§11 risk R6).

---

## 6. Financial data flow — contract → payment confirmation

**Contract creation (1 tx):**
zod validate → verify customer/guarantor ownership → compute `discrepancy = total − (down + n×per)`
→ if `≠0` and not `adjustLast` → explicit Persian error with amount; else absorb into last
installment (must stay > 0) → allocate contract number from `counters` row (upsert+increment,
safe under concurrency) → insert contract + schedule rows → audit (same tx) → SMS (after commit).

**Payment recording / confirmation:**
1. **Coverage resolution** — unpaid installments ordered by `seq`; payment covers either
   *earliest N* (consecutive, fully — partials impossible) or *all* (`settle=true`).
2. **Amount assertion** — server computes `Σ amounts + Σ live penalties` (penalties skipped when
   forgiven, or waived by staff via `waivePenalties`; customers can never waive). Mismatch ⇒ reject
   with the exact expected amount in the message.
3. **Idempotency** — client-generated `idempotencyKey` (unique). Retry-safe: same key returns the
   existing payment instead of erroring.
4. **Reservation** — `payment_installments` junction rows (unique on `installmentId`) are written
   at creation. Concurrent double-payment of the same installment is a hard unique violation (tested).
5. **Method rule** — CASH/POS (staff-only) → `CONFIRMED` immediately, installments marked paid in
   the same tx; CARD_TO_CARD → `PENDING_REVIEW`, installment states unchanged until review.
6. **Review** (ADMIN / authorized OPERATOR) — approve: guarded `UPDATE … WHERE status='PENDING_REVIEW'`
   (double-review race fails safe) → mark installments paid → auto-SETTLE contract when none unpaid;
   reject: status + mandatory reason, junction rows deleted (releases the installments).
7. **After commit**: SMS + audit + `revalidatePath`.

**Settlement:** same pipeline with `settle=true`, waiver optional; full per-line breakdown persisted
to `payments.settlementMeta` for audit.

**Cash sale:** modeled as a 1-installment contract due immediately; identical payment path → receipt.

---

## 7. Jalali dates — conversion & storage policy

- **Storage: always Gregorian.** `date` ('YYYY-MM-DD') for business days; `timestamptz` for events.
  Sorting/indexing stays native; no Jalali strings ever enter the DB.
- **Input:** `react-multi-date-picker` with the official Persian calendar (`react-date-object`);
  value converts to Gregorian ISO at the component boundary (`JalaliDatePicker`).
- **Display:** `jalaali-js` conversions; timestamps rendered in **Asia/Tehran** explicitly (never
  server-TZ-dependent); "today" is the Tehran civil date.
- **Schedule math:** month increments in Jalali space with end-of-month clamping
  (e.g., ۳۰ بهمن → ۳۰ اسفند leap-aware → ۳۰ فروردین), covered by unit tests.
- **Digits:** Latin-in-data, Persian-at-render via a global digits preference (cookie, toggle in shell).

---

## 8. Installment schedules & penalty calculation

**Schedule:** first due date (Jalali picker) + monthly increments; equal manual amounts; last row
absorbs discrepancy only with the operator's explicit opt-in; `contracts.discrepancy` is persisted —
auditable forever.

**Penalties are derived, not stored-generated:**
`daysLate = (today − dueDate) − graceDays`; if `≤0` → none.
- `PERCENT_DAILY`: `⌊ amount × percentBpPerDay × daysLate / 10000 ⌋` (basis points, integer math).
- `FIXED_DAILY`: `fixedPerDay × daysLate`.
- All Toman values are exact `numeric(18,2)` at the database level (PostgreSQL Decimal, since Stage 3); amounts are integral by validation and **no float math is authoritative** (per-day penalty floors are computed before day multiplication to keep intermediates small and exactly representable).
- Derived-on-read ⇒ duplicates are *structurally impossible* (no penalty rows to double-insert).
- Forgiveness is the only persisted mutation: amount snapshot + reason + actor + timestamp
  (`penaltyForgiven/forgivenAmount/forgivenBy/forgivenReason/forgivenAt`) — hence forgiveness
  survives settings changes and appears in reports and the audit log.
- Settings (`PERCENT_DAILY bp`, `fixedPerDay`, `graceDays`, `NONE`) are ADMIN-editable; changes
  never rewrite history, only future derivations.

---

## 9. PDF · Excel · SMS · Backups · Audit

- **Receipts/PDF:** now — print-optimized receipt page (browser → PDF/svg-ready). Later —
  `@react-pdf/renderer` server route with registered Vazirmatn + `arabic-reshaper` + bidi fixer
  (react-pdf has no native Persian shaping; see §11 R4).
- **Excel:** SheetJS in the browser; server pages hand typed rows; payments/receivables workbooks today.
- **SMS:** `sendSms()` gateway-agnostic; with `SMS_API_URL/KEY` → provider POST, else logs
  `SIMULATED`; every attempt persisted in `sms_logs`; triggers: contract created, payment recorded,
  approved/rejected, manual overdue reminder.
- **Backups:** ADMIN JSON dump (all tables, versioned), download audited; stage later: `pg_dump`
  snapshot + restore runbook (restore stays a DBA operation — declared limitation).
- **Audit:** append-only `audit_logs` written inside the same transactions as the business write
  (atomic: no business change without its trail); includes actor snapshot, action registry
  (`ACTION_FA` in UI), entity refs, metadata JSON.

---

## 10. PWA · Electron · Capacitor · CI/CD

- **PWA:** manifest (fa, RTL, standalone) + icons shipped. No service-worker offline mode (explicitly
  out of scope) — PWA is installability + theming only.
- **Electron:** `electron/main.cjs` shell loads the app URL; packaging stage adds NSIS via
  electron-builder, single-instance lock, and (optionally) auto-update.
- **Capacitor:** `capacitor.config.ts` points at the deployed origin; packaging stage runs
  `cap add android` + Gradle build for APK/AAB.
- **CI/CD:** `.github/workflows/ci.yml`: install → `drizzle-kit push` → `vitest run` → `tsc --noEmit`
  → `next build` with Postgres service. Later additions: Playwright E2E, packaging jobs, release artifacts.

---

## 11. Risks & incompatibility findings (discovered during foundation build)

| # | Risk / finding | Decision |
|---|---|---|
| R1 | Spec stack (Express+Prisma+JWT) vs platform runtime (single Next.js deployable) | Adaptation in §2.2; boundaries kept extractable. |
| R2 | `@tanstack/react-table@9.x` alpha — breaking renames (`useReactTable`, row-model API) | **Pinned 8.21.3** (stable API). |
| R3 | `zod@4` breaking changes + resolver friction | **Pinned zod 3.25.76**; wait for resolver ecosystem to settle. |
| R4 | `@react-pdf/renderer` lacks Persian glyph shaping (no OpenType GSUB + bidi) | Receipts via print-page now; server PDF requires reshaper pipeline — scheduled S5. |
| R5 | Numeric money transport (`numeric` → string) and float errors | Superseded by R13: `numeric(18,2)` storage, integral values enforced by zod and CHECK constraints; interior math ordered to stay exactly representable. |
| R6 | Rate limiting beyond login | Login throttle in place; global limits assigned to the reverse-proxy/gateway stage (S9). |
| R7 | Upload trust | MIME+size allow-list now; **magic-byte sniffing scheduled** (S9). |
| R8 | Concurrency (double payment, double review, number reuse) | Unique `payment_installments.installmentId`, guarded UPDATEs, `counters` tx allocation — all tested. |
| R9 | Timezone drift | All civil-date logic pinned to `Asia/Tehran`; DB `timestamptz` only. |
| R10 | Next.js 16 deprecates `middleware` file | Migrated to `proxy` convention early. |
| R11 | React 19 transition type change (void-only) | Forms fixed to void-returning transitions at build time. |
| R12 | PWA "offline" expectation | Explicitly excluded by business spec; no SW caching data. |
| R13 | Stage-3 mandate: "PostgreSQL Decimal types for monetary values" — conflicts with Stage-1 bigint choice | **Superseded by spec**: all monetary columns are `numeric(18,2)` (both ORMs; Prisma `Decimal`). Service math hardened so per-day penalty floors are computed before day multiplication; all authoritative operations stay exact for the business value ranges enforced by zod caps. |
| R14 | `npx prisma` in sandbox resolved a Prisma 8 RC (CLI removed `migrate diff`) | Pinned prisma/@prisma/client **6.19.3 exact** in apps/api; CI uses lockfile installs. |
| R15 | Storing raw session tokens server-side | Upgraded to RefreshToken model: only SHA-256 digests persisted; instant revocation on user deactivation; digests excluded from backups. |

Version pins of record: next 16.2.6 · react 19.2.6 · drizzle-orm 0.45.2 · tailwind 4.1.17 ·
zod 3.25.76 · @tanstack/react-table 8.21.3 · recharts (v3 line) · next-themes · sonner ·
react-multi-date-picker (v4 line) · jalaali-js · bcryptjs · xlsx (SheetJS) · vitest · tsx.

---

## 12. Prioritized implementation roadmap

| Stage | Scope | Depends on | Status |
|---|---|---|---|
| S1 | This architecture + progress record | — | **Done (this document)** |
| S2 | Auth/RBAC · customers · guarantors · documents | S1 | **Done ahead of plan** |
| S3 | Contracts engine · schedules · discrepancy policy | S2 | **Done ahead of plan** |
| S4 | Payments ledger · review workflow · penalties · settlement | S3 | **Done ahead of plan** |
| S5 | Receipts/PDF server-rendered (reshaper) · Excel coverage ↑ | S4 | Partial (print receipts + SheetJS done; server PDF pending) |
| S6 | Portal · SMS notifications · reminders | S4 | **Done** (SMS simulated w/o gateway) |
| S7 | Reports · dashboard · exports | S4 | **Done** |
| S8 | Settings · audit explorer · users mgmt · backup | S4 | **Done** |
| S9 | Hardening: magic-byte uploads, global rate limits, additional E2E, session table partitioning if needed | S2–S8 | Planned |
| S10 | Packaging: PWA polish (install prompts), Electron EXE, Capacitor APK, release CI | S9 | Scaffolding present |
| S11 | Optional Express+Prisma extraction (only if an external API consumer appears) | S9 | Not started |
| S12 | Deployment runbook (production PostgreSQL, backup cron, HTTPS, secrets) | S10 | Planned |

Risk-first ordering: money movement correctness (S3–S4) before cosmetics; packaging last since
shells are thin. Every stage ends with: typegen + tsc + build + vitest + seeded integration checks.

---

## 13. Penalty & settlement rules (Stage 7, authoritative)

Implemented in `packages/shared/src/finance.ts` and mirrored for the API track in
`apps/api/src/installment/penalty.ts`. Both are pure, DB-free and unit-tested.

### Installment status model
| Status | Stored? | Meaning |
|---|---|---|
| `PENDING` | yes | Awaiting payment |
| `RESERVED` | yes | A card-to-card receipt is under review (blocks double submission) |
| `PAID` | yes | Settled by a confirmed payment — terminal |
| `FORGIVEN` | yes | Whole obligation waived by an ADMIN with a reason — terminal |
| `OVERDUE` | **no — derived** | `PENDING` **and** `dueDate < today` (Asia/Tehran) |

`OVERDUE` is never persisted, so a `PAID`/`FORGIVEN` installment can never regress to
overdue regardless of how far in the past its due date lies.

### Penalty calculation
- **Start date** — the day *after* the due date; paying on the due date is never late.
- **Grace** — `graceDays` whole free days. Charging begins on day `graceDays + 1` and
  `daysLate = max(0, rawDaysLate − graceDays)`; grace days are never retro-charged.
- **Modes**
  - `PERCENT_MONTHLY` — `floor(amount × bpPerMonth × daysLate / (10000 × 30))`; a monthly
    rate pro-rated per day over a fixed 30-day month (one division keeps it exact).
  - `FIXED_DAILY` — `fixedPerDay × daysLate`.
  - `PERCENT_DAILY` *(legacy)* — `floor(amount × bpPerDay / 10000) × daysLate`.
  - `NONE` — always zero.
- **Rounding** — floor to whole Toman, so rounding never over-charges the customer.
- **Decimal safety** — amounts are integral Toman (`numeric(18,2)` in PostgreSQL) and all
  arithmetic is integer arithmetic; no floating-point accumulation occurs.
- **No double-charging** — penalties are *derived on read* from
  `(amount, dueDate, today, settings)`. Nothing is stored per day, so the same penalty
  cannot be charged twice, and accrual stops the moment the installment becomes
  `PAID`/`FORGIVEN`.

### Forgiveness
- **Penalty forgiveness** (`penalty.forgive`) — zeroes the penalty only; principal remains
  payable. Snapshot amount, reason, actor and timestamp are persisted.
- **Installment forgiveness** (`installment.forgive`) — waives principal *and* penalty,
  sets the terminal `FORGIVEN` status, and completes the contract when nothing payable
  remains. ADMIN only, reason mandatory, fully audited.

### Due-date changes
ADMIN only, and only for a `PENDING` installment on an `ACTIVE` contract. The first
`originalDueDate` is preserved across repeated changes together with actor, timestamp and
reason, and the change is written to `audit_logs`. Because penalties derive from the stored
due date, moving a date forward immediately stops further accrual.

### Early settlement
`settlementBreakdown` = principal of **every** remaining unpaid installment (future
installments are **not** discounted and **no interest is ever derived**) plus penalties
accrued to date. An authorized waiver zeroes the penalties and reports
`forgivenPenaltyTotal` separately. Processing runs in one transaction: create the
`isSettlement` payment (with the full line breakdown in `settlementMeta`), mark every row
`PAID` via a guarded `updateMany`, link `payment_installments`, and settle the contract when
no `PENDING`/`RESERVED` row remains. The request is idempotency-keyed, so a repeated submit
returns the original payment instead of charging twice.

---

## 14. Customer portal & data isolation (Stage 9)

### Isolation model
Every customer-scoped read derives ownership from the **authenticated session**
(`req.auth.customerId` / `sessionUser.customerId`). No customer identifier is ever
accepted from the request body, query string, or URL for the purpose of
authorization. Cross-customer requests return **404** rather than 403 so the
existence of another customer's records is never disclosed.

Enforcement points:
| Surface | Rule |
|---|---|
| `GET /api/v1/portal` | session-only; staff roles are rejected outright (403) |
| `GET /api/v1/customers/:id` | 404 unless `id === session.customerId` |
| `GET /api/v1/contracts/:id` | 404 for a foreign `customerId` |
| `GET /api/v1/customers/:id/guarantors`, `/documents` | 404 for a foreign profile |
| `GET /api/v1/documents/:id` | owner, own guarantor, or own payment receipt only |
| `GET /api/v1/payments/:id/receipt` | 404 unless the payment belongs to the caller |
| `POST /api/v1/payments` | 404 for a foreign contract; customers are restricted to `CARD_TO_CARD` |
| `POST /api/v1/customers/:id/documents` | 404 when uploading against another profile |
| `GET /api/receipts/:id` (PDF) | 404 for a foreign payment; 401 when unauthenticated |

### Store bank cards
`settings["bank_accounts"]` holds up to six cards (bank name, 16-digit card number,
holder, optional IBAN, `isActive`), managed by ADMIN. The portal and
`GET /api/v1/portal/bank-cards` expose **only active** cards, and the full card
number is shown deliberately so customers can actually make the transfer. No other
banking detail is exposed.

### Receipts (PDF)
`GET /api/receipts/:id` renders an A5 PDF server-side with `@react-pdf/renderer`.
Because that library performs no OpenType shaping or bidi reordering, Persian text
is pre-processed by `arabic-persian-reshaper` (contextual glyph forms) and `bidi-js`
(visual reordering) in `src/lib/pdf/persian.ts`. Vazirmatn TTFs are registered by
absolute path from `public/fonts` — `import.meta.url` is unusable in the server
bundle. Receipts contain store details, customer details, contract number, amount,
method, reference, source card (masked), payment date, verifier, covered
installments and penalty breakdown. A receipt is only issued for a **confirmed**
payment.

---

## 15. Reporting & financial definitions (Stage 10)

### Collections (دریافت‌ها)
**Only `payments.status = 'CONFIRMED'` counts as money received.** Payments with
`PENDING_VERIFICATION` (an unverified card-to-card receipt) or `REJECTED` are never
counted as income. This rule is applied in every report and dashboard figure and is
stated in the UI next to each affected number.

### Receivables (مطالبات)
Principal of every installment still payable — status `PENDING` **or** `RESERVED`
(the obligation persists until the covering receipt is confirmed), excluding
`FORGIVEN` and `PAID` — **plus** penalties accrued to date on the overdue subset.
Reported as `totalReceivables = receivablesPrincipal + receivablesPenalty`.

### Profit (سود)
For installment contracts, profit is the **contractual difference** between the
installment total price and the cash price:
```
margin = totalPrice − cashPrice          (installment contracts only)
realizedMargin = round(margin × paidInstallments / totalInstallments)
```
This is a **contractual margin, not realized cash income**: it accrues over the
contract's life and is fully realized only when the final installment settles.
Cash contracts have zero profit by definition (`totalPrice === cashPrice`). Both
the profit report and the print layout state this explicitly.

### Dashboard metrics
Total receivables (principal + penalty), overdue installment count and amount,
today's collections, monthly collections, active contract count, customer count,
12-Jalali-month collections chart, overdue-vs-on-time ratio (paid on/before due
versus paid late or still overdue), contract status distribution, upcoming
installments, overdue installment list, recent payments, pending verification
count/amount, and high-overdue customer alerts (≥2 overdue installments or ≥45
days past the oldest).

### Reports
Seven reports, each with Jalali date-range, customer, contract-status,
payment-method and contract-type filters, plus pagination where row counts warrant
it: overdue installments, income, customer financial, contracts, profit, payment
verification, and SMS delivery.

### Exports
**Excel** via SheetJS in the browser (one sheet per report, Persian headers).
**PDF** via `/reports/print` — a print-optimized `.receipt-sheet` layout that the
browser prints to PDF, containing the summary totals and the report rows.

---

## 16. SMS integration & automated reminders (Stage 11)

### Provider adapter (not arbitrary requests)
A provider is a **typed, validated configuration** in `settings["sms_provider"]`
dispatched through a constrained adapter (`src/lib/sms/provider.ts`):

| Field | Purpose |
|---|---|
| `name`, `apiUrl`, `apiKey`, `senderNumber` | identity + endpoint + credentials |
| `method` | `GET` or `POST` |
| `bodyTemplate` | placeholders `{phone}` `{message}` `{sender}` (and `{apiKey}` if required) |
| `successPath` / `successIndicator` / `jsonPath` | success detection: `STATUS_2XX`, `BODY_CONTAINS`, or `JSON_PATH` |
| `authStyle` / `authHeaderName` | `BEARER`, `HEADER`, `QUERY`, `BODY`, or `NONE` |
| `requireTls`, `isActive` | HTTPS enforcement and activation |

**SSRF protections.** The URL must be an absolute `http(s)://` URL; hostnames
resolving to private, loopback, link-local or unique-local space are rejected
(`10/8`, `127/8`, `0/8`, `172.16/12`, `192.168/16`, `169.254/16`, `::1`, `fe80::`,
`fc00::/7`, `localhost`); credentials embedded in the URL are refused; redirects
are never followed; HTTPS is enforced whenever `requireTls` is set. Validation is
re-run at dispatch time so a later configuration change cannot bypass the guard.
`SMS_ALLOW_PRIVATE_HOSTS=1` is a documented test-only escape hatch for pointing at
a local mock and is never enabled in production.

**Credentials.** The API key is read from configuration or `SMS_API_KEY`, injected
at send time, redacted from every response body and error message, and never
written to `sms_logs`, `audit_logs`, or the job queue. The audit entry records
only the key length.

### Templates
Editable in the settings screen and stored in `sms_templates` with a `category`:
`UPCOMING`, `DUE_DATE`, `OVERDUE`, `CONFIRMATION`, `REJECTION`, `CUSTOM`.
Permitted placeholders, validated on save, are `{customer}`, `{contractNo}`,
`{seq}`, `{amount}`, `{dueDate}`, `{daysLate}`, `{reason}`, `{message}`.

### Scheduling
`sms_schedule` controls days-before reminder, on-due-date reminder, overdue notice
interval, maximum overdue notices per installment, run hour and enable/disable.
Jobs are **persisted in `sms_jobs`**, so a restart resumes rather than loses or
duplicates work. Every job carries a stable `dedupeKey`
(`template:installment:day`) with a **unique index**, making duplicate scheduling
impossible even under concurrency; re-running the planner is a no-op.

`processSmsQueue` claims each row with a guarded `UPDATE ... WHERE status='PENDING'`
so overlapping invocations cannot double-send. Failures retry with exponential
backoff (5 min then 20 min) up to three attempts, after which the job is `FAILED`.

### Logging
`sms_logs` records recipient, template key, rendered body, delivery status
(`SENT`/`SIMULATED`/`FAILED`), the redacted provider response, placeholders and
timestamp. `sms_jobs` records scheduling state, attempt count and last error.
API keys never appear in either table.

---

## 17. Administrative settings & operational management (Stage 12)

### Store settings
`settings["store"]` — name, **logo URL**, address, phone, **description**,
**print header** and **print footer**. The print fields are consumed by the
receipt and contract layouts.

### Financial settings
`settings["finance"]` — penalty type and rates, grace period,
**default installment count**, **currency display preference** (`TOMAN`/`RIAL`),
plus store bank cards in `settings["bank_accounts"]` and **holiday management**
in the `holidays` table (ADMIN CRUD, unique date).

### User management
Create, **edit profile** (name, role, review permission, linked customer),
activate/deactivate, and password resets — all ADMIN-only. Two independent
lockout protections guard the final administrator:
1. `assertNotLastAdmin` blocks deactivating or demoting the **only active ADMIN**.
2. Self-deactivation is refused outright.

Role changes and password resets call `revokeAllUserTokens`, so existing access
tokens are invalidated immediately and permission changes take effect at once.
Duplicate usernames and holiday dates are detected through the PostgreSQL
unique-violation code (including Drizzle's wrapped errors) and return **409**;
generic failures return a Persian message and never leak SQL internals.

### Appearance settings
Persistent dark/light/system mode plus the six master-prompt palettes
(blue, green, purple, orange, teal, rose) and a Persian-digits toggle.
Preferences are stored **per user** (`users.pref_theme`, `pref_palette`,
`pref_fa_digits`) and applied on the server for the signed-in account; cookie
values remain the fallback for the login screen and unauthenticated renders.

### Operational features
SMS configuration, test sending, schedule settings, the audit-log viewer, manual
database backup, and **backup history** (`backup_history`: file name, size, table
count, per-table row counts, status, actor, timestamp).

### Backup security
The dump is **streamed directly to the authenticated ADMIN requester** and is
never written to a publicly accessible path. Unauthenticated and non-admin
requests receive 403. `refresh_tokens` are deliberately excluded (SHA-256 digests
must never leave the database); the exclusion is documented in the file itself.
Password hashes are included because a restore requires them, so the file must be
stored securely.

**Restore procedure** (also shown in the settings UI):
1. Store the JSON file securely — it contains password hashes.
2. Take a backup of the current database before restoring.
3. Restore the tables using `psql` with a privileged user.
4. Compare per-table row counts against the values recorded in `backup_history`.
5. Invalidate all sessions ("log out of all devices") so stale tokens cannot be reused.

---

## 18. Frontend application shell & UI integration (Stage 13)

### Shell
The authenticated app uses one Persian RTL shell (`AppShell`) across staff and
customer roles: responsive off-canvas sidebar (`max-lg`, fixed 17rem desktop
rail), sticky glass header, store logo/name, operational notifications,
debounced global search, breadcrumbs, theme/digit/palette controls, profile menu
and footer. The header collapses to icon controls and a full-screen search panel
on mobile. `Vazirmatn` is self-hosted under `public/fonts` and loaded by
`@font-face`; no external font request is required.

### Global search & isolation
`GET /api/search?q=` is authenticated. ADMIN/OPERATOR can search customers,
contracts, serial numbers and payment references. CUSTOMER receives **only own
contracts** — no customer directory or foreign result is ever queried. The client
uses a 250ms debounce plus `AbortController`, an accessible `combobox`/`listbox`,
Escape-to-close and Enter-to-open-first-result.

### Notifications
Server-derived operational alerts are passed to the shell on every render:
pending payment-verification count, overdue installment count, and failed SMS
jobs for staff; own pending and rejected receipts for customers. Links navigate
directly to the relevant real workflow (no mock buttons).

### Dedicated surfaces
- `/payments/verification` — card-to-card verification queue with source card,
  reference, payment date, attachment, customer/contract links and approve/reject.
- `/sms` — provider, schedule, templates, persistent queue and delivery log.
- `/profile` — identity/role, password change, per-user appearance, active
  sessions (no raw tokens), logout-current and logout-all.
- Global loading skeleton, route-level Persian error recovery and a Persian 404.

### Design system
CSS custom properties provide one semantic token set for light/dark and all six
palettes; cards, buttons, inputs, status badges, tables, skeletons and empty
states consume those tokens consistently. Forms retain Zod/server validation,
Persian errors, Sonner notifications, explicit confirmation dialogs and keyboard
focus states. Report date ranges use the actual Jalali picker; DB values remain
Gregorian ISO at the component boundary. Financial values are formatted in
Toman with the signed-in user's digit preference.

### Print
Contracts and report layouts use `.receipt-sheet` / `.no-print` rules. Confirmed
payment receipts are real server-generated PDFs with Persian shaping and embedded
Vazirmatn. Authorization is re-checked for every printable resource.

---

## 19. Deployment & packaging (Stage 15)

- Production layout: client (HTTPS) → nginx reverse proxy (deploy/nginx.conf) →
  PM2-managed Next.js (deploy/ecosystem.config.cjs) → PostgreSQL + uploads +
  SMS env. Health checks via /api/health.
- Migrations run ONLY as deploy-time `prisma migrate deploy` with a pre-migration
  `pg_dump` and a post-migration health check (deploy/migrate.sh). Restore is a
  typed-confirmation `pg_restore` (deploy/restore.sh).
- CI workflows: `test.yml` (full battery), `deploy-web.yml` (tests → production
  environment approval → SSH deploy → smoke test), `build-exe.yml` (NSIS
  installer via electron-builder on windows-latest), `build-apk.yml` (signed APK
  on ubuntu-latest + JDK17 + Android SDK). Least-privileged `contents: read`.
- Desktop is an HTTPS client client (no auto-updater; `publish: never`).
- Mobile loads the live backend via Capacitor server-load — the app is not
  statically exportable; cleartext is disabled; release signing via secrets.
- PWA is installable only: fonts/icons cached; `/api` and financial data are
  never cached; offline mode is out of scope.
