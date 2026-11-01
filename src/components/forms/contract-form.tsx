"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, CheckCircle2, CalendarClock } from "lucide-react";
import { createContract } from "@/server/actions/contracts";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { buildInstallmentSchedule, checkContractFinancials } from "@/lib/contracts";
import { formatJalali, gregToJalali } from "@/lib/jalali";
import { toEnDigits, toFaDigits } from "@/lib/format";

export interface CustomerOption {
  id: string;
  fullName: string;
  nationalCode: string;
}
export interface GuarantorOption {
  id: string;
  fullName: string;
  customerId: string;
}

const num = (s: string) => {
  const n = Number(toEnDigits(s).replace(/[^0-9]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const grp = (n: number) => toFaDigits(n.toLocaleString("en-US"));
const newKey = () => (typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

export function ContractForm({
  customers,
  guarantors,
  defaultInstallmentCount = 12,
}: {
  customers: CustomerOption[];
  guarantors: GuarantorOption[];
  defaultInstallmentCount?: number;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const [type, setType] = useState<"CASH" | "INSTALLMENT">("INSTALLMENT");
  const [customerQuery, setCustomerQuery] = useState("");
  const [customerId, setCustomerId] = useState("");
  const [guarantorId, setGuarantorId] = useState("");
  const [itemDescription, setItemDescription] = useState("");
  const [itemSerialNumber, setItemSerialNumber] = useState("");
  const [notes, setNotes] = useState("");
  const [cashPrice, setCashPrice] = useState("");
  const [totalPrice, setTotalPrice] = useState("");
  const [downPayment, setDownPayment] = useState("0");
  const [installmentCount, setInstallmentCount] = useState(String(defaultInstallmentCount));
  const [installmentAmount, setInstallmentAmount] = useState("");
  const [firstDueDate, setFirstDueDate] = useState<string | null>(null);
  const [paymentDay, setPaymentDay] = useState("");
  const [overrideDiscrepancy, setOverrideDiscrepancy] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [idempotencyKey, setIdempotencyKey] = useState(newKey);

  const filteredCustomers = useMemo(() => {
    const q = customerQuery.trim();
    if (!q) return customers.slice(0, 20);
    return customers.filter((c) => c.fullName.includes(q) || c.nationalCode.includes(q)).slice(0, 20);
  }, [customers, customerQuery]);

  const customerGuarantors = useMemo(() => guarantors.filter((g) => g.customerId === customerId), [guarantors, customerId]);

  const cp = num(cashPrice);
  const tp = num(totalPrice);
  const dp = num(downPayment);
  const cnt = num(installmentCount);
  const per = num(installmentAmount);

  const effectivePaymentDay = useMemo(() => {
    const explicit = num(paymentDay);
    if (explicit >= 1 && explicit <= 31) return explicit;
    return firstDueDate ? gregToJalali(firstDueDate).jd : 0;
  }, [paymentDay, firstDueDate]);

  const check = useMemo(
    () => checkContractFinancials({ totalPrice: tp, downPayment: dp, installmentCount: cnt, installmentAmount: per }),
    [tp, dp, cnt, per],
  );

  const preview = useMemo(() => {
    if (type !== "INSTALLMENT" || !firstDueDate || cnt < 1 || per < 1 || !effectivePaymentDay) return null;
    try {
      return buildInstallmentSchedule({
        firstDueDate,
        paymentDay: effectivePaymentDay,
        installmentCount: cnt,
        installmentAmount: per,
        lastInstallmentAdjustment: overrideDiscrepancy ? check.discrepancy : 0,
      });
    } catch {
      return null;
    }
  }, [type, firstDueDate, cnt, per, effectivePaymentDay, overrideDiscrepancy, check.discrepancy]);

  const submit = () =>
    start(async () => {
      if (!customerId) {
        toast.error("مشتری را انتخاب کنید");
        return;
      }
      const res = await createContract({
        customerId,
        type,
        itemDescription,
        itemSerialNumber: itemSerialNumber || null,
        notes: notes || null,
        cashPrice: cp,
        totalPrice: type === "CASH" ? cp : tp,
        downPayment: type === "CASH" ? 0 : dp,
        installmentCount: type === "CASH" ? 1 : cnt,
        installmentAmount: type === "CASH" ? cp : per,
        firstDueDate: type === "CASH" ? null : firstDueDate,
        paymentDay: type === "CASH" ? null : effectivePaymentDay,
        guarantorId: guarantorId || null,
        overrideDiscrepancy,
        overrideReason: overrideReason || null,
        idempotencyKey,
      });
      if (!res.ok) {
        toast.error(res.error, { duration: 9000 });
        return;
      }
      toast.success(res.data?.duplicate ? `این قرارداد قبلاً با شماره ${res.data.contractNo} ثبت شده بود` : `قرارداد ${res.data?.contractNo} ثبت شد`);
      setIdempotencyKey(newKey());
      router.push(`/contracts/${res.data?.id}`);
      router.refresh();
    });

  const numInput = (value: string, set: (v: string) => void, placeholder?: string) => (
    <input className="input" dir="ltr" inputMode="numeric" value={value} placeholder={placeholder} onChange={(e) => set(toEnDigits(e.target.value).replace(/[^0-9]/g, ""))} />
  );

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="space-y-4 lg:col-span-2">
        <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[var(--surface-2)] p-1.5">
          {(["INSTALLMENT", "CASH"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              className={`rounded-xl px-4 py-2.5 text-sm font-medium transition ${type === t ? "bg-brand-grad text-white shadow" : "text-muted hover:text-body"}`}
            >
              {t === "INSTALLMENT" ? "فروش اقساطی" : "فروش نقدی"}
            </button>
          ))}
        </div>

        <div>
          <label className="label">مشتری *</label>
          <input className="input mb-2" placeholder="جستجوی نام یا کد ملی…" value={customerQuery} onChange={(e) => setCustomerQuery(e.target.value)} />
          <select className="input" value={customerId} onChange={(e) => { setCustomerId(e.target.value); setGuarantorId(""); }} size={4}>
            <option value="" disabled>— انتخاب کنید —</option>
            {filteredCustomers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.fullName} — {toFaDigits(c.nationalCode)}
              </option>
            ))}
          </select>
        </div>

        {customerGuarantors.length > 0 && type === "INSTALLMENT" ? (
          <div>
            <label className="label">ضامن (اختیاری)</label>
            <select className="input" value={guarantorId} onChange={(e) => setGuarantorId(e.target.value)}>
              <option value="">بدون ضامن</option>
              {customerGuarantors.map((g) => (
                <option key={g.id} value={g.id}>{g.fullName}</option>
              ))}
            </select>
          </div>
        ) : null}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <label className="label">شرح کالا / خدمت *</label>
            <input className="input" placeholder="مثلاً: یخچال فریزر ال‌جی مدل …" value={itemDescription} onChange={(e) => setItemDescription(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <label className="label">شماره سریال کالا (اختیاری)</label>
            <input className="input" dir="ltr" value={itemSerialNumber} onChange={(e) => setItemSerialNumber(e.target.value)} />
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <label className="label">قیمت نقدی (تومان) *</label>
            {numInput(cashPrice, setCashPrice)}
          </div>
          {type === "INSTALLMENT" ? (
            <>
              <div>
                <label className="label">مبلغ کل اقساطی (تومان) *</label>
                {numInput(totalPrice, setTotalPrice)}
              </div>
              <div>
                <label className="label">پیش‌پرداخت (تومان) *</label>
                {numInput(downPayment, setDownPayment)}
              </div>
              <div>
                <label className="label">تعداد اقساط *</label>
                {numInput(installmentCount, setInstallmentCount)}
              </div>
              <div>
                <label className="label">مبلغ هر قسط (تومان) *</label>
                {numInput(installmentAmount, setInstallmentAmount)}
              </div>
              <div>
                <label className="label">سررسید اولین قسط *</label>
                <JalaliDatePicker value={firstDueDate} onChange={setFirstDueDate} placeholder="انتخاب تاریخ شمسی" />
              </div>
              <div className="sm:col-span-2">
                <label className="label">روز پرداخت ماهانه (۱ تا ۳۱)</label>
                {numInput(paymentDay, setPaymentDay, "پیش‌فرض: روز سررسید اولین قسط")}
                <p className="mt-1 text-[11px] leading-5 text-muted">
                  اگر این روز در ماهی وجود نداشته باشد (مثلاً ۳۱ در ماه‌های ۳۰ روزه)، سررسید آن ماه به «آخرین روز ماه» منتقل می‌شود و ماه بعد دوباره به روز اصلی بازمی‌گردد.
                </p>
              </div>
            </>
          ) : null}
          <div className="sm:col-span-2">
            <label className="label">یادداشت قرارداد</label>
            <textarea className="input min-h-20" value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>

        <button type="button" className="btn btn-primary w-full sm:w-auto" disabled={pending} onClick={submit}>
          {pending ? "در حال ثبت…" : "ثبت قرارداد"}
        </button>
      </div>

      <div className="space-y-4">
        {type === "INSTALLMENT" ? (
          <div className="card space-y-3 p-5">
            <h3 className="text-sm font-bold">کنترل صحت مالی</h3>
            <div className="rounded-xl bg-[var(--surface-2)] p-3 text-center text-sm leading-7" dir="rtl">
              <span>{grp(dp)}</span>
              <span className="text-muted"> + </span>
              <span>{grp(cnt)}</span>
              <span className="text-muted"> × </span>
              <span>{grp(per)}</span>
              <span className="text-muted"> = </span>
              <span className="font-bold">{grp(check.expectedTotal)}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted">مبلغ کل قرارداد</span>
              <span className="font-bold">{grp(tp)} تومان</span>
            </div>
            {tp > 0 && check.expectedTotal > 0 ? (
              check.balanced ? (
                <div className="flex items-center gap-2 rounded-xl bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
                  <CheckCircle2 className="size-4" />
                  اعداد هماهنگ هستند
                </div>
              ) : (
                <div className="space-y-2">
                  <div className="flex items-start gap-2 rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
                    <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                    <span>مغایرت: {grp(Math.abs(check.discrepancy))} تومان {check.discrepancy > 0 ? "کمتر از مبلغ کل" : "بیشتر از مبلغ کل"}</span>
                  </div>
                  <label className="flex cursor-pointer items-center gap-2 text-sm">
                    <input type="checkbox" checked={overrideDiscrepancy} onChange={(e) => setOverrideDiscrepancy(e.target.checked)} className="size-4 accent-[var(--brand)]" />
                    اعمال مغایرت روی قسط آخر (با مجوز)
                  </label>
                  {overrideDiscrepancy ? (
                    <input className="input" placeholder="دلیل اعمال مغایرت *" value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} />
                  ) : null}
                  <p className="text-[11px] leading-5 text-muted">سامانه هیچ مبلغی را خودکار تغییر نمی‌دهد؛ اعمال مغایرت فقط با تأیید شما و همراه با ثبت در گزارش رویدادها انجام می‌شود.</p>
                </div>
              )
            ) : null}
          </div>
        ) : (
          <div className="card p-5 text-sm leading-6 text-muted">
            در فروش نقدی، مبلغ کل برابر قیمت نقدی است. قرارداد پس از ثبت در وضعیت «پرداخت‌نشده» قرار می‌گیرد و تنها با ثبت و تأیید پرداخت، تسویه می‌شود.
          </div>
        )}

        {preview ? (
          <div className="card p-5">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-bold">
              <CalendarClock className="size-4 text-brand" />
              پیش‌نمایش اقساط
            </h3>
            <div className="max-h-72 space-y-1.5 overflow-y-auto text-sm">
              {preview.slice(0, 12).map((p) => (
                <div key={p.seq} className="flex items-center justify-between rounded-xl bg-[var(--surface-2)] px-3 py-1.5">
                  <span className="text-muted">قسط {toFaDigits(p.seq)}</span>
                  <span className={p.clamped ? "text-[var(--warning)]" : ""} title={p.clamped ? "به آخرین روز ماه منتقل شد" : undefined}>
                    {toFaDigits(formatJalali(p.dueDate))}
                  </span>
                  <span className="font-medium">{grp(p.amount)}</span>
                </div>
              ))}
              {preview.length > 12 ? <p className="pt-1 text-center text-xs text-muted">… تا قسط {toFaDigits(preview.length)}</p> : null}
            </div>
            <div className="mt-3 flex justify-between border-t border-base pt-2 text-sm font-bold">
              <span>جمع اقساط</span>
              <span>{grp(preview.reduce((a, r) => a + r.amount, 0))} تومان</span>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
