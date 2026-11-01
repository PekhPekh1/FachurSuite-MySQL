import Link from "next/link";
import { notFound } from "next/navigation";
import { asc, desc, eq } from "drizzle-orm";
import { UserRound, ShieldCheck, Printer } from "lucide-react";
import { db } from "@/db";
import { contracts, customers, guarantors, installments, payments, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computePenalty, deriveInstallmentStatus } from "@/lib/finance";
import { getFinanceSettings } from "@/lib/settings-server";
import { formatJalali, todayGreg } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { cx, fmtDate, fmtNum, fmtToman } from "@/lib/format";
import { Badge, Card, MethodBadge, PageHeader, StatusBadge, TableShell, EmptyState } from "@/components/ui";
import { CancelContractButton, ForgivePenaltyButton, PrintReceiptLink, RecordPaymentForm, SendReminderButton } from "@/components/forms/payment-forms";
import { ChangeDueDateButton, ForgiveInstallmentButton } from "@/components/forms/installment-actions";
import { SettlementPanel } from "@/components/settlement-panel";

export const dynamic = "force-dynamic";

export default async function ContractDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(["ADMIN", "OPERATOR", "CUSTOMER"]);
  const fa = await faDigits();
  const { id } = await params;

  const rows = await db
    .select({ contract: contracts, customer: customers, guarantor: guarantors })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .leftJoin(guarantors, eq(guarantors.id, contracts.guarantorId))
    .where(eq(contracts.id, id))
    .limit(1);
  const row = rows[0];
  if (!row) notFound();

  // Customers may only view their own contracts
  if (u.role === "CUSTOMER" && row.contract.customerId !== u.customerId) notFound();
  const isStaff = u.role !== "CUSTOMER";

  const [insts, paymentRows] = await Promise.all([
    db.select().from(installments).where(eq(installments.contractId, id)).orderBy(asc(installments.seq)),
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        penaltyAmount: payments.penaltyAmount,
        method: payments.method,
        status: payments.status,
        referenceNo: payments.referenceNo,
        isSettlement: payments.isSettlement,
        createdAt: payments.createdAt,
        reviewNote: payments.reviewNote,
        submitter: users.fullName,
      })
      .from(payments)
      .leftJoin(users, eq(users.id, payments.submittedBy))
      .where(eq(payments.contractId, id))
      .orderBy(desc(payments.createdAt)),
  ]);

  const today = todayGreg();
  const finance = await getFinanceSettings();

  const rowsWithState = insts.map((i) => {
    // OVERDUE is derived; PAID/FORGIVEN/RESERVED accrue no further penalty.
    const status = deriveInstallmentStatus(i.status, i.dueDate, today);
    const p =
      status === "PENDING" || status === "OVERDUE"
        ? computePenalty(i.amount, i.dueDate, today, finance, i.penaltyForgiven)
        : { penalty: 0, daysLate: 0 };
    return { ...i, computedStatus: status, penalty: p.penalty, daysLate: p.daysLate };
  });

  // Only truly PENDING installments are payable (RESERVED ones await receipt review).
  const payable = rowsWithState
    .filter((i) => !i.paidAt && i.status === "PENDING")
    .map((i) => ({ id: i.id, seq: i.seq, dueFa: fmtDate(formatJalali(i.dueDate), fa), amount: i.amount, penalty: i.penalty, daysLate: i.daysLate }));

  const paidTotal = paymentRows.filter((p) => p.status === "CONFIRMED").reduce((a, p) => a + p.amount, 0);
  const remainingPrincipal = rowsWithState.filter((i) => !i.paidAt).reduce((a, i) => a + i.amount, 0);
  const livePenalties = rowsWithState.filter((i) => !i.paidAt).reduce((a, i) => a + i.penalty, 0);

  const c = row.contract;
  const isActive = c.status === "ACTIVE";
  // A cash contract is "paid" only when its installment is settled by a confirmed payment.
  const cashSettled = c.type === "CASH" && rowsWithState.every((i) => Boolean(i.paidAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title={
          <span className="flex items-center gap-3">
            قرارداد <span dir="ltr">{c.contractNo}</span> <StatusBadge status={c.status} />
          </span>
        }
        subtitle={c.itemDescription}
        actions={
          <div className="flex items-center gap-2">
            {c.type === "INSTALLMENT" ? <Badge tone="info">اقساطی</Badge> : <Badge tone="success">نقدی</Badge>}
            {c.type === "CASH" ? <StatusBadge status={cashSettled ? "PAID" : "UNPAID"} /> : null}
            <Link href={`/contracts/${c.id}/print`} className="btn btn-outline btn-sm" prefetch={false}>
              <Printer className="size-3.5" />
              چاپ قرارداد
            </Link>
            {u.role === "ADMIN" && isActive ? <CancelContractButton contractId={c.id} /> : null}
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Card><p className="text-xs text-muted">مبلغ کل قرارداد</p><p className="mt-1 text-lg font-bold">{fmtToman(c.totalPrice, fa)}</p>{c.type === "INSTALLMENT" ? <p className="mt-1 text-[11px] text-muted">قیمت نقدی: {fmtToman(c.cashPrice, fa)}</p> : null}</Card>
        <Card><p className="text-xs text-muted">پرداخت‌شده</p><p className="mt-1 text-lg font-bold text-[var(--success)]">{fmtToman(paidTotal + c.downPayment, fa)}</p><p className="mt-1 text-[11px] text-muted">{c.downPayment > 0 ? `شامل ${fmtToman(c.downPayment, fa)} پیش‌پرداخت` : "پرداخت‌های تأییدشده"}</p></Card>
        <Card><p className="text-xs text-muted">مانده اقساط</p><p className="mt-1 text-lg font-bold text-[var(--warning)]">{fmtToman(remainingPrincipal, fa)}</p><p className="mt-1 text-[11px] text-muted">{fmtNum(rowsWithState.filter((i) => !i.paidAt).length, fa)} قسط باقی‌مانده</p></Card>
        <Card><p className="text-xs text-muted">جریمه‌های جاری</p><p className={cx("mt-1 text-lg font-bold", livePenalties > 0 ? "text-[var(--danger)]" : "")}>{fmtToman(livePenalties, fa)}</p><p className="mt-1 text-[11px] text-muted">پس از {fmtNum(finance.graceDays, fa)} روز مهلت ارفاق</p></Card>
      </div>

      {c.discrepancy !== 0 ? (
        <div className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
          مغایرت {fmtToman(Math.abs(c.discrepancy), fa)} {c.discrepancyOverride ? "با تأیید کاربر مجاز روی قسط آخر اعمال شده است" : "در این قرارداد ثبت شده است"}.
          {c.discrepancyOverrideReason ? <span className="block text-xs opacity-90">دلیل: {c.discrepancyOverrideReason}</span> : null}
        </div>
      ) : null}
      {c.notes ? (
        <div className="rounded-2xl border border-base bg-[var(--surface-2)] px-4 py-3 text-sm">
          <span className="text-muted">یادداشت قرارداد: </span>
          {c.notes}
        </div>
      ) : null}
      {c.status === "CANCELED" && c.cancelReason ? (
        <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          دلیل لغو: {c.cancelReason}
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="xl:col-span-2">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <Link href={`/customers/${row.customer.id}`} className="flex items-center gap-2 text-sm font-medium text-brand hover:underline" prefetch={false}>
              <UserRound className="size-4" />
              {row.customer.fullName}
            </Link>
            {row.guarantor ? (
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <ShieldCheck className="size-3.5" />
                ضامن: {row.guarantor.fullName}
              </span>
            ) : null}
            {c.itemSerialNumber ? (
              <span className="text-xs text-muted">سریال: <span dir="ltr">{c.itemSerialNumber}</span></span>
            ) : null}
            {row.contract.firstDueDate ? (
              <span className="ms-auto text-xs text-muted">
                اولین سررسید: {fmtDate(formatJalali(row.contract.firstDueDate), fa)}
                {c.paymentDay ? ` — روز پرداخت ماهانه: ${fmtNum(c.paymentDay, fa)}` : ""}
              </span>
            ) : null}
          </div>

          <h2 className="mb-3 text-sm font-bold">جدول اقساط</h2>
          <TableShell>
            <thead>
              <tr>
                <th>قسط</th>
                <th>سررسید</th>
                <th>مبلغ</th>
                <th>جریمه</th>
                <th>وضعیت</th>
                <th>پرداخت</th>
                {isStaff ? <th></th> : null}
              </tr>
            </thead>
            <tbody>
              {rowsWithState.map((i) => (
                <tr key={i.id} className={cx(i.computedStatus === "OVERDUE" && "bg-[var(--danger-soft)]/40")}>
                  <td className="font-medium">{fmtNum(i.seq, fa)}</td>
                  <td>{fmtDate(formatJalali(i.dueDate), fa)}</td>
                  <td>{fmtToman(i.amount, fa)}</td>
                  <td>
                    {i.penalty > 0 ? (
                      <span className="text-[var(--danger)]">{fmtToman(i.penalty, fa)} <span className="text-[10px]">({fmtNum(i.daysLate, fa)} روز)</span></span>
                    ) : i.penaltyForgiven ? (
                      <Badge tone="muted">بخشوده شد</Badge>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td>
                    <StatusBadge status={i.computedStatus} />
                  </td>
                  <td className="text-xs text-muted">
                    {i.paidAt ? fmtDate(formatJalali(i.paidAt, true), fa) : "—"}
                  </td>
                  {isStaff ? (
                    <td>
                      <div className="flex gap-1">
                        {i.status === "PENDING" ? <SendReminderButton installmentId={i.id} /> : null}
                        {u.role === "ADMIN" && i.status === "PENDING" ? (
                          <>
                            <ChangeDueDateButton installmentId={i.id} currentDueDate={i.dueDate} />
                            {i.penalty > 0 ? <ForgivePenaltyButton installmentId={i.id} /> : null}
                            <ForgiveInstallmentButton installmentId={i.id} />
                          </>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </TableShell>
        </Card>

        {isActive && isStaff ? (
          <Card>
            <h2 className="mb-4 flex items-center gap-2 text-sm font-bold">
              ثبت پرداخت
            </h2>
            <RecordPaymentForm contractId={c.id} payable={payable} />
            {payable.length > 0 ? (
              <div className="mt-5 border-t border-base pt-4">
                <h3 className="mb-2 text-sm font-bold">تسویه زودهنگام</h3>
                <SettlementPanel contractId={c.id} canWaive={u.role === "ADMIN"} />
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-bold">سوابق پرداخت این قرارداد</h2>
        {paymentRows.length === 0 ? (
          <EmptyState title="پرداختی برای این قرارداد ثبت نشده است" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>مبلغ</th>
                <th>جریمه</th>
                <th>روش</th>
                <th>پیگیری</th>
                <th>وضعیت</th>
                <th>ثبت‌کننده</th>
                <th>زمان</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((p) => (
                <tr key={p.id}>
                  <td className="font-medium">{fmtToman(p.amount, fa)}</td>
                  <td>{p.penaltyAmount > 0 ? fmtToman(p.penaltyAmount, fa) : "—"}</td>
                  <td><MethodBadge method={p.method} /></td>
                  <td dir="ltr">{p.referenceNo ?? "—"}</td>
                  <td>
                    <StatusBadge status={p.status} />
                    {p.isSettlement ? <Badge tone="info">تسویه</Badge> : null}
                    {p.status === "REJECTED" && p.reviewNote ? <p className="mt-1 max-w-56 text-[11px] text-muted">{p.reviewNote}</p> : null}
                  </td>
                  <td className="text-xs">{p.submitter ?? "—"}</td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(p.createdAt, true), fa)}</td>
                  <td>{p.status === "CONFIRMED" ? <PrintReceiptLink paymentId={p.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
