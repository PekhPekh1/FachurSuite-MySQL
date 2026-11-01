# FachurSuite — سامانه مدیریت فروش نقدی و اقساطی

Made with ❤️ by **TheFachur**

سیستم یکپارچه مدیریت فروش نقدی و اقساطی فروشگاه — فارسی، راست‌به‌چپ، با تقویم شمسی (جلالی)،
نمایش مبالغ به تومان، پرتال مشتری، بررسی فیش کارت‌به‌کارت، جرایم تأخیر، پیامک، گزارش‌ها و خروجی اکسل.

A single-store retail installment & cash sales management system. Persian (Farsi) UI, full RTL,
Jalali calendar, integer-Toman financial engine, role-based access (ADMIN / OPERATOR / CUSTOMER).

---

## Repository layout (pnpm workspace)

```
├── src/                    # Web application (Next.js 16 App Router) — platform runtime target
│   ├── app/                #   routes: dashboard, customers, contracts, payments, portal, …
│   ├── server/actions/     #   server actions (validation → authZ → transaction → audit)
│   ├── lib/                #   server libs + thin re-export shims of @installments/shared
│   └── db/                 #   Drizzle schema (owner of the live DB) + seed
├── packages/shared/        # @installments/shared — Zod schemas, finance math, Jalali, formatting
├── apps/api/               # @installments/api — optional standalone Express + Prisma service
├── tests/                  # Vitest suites (unit + workspace parity)
├── electron/               # Windows EXE shell (packaging stage)
├── capacitor.config.ts     # Android APK shell (packaging stage)
├── docs/ARCHITECTURE.md    # Full architecture document (Stage 1)
└── docker-compose.yml      # PostgreSQL for local development
```

> **Runtime topology.** The hosted platform runs the Next.js app at the repo root (npm-based).
> The workspace (`pnpm-workspace.yaml`) is the development form: locally you can use pnpm to link
> `@installments/shared` into all apps. The web app imports shared code through the
> `@shared/*` path alias, so both npm (platform) and pnpm (local monorepo) flows work.

## Prerequisites

- Node.js ≥ 20 · PostgreSQL ≥ 15 (or `docker compose up -d db` for a local instance)

## Quick start (web app — the full system)

```bash
cp .env.example .env          # set DATABASE_URL
npm install                   # install dependencies
npx drizzle-kit push          # create/upgrade database schema
npx tsx src/db/seed.ts        # optional: demo data + login accounts
npm run dev                   # http://localhost:3000  (or: npm run build && npm start)
```

Demo accounts after seeding: `admin/admin123456` (مدیر) · `operator/operator123` (اپراتور) ·
`customer1/customer123` (پرتال مشتری).

## Optional: standalone API service (Express + Prisma track)

```bash
cd apps/api
npm install                   # or: pnpm install (workspace links shared package)
npx prisma generate           # Prisma client (schema = mirror of Drizzle schema)
npm run build && npm start    # listens on API_PORT (default 4100)
# checks: /health  /health/db
```

## Verification commands

```bash
npm exec tsc -- --noEmit      # strict typecheck (web root)
npx vitest run                # unit tests
npm run build                 # production build
curl localhost:3000/api/health        # web health (verifies DB connection)
curl localhost:4100/health/db         # api health (when running)
npx eslint . && npx prettier --check .  # lint + formatting
```

## Environment variables

See `.env.example`. Required: `DATABASE_URL`. Optional: `SMS_API_URL` / `SMS_API_KEY`
(without them SMS is recorded as SIMULATED). Secrets live only in `.env` (git-ignored) —
never commit credentials.

## Technology pins (compatibility matters)

Next.js 16 · React 19 · Tailwind 4 · drizzle-orm 0.45 · zod **3.25.76** (v4 held back for
resolver compatibility) · @tanstack/react-table **8.21.3** (v9 alpha avoided) ·
recharts · react-multi-date-picker (Jalali) · jalaali-js · bcryptjs · SheetJS (xlsx) ·
Prisma **6.x** (API track) · Express **4.x** · pino 9.

## Documentation

- `docs/ARCHITECTURE.md` — architecture, data flows, security, financial-integrity rules, risks.
- `PROJECT_PROGRESS.md` — staged delivery record.
- `apps/api/` scripts: `dev`, `build`, `start`, `typecheck`, `db:validate`, `db:generate`.

## Security notes

هش رمزها با bcrypt، نشست‌های سمت سرور با کوکی httpOnly و چرخه خودکار، اعتبارسنجی zod در تمام
سطوح ورودی، جلوگیری از پرداخت مضاعف با کلید idempotency و قید یکتای پایگاه‌داده، تراکنش‌های
چندگانه برای عملیات مالی، و گزارش رویدادهای حساس در `audit_logs`.
