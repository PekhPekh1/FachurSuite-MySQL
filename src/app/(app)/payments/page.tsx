import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import { Hourglass, Wallet } from "lucide-react";
import { db } from "@/db";
import { contracts, customers, payments, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { formatJalali, todayGreg } from "@/lib/jalali";
import { fmtDate, fmtNum, fmtToman, toFaDigits, PAYMENT_METHOD_FA, PAYMENT_STATUS_FA } from "@/lib/format";
import { Card, EmptyState, MethodBadge, PageHeader, StatusBadge, TableShell, Badge } from "@/components/ui";
import { PendingPaymentsTable } from "@/components/payments-table";
import { ExportXlsxButton } from "@/components/export-xlsx";
import { PrintReceiptLink } from "@/components/forms/payment-forms";

export const dynamic = "force-dynamic";

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string; method?: string }> }) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const { status = "", method = "" } = await searchParams;

  const conds = [];
  if (status === "PENDING_VERIFICATION" || status === "CONFIRMED" || status === "REJECTED") conds.push(eq(payments.status, status));
  if (method === "CASH" || method === "CARD_READER" || method === "CARD_TO_CARD") conds.push(eq(payments.method, method));

  const [pendingRows, rows] = await Promise.all([
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        method: payments.method,
        referenceNo: payments.referenceNo,
        createdAt: payments.createdAt,
        contractNo: contracts.contractNo,
        customerName: customers.fullName,
        submittedByName: users.fullName,
      })
      .from(payments)
      .innerJoin(contracts, eq(contracts.id, payments.contractId))
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .leftJoin(users, eq(users.id, payments.submittedBy))
      .where(eq(payments.status, "PENDING_VERIFICATION"))
      .orderBy(desc(payments.createdAt)),
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        penaltyAmount: payments.penaltyAmount,
        method: payments.method,
        status: payments.status,
        referenceNo: payments.referenceNo,
        isSettlement: payments.isSettlement,
        reviewNote: payments.reviewNote,
        createdAt: payments.createdAt,
        contractId: payments.contractId,
        contractNo: contracts.contractNo,
        customerName: customers.fullName,
      })
      .from(payments)
      .innerJoin(contracts, eq(contracts.id, payments.contractId))
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(desc(payments.createdAt))
      .limit(200),
  ]);

  const confirmedSum = rows.filter((r) => r.status === "CONFIRMED").reduce((a, r) => a + r.amount, 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="پرداخت‌ها"
        subtitle="ثبت، بررسی و ردیابی تمام دریافت‌های فروشگاه"
        actions={
          <ExportXlsxButton
            fileName={`payments-${todayGreg()}`}
            sheets={[
              {
                name: "پرداخت‌ها",
                rows: rows.map((r) => ({
                  "شماره قرارداد": r.contractNo,
                  مشتری: r.customerName,
                  "مبلغ (تومان)": r.amount,
                  "جریمه (تومان)": r.penaltyAmount,
                  روش: PAYMENT_METHOD_FA[r.method] ?? r.method,
                  وضعیت: PAYMENT_STATUS_FA[r.status] ?? r.status,
                  پیگیری: r.referenceNo ?? "",
                  تاریخ: formatJalali(r.createdAt, true),
                })),
              },
            ]}
          />
        }
      />

      <Card className={pendingRows.length > 0 ? "border-[var(--warning)]/50" : ""}>
        <div className="mb-4 flex items-center gap-2">
          <Hourglass className="size-4 text-[var(--warning)]" />
          <h2 className="text-sm font-bold">صف بررسی فیش‌های کارت‌به‌کارت</h2>
          {pendingRows.length > 0 ? <Badge tone="warning">{fmtNum(pendingRows.length, fa)} مورد</Badge> : null}
        </div>
        {pendingRows.length === 0 ? (
          <EmptyState title="فیشی در انتظار بررسی نیست" hint="فیش‌های ثبت‌شده توسط مشتریان یا کارکنان اینجا نمایش داده می‌شوند" />
        ) : (
          <PendingPaymentsTable
            rows={pendingRows.map((p) => ({
              id: p.id,
              contractNo: p.contractNo,
              customerName: p.customerName,
              amountFa: fmtToman(p.amount, fa),
              method: p.method,
              referenceNo: p.referenceNo,
              createdFa: fmtDate(formatJalali(p.createdAt, true), fa),
              submittedByName: p.submittedByName ?? "—",
            }))}
          />
        )}
      </Card>

      <Card>
        <div className="mb-4 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Wallet className="size-4 text-brand" />
            <h2 className="text-sm font-bold">همه پرداخت‌ها</h2>
          </div>
          <span className="text-xs text-muted">جمع تأییدشده در این نما: {fmtToman(confirmedSum, fa)}</span>
        </div>

        <form className="mb-4 flex flex-wrap gap-2" action="/payments" method="get">
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="">همه وضعیت‌ها</option>
            <option value="PENDING_VERIFICATION">در انتظار بررسی</option>
            <option value="CONFIRMED">تأیید شده</option>
            <option value="REJECTED">رد شده</option>
          </select>
          <select name="method" defaultValue={method} className="input w-auto">
            <option value="">همه روش‌ها</option>
            <option value="CASH">نقدی</option>
            <option value="CARD_READER">کارتخوان</option>
            <option value="CARD_TO_CARD">کارت به کارت</option>
          </select>
          <button type="submit" className="btn btn-outline">اعمال فیلتر</button>
        </form>

        {rows.length === 0 ? (
          <EmptyState title="پرداختی یافت نشد" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>مشتری</th>
                <th>قرارداد</th>
                <th>مبلغ</th>
                <th>روش</th>
                <th>وضعیت</th>
                <th>پیگیری</th>
                <th>زمان</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="transition hover:bg-[var(--surface-2)]/60">
                  <td className="font-medium">{r.customerName}</td>
                  <td>
                    <Link href={`/contracts/${r.contractId}`} className="text-brand hover:underline" prefetch={false}>
                      <span dir="ltr">{r.contractNo}</span>
                    </Link>
                  </td>
                  <td>
                    {fmtToman(r.amount, fa)}
                    {r.penaltyAmount > 0 ? <span className="ms-1 text-[10px] text-muted">(جریمه: {toFaDigits(r.penaltyAmount.toLocaleString("en-US"))})</span> : null}
                  </td>
                  <td>
                    <MethodBadge method={r.method} />
                    {r.isSettlement ? <Badge tone="info">تسویه</Badge> : null}
                  </td>
                  <td><StatusBadge status={r.status} /></td>
                  <td dir="ltr" className="text-xs">{r.referenceNo ?? "—"}</td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(r.createdAt, true), fa)}</td>
                  <td>{r.status === "CONFIRMED" ? <PrintReceiptLink paymentId={r.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
