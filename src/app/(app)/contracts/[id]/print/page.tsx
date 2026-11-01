import { notFound } from "next/navigation";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { contracts, customers, guarantors, installments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings-server";
import { formatJalali, todayGreg } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { fmtDate, fmtNum, fmtToman, toFaDigits, CONTRACT_STATUS_FA } from "@/lib/format";
import { PrintButton } from "@/components/controls";
import type { StoreSettings } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function ContractPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
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
  if (user.role === "CUSTOMER" && row.contract.customerId !== user.customerId) notFound();

  const schedule = await db.select().from(installments).where(eq(installments.contractId, id)).orderBy(asc(installments.seq));
  const store = await getSetting<StoreSettings>("store", { storeName: "فروشگاه من", phone: null, address: null });
  const c = row.contract;
  const isInstallment = c.type === "INSTALLMENT";

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-muted">پیش‌نمایش قرارداد — برای ذخیره PDF از چاپ مرورگر استفاده کنید</p>
        <PrintButton />
      </div>

      <div className="receipt-sheet card overflow-hidden">
        <div className="bg-brand-grad px-8 py-5 text-white">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-lg font-bold">{store.storeName}</h1>
              {store.phone ? <p className="text-xs opacity-90" dir="ltr">{fa ? toFaDigits(store.phone) : store.phone}</p> : null}
              {store.address ? <p className="mt-0.5 text-xs opacity-80">{store.address}</p> : null}
            </div>
            <div className="text-left">
              <p className="text-sm font-bold">{isInstallment ? "قرارداد فروش اقساطی" : "قرارداد فروش نقدی"}</p>
              <p className="mt-0.5 text-xs opacity-90" dir="ltr">{c.contractNo}</p>
              <p className="mt-0.5 text-[11px] opacity-80">{fmtDate(formatJalali(c.createdAt), fa)}</p>
            </div>
          </div>
        </div>

        <div className="space-y-5 px-8 py-6">
          <section>
            <h2 className="mb-2 text-sm font-bold">مشخصات خریدار</h2>
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div><p className="text-xs text-muted">نام و نام خانوادگی</p><p className="mt-0.5 font-medium">{row.customer.fullName}</p></div>
              <div><p className="text-xs text-muted">کد ملی</p><p className="mt-0.5 font-medium" dir="ltr">{fa ? toFaDigits(row.customer.nationalCode) : row.customer.nationalCode}</p></div>
              <div><p className="text-xs text-muted">موبایل</p><p className="mt-0.5 font-medium" dir="ltr">{fa ? toFaDigits(row.customer.mobile) : row.customer.mobile}</p></div>
              {row.customer.address ? <div className="col-span-2 sm:col-span-3"><p className="text-xs text-muted">نشانی</p><p className="mt-0.5">{row.customer.address}</p></div> : null}
            </div>
          </section>

          {row.guarantor ? (
            <section className="border-t border-base pt-4">
              <h2 className="mb-2 text-sm font-bold">مشخصات ضامن</h2>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
                <div><p className="text-xs text-muted">نام</p><p className="mt-0.5 font-medium">{row.guarantor.fullName}</p></div>
                {row.guarantor.nationalCode ? <div><p className="text-xs text-muted">کد ملی</p><p className="mt-0.5 font-medium" dir="ltr">{fa ? toFaDigits(row.guarantor.nationalCode) : row.guarantor.nationalCode}</p></div> : null}
                {row.guarantor.mobile ? <div><p className="text-xs text-muted">موبایل</p><p className="mt-0.5 font-medium" dir="ltr">{fa ? toFaDigits(row.guarantor.mobile) : row.guarantor.mobile}</p></div> : null}
              </div>
            </section>
          ) : null}

          <section className="border-t border-base pt-4">
            <h2 className="mb-2 text-sm font-bold">موضوع قرارداد</h2>
            <p className="text-sm">{c.itemDescription}</p>
            {c.itemSerialNumber ? <p className="mt-1 text-xs text-muted">شماره سریال: <span dir="ltr">{c.itemSerialNumber}</span></p> : null}
          </section>

          <section className="grid grid-cols-2 gap-3 border-t border-base pt-4 text-sm sm:grid-cols-4">
            <div><p className="text-xs text-muted">قیمت نقدی</p><p className="mt-0.5 font-medium">{fmtToman(c.cashPrice, fa)}</p></div>
            <div><p className="text-xs text-muted">مبلغ کل قرارداد</p><p className="mt-0.5 font-bold">{fmtToman(c.totalPrice, fa)}</p></div>
            {isInstallment ? (
              <>
                <div><p className="text-xs text-muted">پیش‌پرداخت</p><p className="mt-0.5 font-medium">{fmtToman(c.downPayment, fa)}</p></div>
                <div><p className="text-xs text-muted">تعداد اقساط</p><p className="mt-0.5 font-medium">{fmtNum(c.installmentCount, fa)} قسط</p></div>
                <div><p className="text-xs text-muted">مبلغ هر قسط</p><p className="mt-0.5 font-medium">{fmtToman(c.installmentAmount, fa)}</p></div>
                <div><p className="text-xs text-muted">روز پرداخت ماهانه</p><p className="mt-0.5 font-medium">{c.paymentDay ? fmtNum(c.paymentDay, fa) : "—"}</p></div>
              </>
            ) : null}
            <div><p className="text-xs text-muted">وضعیت</p><p className="mt-0.5 font-medium">{CONTRACT_STATUS_FA[c.status]}</p></div>
          </section>

          {isInstallment ? (
            <section className="border-t border-base pt-4">
              <h2 className="mb-2 text-sm font-bold">جدول اقساط</h2>
              <div className="overflow-hidden rounded-xl border border-base">
                <table className="w-full text-sm [&_td]:px-3 [&_td]:py-2 [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-2 [&_th]:text-right [&_th]:text-xs [&_th]:text-[var(--muted)]">
                  <thead><tr><th>قسط</th><th>سررسید</th><th className="text-left">مبلغ (تومان)</th></tr></thead>
                  <tbody>
                    {schedule.map((i) => (
                      <tr key={i.id} className="border-t border-base">
                        <td>{fmtNum(i.seq, fa)}</td>
                        <td>{fmtDate(formatJalali(i.dueDate), fa)}</td>
                        <td className="text-left" dir="ltr">{fmtNum(i.amount, fa)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {c.discrepancyOverride ? (
                <p className="mt-2 text-[11px] text-muted">
                  توضیح: اختلاف {fmtToman(Math.abs(c.discrepancy), fa)} با تأیید کاربر مجاز روی قسط آخر اعمال شده است.
                </p>
              ) : null}
            </section>
          ) : null}

          {c.notes ? (
            <section className="border-t border-base pt-4">
              <h2 className="mb-1 text-sm font-bold">توضیحات</h2>
              <p className="text-xs leading-6 text-muted">{c.notes}</p>
            </section>
          ) : null}

          <section className="grid grid-cols-2 gap-8 pt-10 text-center text-xs text-muted">
            <div><p className="border-t border-dashed border-base pt-2">امضای خریدار</p></div>
            <div><p className="border-t border-dashed border-base pt-2">امضای فروشنده</p></div>
          </section>
          <p className="pt-2 text-center text-[10px] text-muted">تاریخ چاپ: {fmtDate(formatJalali(todayGreg()), fa)}</p>
        </div>
      </div>
    </div>
  );
}
