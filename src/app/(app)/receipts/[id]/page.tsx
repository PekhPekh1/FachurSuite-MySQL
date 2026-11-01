import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, customers, installments, paymentInstallments, payments, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings-server";
import { formatJalali } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { fmtDate, fmtToman, toFaDigits, PAYMENT_METHOD_FA } from "@/lib/format";
import { PrintButton } from "@/components/controls";
import type { StoreSettings } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser();
  const fa = await faDigits();
  const { id } = await params;

  const rows = await db
    .select({
      payment: payments,
      customer: customers,
      contract: contracts,
      reviewerName: users.fullName,
    })
    .from(payments)
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .leftJoin(users, eq(users.id, payments.reviewedBy))
    .where(eq(payments.id, id))
    .limit(1);

  const r = rows[0];
  if (!r) notFound();
  if (u.role === "CUSTOMER" && r.payment.customerId !== u.customerId) notFound();
  if (r.payment.status !== "CONFIRMED") notFound();

  const links = await db
    .select({ seq: installments.seq, dueDate: installments.dueDate, amount: installments.amount })
    .from(paymentInstallments)
    .innerJoin(installments, eq(installments.id, paymentInstallments.installmentId))
    .where(eq(paymentInstallments.paymentId, id))
    .orderBy(asc(installments.seq));

  const store = await getSetting<StoreSettings>("store", { storeName: "فروشگاه من", phone: null, address: null });

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-muted">پیش‌نمایش رسید — برای ذخیره PDF از گزینه چاپ مرورگر استفاده کنید</p>
        <PrintButton />
      </div>

      <div className="receipt-sheet card overflow-hidden">
        <div className="bg-brand-grad px-8 py-5 text-white">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-lg font-bold">{store.storeName}</h1>
              {store.phone ? <p className="text-xs opacity-90" dir="ltr">{fa ? toFaDigits(store.phone) : store.phone}</p> : null}
            </div>
            <div className="text-left">
              <p className="text-sm font-bold">رسید پرداخت</p>
              <p className="mt-0.5 text-xs opacity-90" dir="ltr">{toFaDigits(id.slice(0, 8).toUpperCase())}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-8 py-6">
          <div className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-3">
            <div><p className="text-xs text-muted">قرارداد</p><p className="mt-1 font-medium" dir="ltr">{r.contract.contractNo}</p></div>
            <div><p className="text-xs text-muted">پرداخت‌کننده</p><p className="mt-1 font-medium">{r.customer.fullName}</p></div>
            <div><p className="text-xs text-muted">کد ملی</p><p className="mt-1 font-medium" dir="ltr">{fa ? toFaDigits(r.customer.nationalCode) : r.customer.nationalCode}</p></div>
            <div><p className="text-xs text-muted">تاریخ پرداخت</p><p className="mt-1 font-medium">{fmtDate(formatJalali(r.payment.createdAt, true), fa)}</p></div>
            <div><p className="text-xs text-muted">روش پرداخت</p><p className="mt-1 font-medium">{PAYMENT_METHOD_FA[r.payment.method]}</p></div>
            {r.payment.referenceNo ? <div><p className="text-xs text-muted">شماره پیگیری</p><p className="mt-1 font-medium" dir="ltr">{fa ? toFaDigits(r.payment.referenceNo) : r.payment.referenceNo}</p></div> : null}
          </div>

          <div className="overflow-hidden rounded-xl border border-base">
            <table className="w-full text-sm [&_td]:px-4 [&_td]:py-2.5 [&_th]:bg-[var(--surface-2)] [&_th]:px-4 [&_th]:py-2.5 [&_th]:text-right [&_th]:text-xs [&_th]:text-[var(--muted)]">
              <thead>
                <tr><th>شرح</th><th>سررسید</th><th className="text-left">مبلغ</th></tr>
              </thead>
              <tbody>
                {links.length === 0 ? (
                  <tr><td colSpan={3} className="text-muted">پرداخت نقدی قرارداد</td></tr>
                ) : (
                  links.map((l) => (
                    <tr key={l.seq} className="border-t border-base">
                      <td>قسط {fmtNumShim(l.seq, fa)}</td>
                      <td>{fmtDate(formatJalali(l.dueDate), fa)}</td>
                      <td className="text-left" dir="ltr">{fa ? toFaDigits(l.amount.toLocaleString("en-US")) : l.amount.toLocaleString("en-US")}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>

          <div className="space-y-1.5 rounded-xl bg-[var(--surface-2)] p-4 text-sm">
            <div className="flex justify-between"><span className="text-muted">اصل مبلغ</span><span>{fmtToman(r.payment.amount - r.payment.penaltyAmount, fa)}</span></div>
            {r.payment.penaltyAmount > 0 ? (
              <div className="flex justify-between"><span className="text-muted">جریمه تأخیر</span><span>{fmtToman(r.payment.penaltyAmount, fa)}</span></div>
            ) : null}
            <div className="flex justify-between border-t border-base pt-2 text-base font-bold"><span>جمع دریافت‌شده</span><span className="text-brand">{fmtToman(r.payment.amount, fa)}</span></div>
            {r.payment.isSettlement ? <p className="pt-1 text-center text-xs text-brand">این پرداخت تسویه کامل قرارداد بوده است</p> : null}
          </div>

          <div className="grid grid-cols-2 gap-8 pt-8 text-center text-xs text-muted">
            <div><p className="border-t border-dashed border-base pt-2">امضای پرداخت‌کننده</p></div>
            <div><p className="border-t border-dashed border-base pt-2">امضای فروشگاه {r.reviewerName ? `(${r.reviewerName})` : ""}</p></div>
          </div>
        </div>
      </div>
    </div>
  );
}

function fmtNumShim(n: number, fa: boolean) {
  const s = n.toLocaleString("en-US");
  return fa ? toFaDigits(s) : s;
}
