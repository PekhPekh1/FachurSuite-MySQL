import Link from "next/link";
import {
  Banknote, Hourglass, Users, FileCheck2, AlertTriangle, Wallet, CalendarClock,
  TrendingUp, ClipboardCheck, PieChart as PieIcon,
} from "lucide-react";
import { requireUser } from "@/lib/auth";
import { getDashboardData } from "@/server/reports";
import { formatJalali } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { fmtDate, fmtNum, fmtToman, toFaDigits, PAYMENT_METHOD_FA } from "@/lib/format";
import { Card, PageHeader, StatCard, StatusBadge, TableShell, EmptyState, MethodBadge, Badge } from "@/components/ui";
import { MonthlyBars } from "@/components/charts";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const d = await getDashboardData();

  const statusRows = Object.entries(d.contractStatus).filter(([, v]) => v > 0);
  const maxStatus = Math.max(1, ...statusRows.map(([, v]) => v));
  const STATUS_FA: Record<string, string> = { ACTIVE: "فعال", SETTLED: "تسویه شده", CANCELED: "لغو شده" };

  return (
    <div className="space-y-6">
      <PageHeader
        title="داشبورد"
        subtitle={`نمای کلی وضعیت فروشگاه — امروز ${fmtDate(formatJalali(d.today), fa)}`}
        actions={
          <Link href="/reports" className="btn btn-outline btn-sm">
            <TrendingUp className="size-4" />
            گزارش‌های تفصیلی
          </Link>
        }
      />

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
        <StatCard icon={<Wallet className="size-5" />} label="کل مطالبات" value={fmtToman(d.totalReceivables, fa)} sub={`اصل: ${fmtToman(d.receivablesPrincipal, fa)}`} tone="warning" />
        <StatCard icon={<AlertTriangle className="size-5" />} label="اقساط معوقه" value={`${fmtNum(d.overdueCount, fa)} قسط`} sub={fmtToman(d.overdueAmount, fa)} tone={d.overdueCount ? "danger" : "brand"} />
        <StatCard icon={<Banknote className="size-5" />} label="دریافتی امروز" value={fmtToman(d.todayCollections, fa)} tone="success" />
        <StatCard icon={<CalendarClock className="size-5" />} label="دریافتی این ماه" value={fmtToman(d.monthCollections, fa)} tone="success" />
        <StatCard icon={<FileCheck2 className="size-5" />} label="قراردادهای فعال" value={fmtNum(d.activeContracts, fa)} sub={`از ${fmtNum(d.totalContracts, fa)} قرارداد`} />
        <StatCard icon={<Users className="size-5" />} label="مشتریان" value={fmtNum(d.customerCount, fa)} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <h2 className="mb-1 text-sm font-bold">دریافت‌های ۱۲ ماه اخیر (تأییدشده)</h2>
          <p className="mb-4 text-[11px] text-muted">فقط پرداخت‌های تأییدشده محاسبه می‌شوند؛ فیش‌های در انتظار تأیید و ردشده به‌عنوان درآمد لحاظ نمی‌شوند.</p>
          <MonthlyBars data={d.monthly} fa={fa} />
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="mb-3 text-sm font-bold">به‌موقع در برابر معوق</h2>
            <div className="flex items-center gap-4">
              <div className="relative grid size-24 shrink-0 place-items-center">
                <svg viewBox="0 0 36 36" className="absolute inset-0 -rotate-90">
                  <circle cx="18" cy="18" r="15.5" fill="none" stroke="var(--surface-2)" strokeWidth="4" />
                  <circle
                    cx="18" cy="18" r="15.5" fill="none" stroke="var(--brand)" strokeWidth="4"
                    strokeDasharray={`${(d.onTimeRate / 100) * 97.4} 97.4`} strokeLinecap="round"
                  />
                </svg>
                <span className="text-sm font-bold">{toFaDigits(d.onTimeRate)}٪</span>
              </div>
              <div className="space-y-1 text-xs">
                <p className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-[var(--success)]" />
                  به‌موقع: <span className="font-bold">{fmtNum(d.onTime, fa)}</span>
                </p>
                <p className="flex items-center gap-2">
                  <span className="size-2.5 rounded-full bg-[var(--danger)]" />
                  با تأخیر / معوقه: <span className="font-bold">{fmtNum(d.late, fa)}</span>
                </p>
                <p className="text-muted">از {fmtNum(d.onTime + d.late, fa)} قسط سررسیدشده</p>
              </div>
            </div>
          </Card>

          <Card>
            <h2 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <PieIcon className="size-4 text-brand" />
              توزیع وضعیت قراردادها
            </h2>
            <div className="space-y-2">
              {statusRows.map(([status, count]) => (
                <div key={status} className="flex items-center gap-3 text-xs">
                  <span className="w-20 shrink-0 text-muted">{STATUS_FA[status]}</span>
                  <div className="h-6 flex-1 overflow-hidden rounded-lg bg-[var(--surface-2)]">
                    <div className="h-full rounded-lg bg-brand-grad" style={{ width: `${(count / maxStatus) * 100}%` }} />
                  </div>
                  <span className="w-10 text-left font-bold">{fmtNum(count, fa)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className={d.pendingVerificationCount ? "border-[var(--warning)]/50" : ""}>
            <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">
              <ClipboardCheck className="size-4 text-[var(--warning)]" />
              در انتظار تأیید
            </h2>
            <p className="text-2xl font-bold">{fmtNum(d.pendingVerificationCount, fa)}</p>
            <p className="text-[11px] text-muted">{fmtToman(d.pendingVerificationAmount, fa)} — فیش کارت‌به‌کارت</p>
            <p className="mt-1 text-[11px] text-muted">این مبالغ تا زمان تأیید، درآمد محسوب نمی‌شوند.</p>
          </Card>
        </div>
      </div>

      {/* High-overdue alerts */}
      {d.highOverdueCustomers.length > 0 ? (
        <Card className="border-[var(--danger)]/40">
          <h2 className="mb-3 flex items-center gap-2 text-sm font-bold text-[var(--danger)]">
            <AlertTriangle className="size-4" />
            هشدار: مشتریان با تأخیر بالا
          </h2>
          <TableShell>
            <thead><tr><th>مشتری</th><th>اقساط معوقه</th><th>مبلغ معوقه</th><th>قدیمی‌ترین تأخیر</th></tr></thead>
            <tbody>
              {d.highOverdueCustomers.map((c) => (
                <tr key={c.customerId}>
                  <td>
                    <Link href={`/customers/${c.customerId}`} className="font-medium text-brand hover:underline" prefetch={false}>{c.name}</Link>
                  </td>
                  <td>{fmtNum(c.count, fa)} قسط</td>
                  <td className="font-bold text-[var(--danger)]">{fmtToman(c.amount, fa)}</td>
                  <td><Badge tone={c.oldestDays >= 45 ? "danger" : "warning"}>{fmtNum(c.oldestDays, fa)} روز</Badge></td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>
      ) : null}

      {/* Upcoming + overdue lists */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-bold">اقساط سررسید آینده</h2>
          {d.upcoming.length === 0 ? (
            <EmptyState title="قسط آینده‌ای وجود ندارد" />
          ) : (
            <TableShell>
              <thead><tr><th>مشتری</th><th>قرارداد</th><th>قسط</th><th>سررسید</th><th>مبلغ</th></tr></thead>
              <tbody>
                {d.upcoming.map((o) => (
                  <tr key={o.id}>
                    <td className="font-medium">
                      <Link href={`/customers/${o.customerId}`} className="text-brand hover:underline" prefetch={false}>{o.customerName}</Link>
                    </td>
                    <td><Link href={`/contracts/${o.contractId}`} className="text-brand hover:underline" prefetch={false}><span dir="ltr">{o.contractNo}</span></Link></td>
                    <td>{fmtNum(o.seq, fa)}</td>
                    <td>{fmtDate(formatJalali(o.dueDate), fa)}</td>
                    <td>{fmtToman(o.amount, fa)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold">اقساط معوقه</h2>
            <Link href="/installments?status=OVERDUE" className="text-xs text-brand hover:underline">مشاهده همه</Link>
          </div>
          {d.overdue.length === 0 ? (
            <EmptyState title="قسط معوقه‌ای وجود ندارد" hint="همه مشتریان در سررسید مقرر پرداخت کرده‌اند" />
          ) : (
            <TableShell>
              <thead><tr><th>مشتری</th><th>قرارداد</th><th>سررسید</th><th>مبلغ</th><th>جریمه</th></tr></thead>
              <tbody>
                {d.overdue.map((o) => (
                  <tr key={o.id} className="bg-[var(--danger-soft)]/40">
                    <td className="font-medium">
                      <Link href={`/customers/${o.customerId}`} className="text-brand hover:underline" prefetch={false}>{o.customerName}</Link>
                    </td>
                    <td><Link href={`/contracts/${o.contractId}`} className="text-brand hover:underline" prefetch={false}><span dir="ltr">{o.contractNo}</span></Link></td>
                    <td>{fmtDate(formatJalali(o.dueDate), fa)}</td>
                    <td>{fmtToman(o.amount, fa)}</td>
                    <td className="text-[var(--danger)]">{o.penalty > 0 ? fmtToman(o.penalty, fa) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>
      </div>

      {/* Recent payments */}
      <Card>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-bold">آخرین پرداخت‌ها</h2>
          <Link href="/payments" className="text-xs text-brand hover:underline">همه پرداخت‌ها</Link>
        </div>
        {d.recentPayments.length === 0 ? (
          <EmptyState title="پرداختی ثبت نشده است" />
        ) : (
          <TableShell>
            <thead><tr><th>مشتری</th><th>مبلغ</th><th>روش</th><th>وضعیت</th><th>زمان</th></tr></thead>
            <tbody>
              {d.recentPayments.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">
                    {p.customerName}
                    <span className="ms-2 text-[11px] text-muted" dir="ltr">{p.contractNo}</span>
                  </td>
                  <td>{fmtToman(p.amount, fa)}</td>
                  <td><MethodBadge method={p.method} /></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(p.createdAt, true), fa)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <p className="text-center text-[11px] leading-6 text-muted">
        «مطالبات» مجموع اصل اقساط باز (شامل اقساط در انتظار تأیید فیش) و جریمه‌های accrued است.
        «درآمد» فقط از پرداخت‌های تأییدشده محاسبه می‌شود.
      </p>
    </div>
  );
}
