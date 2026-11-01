import Link from "next/link";
import { desc, eq } from "drizzle-orm";
import { ClipboardCheck, FileDown, ShieldAlert } from "lucide-react";
import { db } from "@/db";
import { contracts, customers, payments, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate, fmtToman } from "@/lib/format";
import { Card, EmptyState, MethodBadge, PageHeader, TableShell } from "@/components/ui";
import { ReviewButtons } from "@/components/forms/payment-forms";

export const dynamic = "force-dynamic";

export default async function PaymentVerificationPage() {
  const user = await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const canReview = user.role === "ADMIN" || user.canReviewPayments;

  const rows = await db
    .select({
      id: payments.id,
      amount: payments.amount,
      penaltyAmount: payments.penaltyAmount,
      method: payments.method,
      referenceNo: payments.referenceNo,
      sourceCardNumber: payments.sourceCardNumber,
      paidAt: payments.paidAt,
      note: payments.note,
      createdAt: payments.createdAt,
      receiptDocumentId: payments.receiptDocumentId,
      contractId: contracts.id,
      contractNo: contracts.contractNo,
      customerName: customers.fullName,
      customerId: customers.id,
      submittedByName: users.fullName,
    })
    .from(payments)
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(users, eq(users.id, payments.submittedBy))
    .where(eq(payments.status, "PENDING_VERIFICATION"))
    .orderBy(desc(payments.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader
        title="بررسی پرداخت‌های کارت‌به‌کارت"
        subtitle="تنها پس از تأیید، اقساط مرتبط پرداخت‌شده و مبلغ به‌عنوان دریافتی محسوب می‌شود"
        actions={
          <Link href="/payments" className="btn btn-outline btn-sm">همه پرداخت‌ها</Link>
        }
      />

      {!canReview ? (
        <div className="flex items-start gap-3 rounded-2xl border border-[var(--warning)]/50 bg-[var(--warning-soft)] p-4 text-sm text-[var(--warning)]">
          <ShieldAlert className="mt-0.5 size-5 shrink-0" />
          شما مجوز مشاهده صف را دارید، اما تأیید یا رد پرداخت برای حساب شما فعال نیست. مدیر سیستم می‌تواند این مجوز را در بخش کاربران فعال کند.
        </div>
      ) : null}

      <Card>
        <div className="mb-4 flex items-center gap-2">
          <ClipboardCheck className="size-4 text-brand" />
          <h2 className="text-sm font-bold">صف بررسی</h2>
          <span className="badge badge-warning">{rows.length} مورد</span>
        </div>
        {rows.length === 0 ? (
          <EmptyState icon={<ClipboardCheck className="size-10" />} title="فیشی در انتظار بررسی نیست" hint="فیش‌های ثبت‌شده توسط مشتریان اینجا نمایش داده می‌شوند" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>مشتری</th>
                <th>قرارداد</th>
                <th>مبلغ</th>
                <th>روش</th>
                <th>پیگیری / کارت مبدأ</th>
                <th>زمان واریز</th>
                <th>ثبت‌کننده</th>
                <th>سند</th>
                <th>عملیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link href={`/customers/${p.customerId}`} className="font-medium text-brand hover:underline" prefetch={false}>{p.customerName}</Link>
                    {p.note ? <p className="mt-1 max-w-44 text-[10px] text-muted">{p.note}</p> : null}
                  </td>
                  <td><Link href={`/contracts/${p.contractId}`} className="text-brand hover:underline" prefetch={false}><span dir="ltr">{p.contractNo}</span></Link></td>
                  <td className="font-bold">
                    {fmtToman(p.amount, fa)}
                    {p.penaltyAmount > 0 ? <p className="text-[10px] font-normal text-muted">جریمه: {fmtToman(p.penaltyAmount, fa)}</p> : null}
                  </td>
                  <td><MethodBadge method={p.method} /></td>
                  <td className="text-xs">
                    <p dir="ltr">{p.referenceNo ?? "—"}</p>
                    {p.sourceCardNumber ? <p className="font-mono text-[10px] text-muted" dir="ltr">{p.sourceCardNumber.slice(0, 4)}-****-****-{p.sourceCardNumber.slice(12)}</p> : null}
                  </td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(p.paidAt ?? p.createdAt, true), fa)}</td>
                  <td className="text-xs">{p.submittedByName ?? "—"}</td>
                  <td>
                    {p.receiptDocumentId ? (
                      <a href={`/api/docs/${p.receiptDocumentId}`} target="_blank" rel="noreferrer" className="btn btn-outline btn-sm" title="مشاهده تصویر فیش">
                        <FileDown className="size-3.5" />
                      </a>
                    ) : (
                      <span className="text-xs text-muted">ندارد</span>
                    )}
                  </td>
                  <td>{canReview ? <ReviewButtons paymentId={p.id} /> : <span className="text-[11px] text-muted">بدون مجوز</span>}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
