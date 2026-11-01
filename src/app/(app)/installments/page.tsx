import Link from "next/link";
import { and, asc, eq, inArray } from "drizzle-orm";
import { CalendarClock, AlertTriangle, CheckCircle2, HandHeart } from "lucide-react";
import { db } from "@/db";
import { contracts, customers, installments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computePenalty, deriveInstallmentStatus } from "@/lib/finance";
import { getFinanceSettings } from "@/lib/settings-server";
import { formatJalali, todayGreg } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { cx, fmtDate, fmtNum, fmtToman } from "@/lib/format";
import { Card, EmptyState, PageHeader, StatCard, StatusBadge, TableShell } from "@/components/ui";
import { ChangeDueDateButton, ForgiveInstallmentButton } from "@/components/forms/installment-actions";
import { SendReminderButton } from "@/components/forms/payment-forms";

export const dynamic = "force-dynamic";

const FILTERS = [
  { key: "OVERDUE", label: "معوقه" },
  { key: "UPCOMING", label: "سررسید آینده" },
  { key: "PAID", label: "پرداخت‌شده" },
  { key: "FORGIVEN", label: "بخشوده‌شده" },
  { key: "ALL", label: "همه" },
] as const;

export default async function InstallmentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const user = await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const { status = "OVERDUE" } = await searchParams;
  const today = todayGreg();
  const finance = await getFinanceSettings();

  const rows = await db
    .select({
      inst: installments,
      contractId: contracts.id,
      contractNo: contracts.contractNo,
      contractStatus: contracts.status,
      customerId: customers.id,
      customerName: customers.fullName,
    })
    .from(installments)
    .innerJoin(contracts, eq(contracts.id, installments.contractId))
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(and(inArray(contracts.status, ["ACTIVE", "SETTLED"])))
    .orderBy(asc(installments.dueDate))
    .limit(500);

  const enriched = rows.map((r) => {
    const display = deriveInstallmentStatus(r.inst.status, r.inst.dueDate, today);
    const penalty =
      display === "OVERDUE" ? computePenalty(r.inst.amount, r.inst.dueDate, today, finance, r.inst.penaltyForgiven) : null;
    return { ...r, display, penalty: penalty?.penalty ?? 0, daysLate: penalty?.daysLate ?? 0 };
  });

  const overdue = enriched.filter((e) => e.display === "OVERDUE");
  const upcoming = enriched.filter((e) => e.display === "PENDING");
  const paid = enriched.filter((e) => e.display === "PAID");
  const forgiven = enriched.filter((e) => e.display === "FORGIVEN");

  const visible =
    status === "ALL"
      ? enriched
      : status === "UPCOMING"
        ? upcoming
        : status === "PAID"
          ? paid.slice(0, 120)
          : status === "FORGIVEN"
            ? forgiven
            : overdue;

  return (
    <div className="space-y-6">
      <PageHeader title="اقساط" subtitle={`چرخه عمر اقساط و جریمه‌ها — امروز ${fmtDate(formatJalali(today), fa)}`} />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<AlertTriangle className="size-5" />} label="اقساط معوقه" value={fmtNum(overdue.length, fa)} sub={fmtToman(overdue.reduce((a, o) => a + o.inst.amount, 0), fa)} tone={overdue.length ? "danger" : "brand"} />
        <StatCard icon={<CalendarClock className="size-5" />} label="سررسید آینده" value={fmtNum(upcoming.length, fa)} sub={fmtToman(upcoming.reduce((a, o) => a + o.inst.amount, 0), fa)} />
        <StatCard icon={<CheckCircle2 className="size-5" />} label="پرداخت‌شده" value={fmtNum(paid.length, fa)} tone="success" />
        <StatCard icon={<HandHeart className="size-5" />} label="بخشوده‌شده" value={fmtNum(forgiven.length, fa)} sub={fmtToman(forgiven.reduce((a, o) => a + o.inst.forgivenAmount, 0), fa)} tone="warning" />
      </div>

      <Card>
        <div className="mb-4 flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <Link
              key={f.key}
              href={`/installments?status=${f.key}`}
              className={cx("btn btn-sm", status === f.key ? "btn-primary" : "btn-outline")}
              prefetch={false}
            >
              {f.label}
            </Link>
          ))}
        </div>

        {visible.length === 0 ? (
          <EmptyState title="قسطی در این دسته وجود ندارد" hint="فیلتر دیگری را انتخاب کنید" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>مشتری</th>
                <th>قرارداد</th>
                <th>قسط</th>
                <th>سررسید</th>
                <th>مبلغ</th>
                <th>جریمه</th>
                <th>وضعیت</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => (
                <tr key={r.inst.id} className={cx(r.display === "OVERDUE" && "bg-[var(--danger-soft)]/40")}>
                  <td className="font-medium">
                    <Link href={`/customers/${r.customerId}`} className="text-brand hover:underline" prefetch={false}>
                      {r.customerName}
                    </Link>
                  </td>
                  <td>
                    <Link href={`/contracts/${r.contractId}`} className="text-brand hover:underline" prefetch={false}>
                      <span dir="ltr">{r.contractNo}</span>
                    </Link>
                  </td>
                  <td>{fmtNum(r.inst.seq, fa)}</td>
                  <td>
                    {fmtDate(formatJalali(r.inst.dueDate), fa)}
                    {r.inst.originalDueDate ? (
                      <span className="block text-[10px] text-muted">اصلی: {fmtDate(formatJalali(r.inst.originalDueDate), fa)}</span>
                    ) : null}
                  </td>
                  <td>{fmtToman(r.inst.amount, fa)}</td>
                  <td>
                    {r.penalty > 0 ? (
                      <span className="text-[var(--danger)]">
                        {fmtToman(r.penalty, fa)} <span className="text-[10px]">({fmtNum(r.daysLate, fa)} روز)</span>
                      </span>
                    ) : r.inst.penaltyForgiven ? (
                      <span className="text-[11px] text-muted">بخشوده شد</span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td><StatusBadge status={r.display} /></td>
                  <td>
                    <div className="flex gap-1">
                      {r.display === "OVERDUE" || r.display === "PENDING" ? <SendReminderButton installmentId={r.inst.id} /> : null}
                      {user.role === "ADMIN" && (r.display === "OVERDUE" || r.display === "PENDING") ? (
                        <>
                          <ChangeDueDateButton installmentId={r.inst.id} currentDueDate={r.inst.dueDate} />
                          <ForgiveInstallmentButton installmentId={r.inst.id} />
                        </>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
