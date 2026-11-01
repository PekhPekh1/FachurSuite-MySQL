import Link from "next/link";
import { asc, desc, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import { AlertTriangle, CalendarClock, CheckCircle2, CreditCard, FileText, Wallet } from "lucide-react";
import { db } from "@/db";
import { contracts, customers, installments, payments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { computePenalty, deriveInstallmentStatus } from "@/lib/finance";
import { getFinanceSettings, getSetting } from "@/lib/settings-server";
import { formatJalali, todayGreg } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { cx, fmtDate, fmtNum, fmtToman, toFaDigits, PAYMENT_METHOD_FA, PAYMENT_STATUS_FA } from "@/lib/format";
import { Badge, Card, EmptyState, MethodBadge, StatCard, StatusBadge, TableShell } from "@/components/ui";
import { PrintReceiptLink, SubmitReceiptForm } from "@/components/forms/payment-forms";

export const dynamic = "force-dynamic";

const VIEWS = [
  { key: "UPCOMING", label: "سررسید آینده" },
  { key: "OVERDUE", label: "معوقه" },
  { key: "ALL", label: "همه اقساط" },
] as const;

export default async function PortalPage({ searchParams }: { searchParams: Promise<{ view?: string }> }) {
  // Ownership is always derived from the authenticated session — never from input.
  const u = await requireUser(["CUSTOMER"]);
  const fa = await faDigits();
  const { view = "UPCOMING" } = await searchParams;
  if (!u.customerId) notFound();

  const [customer] = await db.select().from(customers).where(eq(customers.id, u.customerId)).limit(1);
  if (!customer) notFound();

  const myContracts = await db
    .select()
    .from(contracts)
    .where(eq(contracts.customerId, u.customerId))
    .orderBy(desc(contracts.createdAt));

  const today = todayGreg();
  const finance = await getFinanceSettings();

  type Row = typeof installments.$inferSelect & { displayStatus: string; penalty: number; daysLate: number };
  const allRows: (Row & { contractNo: string; contractId: string })[] = [];
  for (const c of myContracts) {
    const rows = await db.select().from(installments).where(eq(installments.contractId, c.id)).orderBy(asc(installments.seq));
    for (const i of rows) {
      const displayStatus = deriveInstallmentStatus(i.status, i.dueDate, today);
      const p =
        displayStatus === "PENDING" || displayStatus === "OVERDUE"
          ? computePenalty(i.amount, i.dueDate, today, finance, i.penaltyForgiven)
          : { penalty: 0, daysLate: 0 };
      allRows.push({ ...i, displayStatus, penalty: p.penalty, daysLate: p.daysLate, contractNo: c.contractNo, contractId: c.id });
    }
  }

  const myPayments = await db
    .select({ payment: payments, contractNo: contracts.contractNo, contractId: contracts.id })
    .from(payments)
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .where(eq(payments.customerId, u.customerId))
    .orderBy(desc(payments.createdAt))
    .limit(50);

  // Bank cards customers may transfer to (only active ones).
  const bankAccounts = await getSetting<{ accounts: { bankName: string; cardNumber: string; cardHolder: string; iban?: string | null; isActive: boolean }[] }>(
    "bank_accounts",
    { accounts: [] },
  );
  const activeCards = bankAccounts.accounts.filter((a) => a.isActive);

  const overdue = allRows.filter((r) => r.displayStatus === "OVERDUE");
  const upcoming = allRows.filter((r) => r.displayStatus === "PENDING" && r.dueDate >= today);
  const pendingReview = allRows.filter((r) => r.displayStatus === "RESERVED");
  const paidCount = allRows.filter((r) => r.displayStatus === "PAID").length;
  const confirmedTotal = myPayments.filter((p) => p.payment.status === "CONFIRMED").reduce((a, p) => a + p.payment.amount, 0);
  const outstanding = allRows.filter((r) => r.displayStatus === "PENDING" || r.displayStatus === "OVERDUE").reduce((a, r) => a + r.amount, 0);
  const overduePenalty = overdue.reduce((a, r) => a + r.penalty, 0);
  const rejectedReceipts = myPayments.filter((p) => p.payment.status === "REJECTED" && p.payment.isResubmittable);

  const visible =
    view === "OVERDUE" ? overdue : view === "ALL" ? allRows : upcoming;

  const byContract = new Map<string, typeof myContracts>();
  for (const c of myContracts) byContract.set(c.id, myContracts.filter((x) => x.id === c.id));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">سلام {customer.fullName}</h1>
        <p className="mt-1 text-sm text-muted">
          خلاصه حساب شما — امروز {fmtDate(formatJalali(today), fa)}
        </p>
      </div>

      {/* Dashboard */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
        <StatCard icon={<FileText className="size-5" />} label="قراردادهای من" value={fmtNum(myContracts.length, fa)} sub={`${fmtNum(myContracts.filter((c) => c.status === "ACTIVE").length, fa)} فعال`} />
        <StatCard icon={<CalendarClock className="size-5" />} label="اقساط آینده" value={fmtNum(upcoming.length, fa)} sub={fmtToman(upcoming.reduce((a, r) => a + r.amount, 0), fa)} />
        <StatCard icon={<AlertTriangle className="size-5" />} label="اقساط معوقه" value={fmtNum(overdue.length, fa)} sub={overduePenalty > 0 ? `جریمه: ${fmtToman(overduePenalty, fa)}` : undefined} tone={overdue.length ? "danger" : "brand"} />
        <StatCard icon={<Wallet className="size-5" />} label="مانده بدهی" value={fmtToman(outstanding, fa)} sub={`${fmtNum(allRows.length - paidCount, fa)} قسط باز`} tone="warning" />
        <StatCard icon={<CheckCircle2 className="size-5" />} label="پرداخت‌شده" value={fmtToman(confirmedTotal, fa)} tone="success" />
      </div>

      {pendingReview.length > 0 ? (
        <div className="rounded-2xl border border-[var(--warning)]/50 bg-[var(--warning-soft)] px-4 py-3 text-sm text-[var(--warning)]">
          {fmtNum(pendingReview.length, fa)} فیش شما در انتظار تأیید فروشگاه است.
        </div>
      ) : null}
      {rejectedReceipts.length > 0 ? (
        <div className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--danger-soft)] px-4 py-3 text-sm text-[var(--danger)]">
          {fmtNum(rejectedReceipts.length, fa)} فیش شما رد شده است. برای ارسال مجدد، دلیل رد در بخش «ثبت فیش» نمایش داده می‌شود.
        </div>
      ) : null}

      {/* My contracts */}
      <Card>
        <h2 className="mb-4 text-sm font-bold">قراردادهای من</h2>
        {myContracts.length === 0 ? (
          <EmptyState icon={<FileText className="size-10" />} title="قراردادی برای شما ثبت نشده است" hint="در صورت مغایرت با فروشگاه تماس بگیرید" />
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {myContracts.map((c) => {
              const rows = byContract.get(c.id) ?? [];
              const insts = allRows.filter((r) => r.contractId === c.id);
              const paid = insts.filter((r) => r.displayStatus === "PAID").length;
              const progress = insts.length ? Math.round((paid / insts.length) * 100) : 0;
              return (
                <div key={c.id} className="rounded-2xl border border-base p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-bold" dir="ltr">{c.contractNo}</span>
                    <StatusBadge status={c.status} />
                    <Badge tone={c.type === "CASH" ? "success" : "info"}>{c.type === "CASH" ? "نقدی" : "اقساطی"}</Badge>
                    <span className="ms-auto text-sm font-bold">{fmtToman(c.totalPrice, fa)}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted">{c.itemDescription}</p>
                  <div className="mt-3 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
                    <div className="h-full rounded-full bg-brand-grad" style={{ width: `${progress}%` }} />
                  </div>
                  <p className="mt-1 text-[11px] text-muted">
                    {fmtNum(paid, fa)} از {fmtNum(insts.length, fa)} قسط پرداخت شده ({toFaDigits(progress)}٪)
                    {rows.length ? ` — ثبت ${fmtDate(formatJalali(c.createdAt), fa)}` : ""}
                  </p>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Installment schedule */}
      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-bold">برنامه اقساط من</h2>
          <div className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <Link
                key={v.key}
                href={`/portal?view=${v.key}`}
                className={cx("btn btn-sm", view === v.key ? "btn-primary" : "btn-outline")}
                prefetch={false}
              >
                {v.label}
              </Link>
            ))}
          </div>
        </div>
        {visible.length === 0 ? (
          <EmptyState title="قسطی در این دسته وجود ندارد" hint="دسته دیگری را انتخاب کنید" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>قرارداد</th>
                <th>قسط</th>
                <th>سررسید</th>
                <th>مبلغ</th>
                <th>جریمه</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {visible.slice(0, 60).map((r) => (
                <tr key={r.id} className={cx(r.displayStatus === "OVERDUE" && "bg-[var(--danger-soft)]/40")}>
                  <td><span dir="ltr">{r.contractNo}</span></td>
                  <td>{fmtNum(r.seq, fa)}</td>
                  <td>{fmtDate(formatJalali(r.dueDate), fa)}</td>
                  <td className="font-medium">{fmtToman(r.amount, fa)}</td>
                  <td>
                    {r.penalty > 0 ? <span className="text-[var(--danger)]">{fmtToman(r.penalty, fa)}</span> : r.penaltyForgiven ? <Badge tone="muted">بخشوده شد</Badge> : "—"}
                  </td>
                  <td><StatusBadge status={r.displayStatus} /></td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      {/* Bank cards + receipt submission */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card>
          <h2 className="mb-1 flex items-center gap-2 text-sm font-bold">
            <CreditCard className="size-4 text-brand" />
            کارت‌های فروشگاه
          </h2>
          <p className="mb-4 text-[11px] leading-5 text-muted">
            مبلغ را به یکی از کارت‌های زیر واریز کنید و سپس فیش را ثبت نمایید.
          </p>
          {activeCards.length === 0 ? (
            <EmptyState title="کارت بانکی ثبت نشده است" hint="برای دریافت شماره کارت با فروشگاه تماس بگیرید" />
          ) : (
            <ul className="space-y-3">
              {activeCards.map((card, index) => (
                <li key={index} className="rounded-2xl border border-base p-3">
                  <p className="text-xs text-muted">{card.bankName}</p>
                  <p className="mt-1 font-mono text-sm font-bold tracking-wider" dir="ltr">
                    {fa ? toFaDigits(card.cardNumber) : card.cardNumber}
                  </p>
                  <p className="mt-1 text-[11px] text-muted">به نام {card.cardHolder}</p>
                  {card.iban ? <p className="mt-0.5 font-mono text-[10px] text-muted" dir="ltr">{card.iban}</p> : null}
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <h2 className="mb-4 text-sm font-bold">ثبت فیش کارت‌به‌کارت</h2>
          {myContracts.filter((c) => c.status === "ACTIVE").length === 0 ? (
            <EmptyState title="قرارداد فعالی برای پرداخت ندارید" />
          ) : (
            <div className="space-y-4">
              {myContracts
                .filter((c) => c.status === "ACTIVE")
                .map((c) => {
                  const payable = allRows
                    .filter((r) => r.contractId === c.id && r.status === "PENDING")
                    .map((r) => ({ id: r.id, seq: r.seq, dueFa: fmtDate(formatJalali(r.dueDate), fa), amount: r.amount, penalty: r.penalty, daysLate: r.daysLate }));
                  if (payable.length === 0) return null;
                  return (
                    <details key={c.id} className="rounded-2xl border border-base p-4">
                      <summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-bold">
                        <span dir="ltr">{c.contractNo}</span>
                        <span className="text-xs font-normal text-muted">{c.itemDescription}</span>
                        <span className="ms-auto text-xs text-muted">{fmtNum(payable.length, fa)} قسط قابل پرداخت</span>
                      </summary>
                      <div className="mt-4">
                        <SubmitReceiptForm
                          contractId={c.id}
                          payable={payable}
                          rejectedPayments={rejectedReceipts
                            .filter((r) => r.contractId === c.id)
                            .map((r) => ({ id: r.payment.id, referenceNo: r.payment.referenceNo, reviewNote: r.payment.reviewNote, amount: r.payment.amount }))}
                        />
                      </div>
                    </details>
                  );
                })}
            </div>
          )}
        </Card>
      </div>

      {/* Payment history */}
      <Card>
        <h2 className="mb-4 text-sm font-bold">سوابق پرداخت و وضعیت فیش‌ها</h2>
        {myPayments.length === 0 ? (
          <EmptyState title="پرداختی ثبت نشده است" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>قرارداد</th>
                <th>مبلغ</th>
                <th>جریمه</th>
                <th>روش</th>
                <th>پیگیری</th>
                <th>کارت مبدأ</th>
                <th>وضعیت</th>
                <th>زمان</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {myPayments.map(({ payment: p, contractNo }) => (
                <tr key={p.id}>
                  <td><span dir="ltr">{contractNo}</span></td>
                  <td className="font-medium">{fmtToman(p.amount, fa)}</td>
                  <td>{p.penaltyAmount > 0 ? fmtToman(p.penaltyAmount, fa) : "—"}</td>
                  <td><MethodBadge method={p.method} /></td>
                  <td dir="ltr" className="text-xs">{p.referenceNo ?? "—"}</td>
                  <td dir="ltr" className="font-mono text-[11px] text-muted">
                    {p.sourceCardNumber ? `${p.sourceCardNumber.slice(0, 4)}-****-****-${p.sourceCardNumber.slice(12)}` : "—"}
                  </td>
                  <td>
                    <StatusBadge status={p.status} />
                    {p.status === "REJECTED" && p.reviewNote ? (
                      <p className="mt-1 max-w-56 text-[11px] leading-5 text-[var(--danger)]">دلیل رد: {p.reviewNote}</p>
                    ) : null}
                    {p.status === "PENDING_VERIFICATION" ? (
                      <p className="mt-1 text-[11px] text-muted">{PAYMENT_STATUS_FA.PENDING_VERIFICATION}</p>
                    ) : null}
                    {p.isSettlement ? <Badge tone="info">تسویه</Badge> : null}
                  </td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(p.paidAt ?? p.createdAt, true), fa)}</td>
                  <td>{p.status === "CONFIRMED" ? <PrintReceiptLink paymentId={p.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <p className="text-center text-[11px] leading-6 text-muted">
        شما فقط به اطلاعات حساب خودتان دسترسی دارید. روش پرداخت: {PAYMENT_METHOD_FA.CARD_TO_CARD} —
        پس از ثبت فیش، تأیید توسط فروشگاه انجام می‌شود.
      </p>
    </div>
  );
}
