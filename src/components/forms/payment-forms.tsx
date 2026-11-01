"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgeCheck, BellRing, Ban, HandCoins, Landmark, ReceiptText } from "lucide-react";
import { Modal } from "@/components/modal";
import { cancelContract } from "@/server/actions/contracts";
import { createPayment, forgivePenalty, reviewPayment, sendReminder } from "@/server/actions/payments";
import { toEnDigits, toFaDigits } from "@/lib/format";

export interface PayableInstallment {
  id: string;
  seq: number;
  dueFa: string;
  amount: number;
  penalty: number; // already 0 when forgiven
  daysLate: number;
}

const grp = (n: number) => toFaDigits(n.toLocaleString("en-US"));
const newKey = () => (typeof crypto !== "undefined" ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/* --------------------- shared: sequential installment picker --------------------- */

function InstallmentPicker({
  payable,
  count,
  setCount,
  locked,
}: {
  payable: PayableInstallment[];
  count: number;
  setCount: (n: number) => void;
  locked: boolean;
}) {
  return (
    <div className="max-h-56 space-y-1.5 overflow-y-auto rounded-xl border border-base p-2">
      {payable.map((p, i) => {
        const checked = i < count;
        return (
          <label
            key={p.id}
            className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 text-sm transition ${checked ? "bg-brand-soft" : "hover:bg-[var(--surface-2)]"}`}
          >
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={checked}
              disabled={locked}
              onChange={(e) => setCount(e.target.checked ? i + 1 : i)}
            />
            <span className="text-muted">قسط {toFaDigits(p.seq)}</span>
            <span className="ms-auto text-muted">{p.dueFa}</span>
            <span className="font-medium">{grp(p.amount)}</span>
            {p.penalty > 0 ? <span className="rounded-full bg-[var(--danger-soft)] px-2 py-0.5 text-[11px] text-[var(--danger)]">جریمه {grp(p.penalty)}</span> : null}
          </label>
        );
      })}
    </div>
  );
}

/* ------------------------------- staff: record payment ------------------------------ */

export function RecordPaymentForm({ contractId, payable }: { contractId: string; payable: PayableInstallment[] }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [count, setCount] = useState(payable.length > 0 ? 1 : 0);
  const [settle, setSettle] = useState(false);
  const [waive, setWaive] = useState(false);
  const [method, setMethod] = useState<"CASH" | "CARD_READER" | "CARD_TO_CARD">("CARD_READER");
  const [referenceNo, setReferenceNo] = useState("");
  const [sourceCard, setSourceCard] = useState("");
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [idem, setIdem] = useState(newKey);
  const formRef = useRef(0);

  const selected = useMemo(() => payable.slice(0, settle ? payable.length : count), [payable, count, settle]);
  const principal = selected.reduce((a, p) => a + p.amount, 0);
  const penalty = selected.reduce((a, p) => a + p.penalty, 0);
  const countedPenalty = waive ? 0 : penalty;
  const total = principal + countedPenalty;

  if (payable.length === 0) {
    return <p className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm text-muted">اقساط پرداخت‌نشده‌ای وجود ندارد.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">اقساط تحت پوشش (به ترتیب)</label>
        <InstallmentPicker payable={payable} count={settle ? payable.length : count} setCount={setCount} locked={settle} />
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4 accent-[var(--brand)]"
            checked={settle}
            onChange={(e) => setSettle(e.target.checked)}
          />
          تسویه کامل قرارداد
        </label>
        {penalty > 0 ? (
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={waive} onChange={(e) => setWaive(e.target.checked)} />
            عدم دریافت جریمه (با مجوز کاربر)
          </label>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">روش پرداخت</label>
          <select className="input" value={method} onChange={(e) => setMethod(e.target.value as typeof method)}>
            <option value="CASH">نقدی</option>
            <option value="CARD_READER">کارتخوان</option>
            <option value="CARD_TO_CARD">کارت به کارت (نیازمند بررسی)</option>
          </select>
        </div>
        <div>
          <label className="label">شماره پیگیری {method === "CARD_TO_CARD" ? "*" : "(اختیاری)"}</label>
          <input className="input" dir="ltr" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
        </div>
        <div>
          <label className="label">تاریخ و ساعت پرداخت</label>
          <input
            className="input"
            type="datetime-local"
            onChange={(e) => setPaidAt(e.target.value ? new Date(e.target.value).toISOString() : null)}
          />
        </div>
        {method === "CARD_TO_CARD" ? (
          <div>
            <label className="label">شماره کارت مبدأ (۱۶ رقم) *</label>
            <input
              className="input"
              dir="ltr"
              inputMode="numeric"
              maxLength={16}
              value={sourceCard}
              onChange={(e) => setSourceCard(toEnDigits(e.target.value).replace(/[^0-9]/g, "").slice(0, 16))}
            />
          </div>
        ) : null}
      </div>

      <div>
        <label className="label">یادداشت</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      <div className="rounded-xl bg-[var(--surface-2)] p-4 text-sm leading-7">
        <div className="flex justify-between"><span className="text-muted">اصل اقساط ({toFaDigits(selected.length)} قسط)</span><span>{grp(principal)} تومان</span></div>
        <div className="flex justify-between"><span className="text-muted">جریمه تأخیر</span><span className={penalty > 0 && countedPenalty === 0 ? "text-muted line-through" : ""}>{grp(countedPenalty)} تومان</span></div>
        <div className="mt-1 flex justify-between border-t border-base pt-2 font-bold"><span>قابل دریافت</span><span className="text-brand">{grp(total)} تومان</span></div>
      </div>

      {method === "CARD_TO_CARD" ? (
        <p className="rounded-xl bg-[var(--warning-soft)] px-4 py-2.5 text-xs leading-6 text-[var(--warning)]">
          پرداخت کارت‌به‌کارت تا زمان تأیید توسط مدیر/کاربر مجاز، اقساط را پرداخت‌شده نمی‌کند.
        </p>
      ) : null}

      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={pending || selected.length === 0}
        onClick={() => {
          if (method === "CARD_TO_CARD" && referenceNo.trim().length < 3) {
            toast.error("شماره پیگیری فیش کارت‌به‌کارت الزامی است");
            return;
          }
          if (method === "CARD_TO_CARD" && sourceCard.length !== 16) {
            toast.error("شماره کارت مبدأ باید ۱۶ رقم باشد");
            return;
          }
          const key = idem;
          start(async () => {
            const res = await createPayment({
              contractId,
              installmentIds: selected.map((s) => s.id),
              method,
              amount: total,
              paidAt,
              sourceCardNumber: method === "CARD_TO_CARD" ? sourceCard : null,
              referenceNo: referenceNo || null,
              note: note || null,
              idempotencyKey: key,
              settle,
              waivePenalties: waive,
            });
            if (!res.ok) {
              toast.error(res.error, { duration: 7000 });
              return;
            }
            toast.success(method === "CARD_TO_CARD" ? "فیش ثبت و در صف بررسی قرار گرفت" : "پرداخت با موفقیت ثبت شد");
            setIdem(newKey());
            setNote("");
            setReferenceNo("");
            formRef.current += 1;
            router.refresh();
          });
        }}
      >
        <HandCoins className="size-4" />
        {pending ? "در حال ثبت…" : `ثبت پرداخت ${grp(total)} تومان`}
      </button>
    </div>
  );
}

/* ----------------------------- customer: submit receipt ---------------------------- */

export function SubmitReceiptForm({
  contractId,
  payable,
  rejectedPayments = [],
}: {
  contractId: string;
  payable: PayableInstallment[];
  rejectedPayments?: { id: string; referenceNo: string | null; reviewNote: string | null; amount: number }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [count, setCount] = useState(payable.length > 0 ? 1 : 0);
  const [settle, setSettle] = useState(false);
  const [referenceNo, setReferenceNo] = useState("");
  const [sourceCard, setSourceCard] = useState("");
  const [paidAt, setPaidAt] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [receiptDocId, setReceiptDocId] = useState<string | null>(null);
  const [idem, setIdem] = useState(newKey);
  const [paymentId] = useState(newKey);
  const [uploading, setUploading] = useState(false);
  const [resubmissionOf, setResubmissionOf] = useState<string | null>(null);

  const selected = useMemo(() => payable.slice(0, settle ? payable.length : count), [payable, count, settle]);
  const total = selected.reduce((a, p) => a + p.amount + p.penalty, 0);

  if (payable.length === 0) {
    return <p className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm text-muted">قسط پرداخت‌نشده‌ای ندارید.</p>;
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="label">اقساط مورد پرداخت</label>
        <InstallmentPicker payable={payable} count={settle ? payable.length : count} setCount={setCount} locked={settle} />
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={settle} onChange={(e) => setSettle(e.target.checked)} />
        تسویه کامل
      </label>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">شماره پیگیری فیش *</label>
          <input className="input" dir="ltr" value={referenceNo} onChange={(e) => setReferenceNo(e.target.value)} />
        </div>
        <div>
          <label className="label">شماره کارت مبدأ (۱۶ رقم) *</label>
          <input
            className="input"
            dir="ltr"
            inputMode="numeric"
            maxLength={16}
            value={sourceCard}
            onChange={(e) => setSourceCard(toEnDigits(e.target.value).replace(/[^0-9]/g, "").slice(0, 16))}
          />
        </div>
        <div>
          <label className="label">تاریخ و ساعت واریز</label>
          <input
            className="input"
            type="datetime-local"
            onChange={(e) => setPaidAt(e.target.value ? new Date(e.target.value).toISOString() : null)}
          />
        </div>
        <div>
          <label className="label">تصویر فیش (اختیاری)</label>
          <input
            type="file"
            accept="image/jpeg,image/png,application/pdf"
            className="input py-2 text-xs"
            disabled={uploading}
            onChange={async (e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              setUploading(true);
              const fd = new FormData();
              fd.set("file", file);
              fd.set("ownerType", "payment");
              fd.set("ownerId", paymentId);
              const res = await fetch("/api/upload", { method: "POST", body: fd });
              const body = (await res.json().catch(() => ({}))) as { id?: string; error?: string };
              setUploading(false);
              if (!res.ok || !body.id) {
                toast.error(body.error ?? "بارگذاری ناموفق بود");
                return;
              }
              setReceiptDocId(body.id);
              toast.success("تصویر فیش پیوست شد");
            }}
          />
        </div>
      </div>
      <div>
        <label className="label">توضیح</label>
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
      </div>

      {rejectedPayments.length > 0 ? (
        <div>
          <label className="label">ارسال مجدد فیش ردشده</label>
          <select
            className="input"
            value={resubmissionOf ?? ""}
            onChange={(e) => setResubmissionOf(e.target.value || null)}
          >
            <option value="">— ارسال جدید —</option>
            {rejectedPayments.map((r) => (
              <option key={r.id} value={r.id}>
                {r.referenceNo ?? "بدون پیگیری"} — {grp(r.amount)} تومان
              </option>
            ))}
          </select>
          {resubmissionOf ? (
            <p className="mt-1 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--danger)]">
              {rejectedPayments.find((r) => r.id === resubmissionOf)?.reviewNote ?? "دلیل رد ثبت نشده است"}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex items-center justify-between rounded-xl bg-[var(--surface-2)] p-4 text-sm font-bold">
        <span>مبلغ قابل واریز</span>
        <span className="text-brand">{grp(total)} تومان</span>
      </div>
      <button
        type="button"
        className="btn btn-primary w-full"
        disabled={pending || selected.length === 0 || uploading}
        onClick={() => {
          if (referenceNo.trim().length < 3) {
            toast.error("شماره پیگیری فیش الزامی است");
            return;
          }
          if (sourceCard.length !== 16) {
            toast.error("شماره کارت مبدأ باید ۱۶ رقم باشد");
            return;
          }
          start(async () => {
            const res = await createPayment({
              contractId,
              installmentIds: selected.map((s) => s.id),
              method: "CARD_TO_CARD",
              amount: total,
              paidAt,
              sourceCardNumber: sourceCard,
              referenceNo: referenceNo.trim(),
              note: note || null,
              receiptDocumentId: receiptDocId,
              idempotencyKey: idem,
              settle,
              waivePenalties: false,
              resubmissionOf,
            });
            if (!res.ok) {
              toast.error(res.error, { duration: 7000 });
              return;
            }
            toast.success("فیش شما ثبت شد و پس از تأیید فروشگاه اعمال می‌شود");
            setIdem(newKey());
            setResubmissionOf(null);
            router.refresh();
          });
        }}
      >
        <Landmark className="size-4" />
        {pending ? "در حال ارسال…" : "ارسال فیش برای بررسی"}
      </button>
    </div>
  );
}

/* --------------------------------- review workflow -------------------------------- */

export function ReviewButtons({ paymentId }: { paymentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState<"approve" | "reject" | null>(null);
  const [note, setNote] = useState("");
  const [pending, start] = useTransition();

  const act = (approve: boolean) =>
    start(async () => {
      const res = await reviewPayment({ paymentId, approve, reviewNote: note || null });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(approve ? "پرداخت تأیید و اقساط تسویه شد" : "پرداخت رد شد");
      setOpen(null);
      setNote("");
      router.refresh();
    });

  return (
    <>
      <div className="flex gap-1.5">
        <button type="button" className="btn btn-sm btn-primary" onClick={() => setOpen("approve")}>
          <BadgeCheck className="size-3.5" />
          تأیید
        </button>
        <button type="button" className="btn btn-sm btn-danger" onClick={() => setOpen("reject")}>
          <Ban className="size-3.5" />
          رد
        </button>
      </div>
      <Modal open={open !== null} onClose={() => setOpen(null)} title={open === "approve" ? "تأیید پرداخت" : "رد پرداخت"}>
        <div className="space-y-4">
          <p className="text-sm text-muted">
            {open === "approve"
              ? "با تأیید، اقساط مرتبط به‌صورت پرداخت‌شده علامت می‌خورند. این عمل قابل واگردانی نیست."
              : "علت رد پرداخت را بنویسید؛ این متن برای مشتری پیامک/نمایش داده می‌شود."}
          </p>
          <textarea
            className="input min-h-20"
            placeholder={open === "approve" ? "یادداشت (اختیاری)" : "دلیل رد *"}
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <button type="button" className={`btn w-full ${open === "approve" ? "btn-primary" : "btn-danger"}`} disabled={pending} onClick={() => act(open === "approve")}>
            {pending ? "در حال انجام…" : open === "approve" ? "تأیید نهایی" : "ثبت رد پرداخت"}
          </button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------------ penalty / contract ops ----------------------------- */

export function ForgivePenaltyButton({ installmentId }: { installmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn btn-sm btn-outline text-[var(--warning)]" onClick={() => setOpen(true)}>
        بخشودگی جریمه
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="بخشودگی جریمه تأخیر">
        <div className="space-y-4">
          <textarea className="input min-h-20" placeholder="دلیل بخشودگی *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await forgivePenalty({ installmentId, reason });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("جریمه بخشوده شد");
                setOpen(false);
                setReason("");
                router.refresh();
              })
            }
          >
            {pending ? "در حال ثبت…" : "تأیید بخشودگی"}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function CancelContractButton({ contractId }: { contractId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn btn-danger btn-sm" onClick={() => setOpen(true)}>
        لغو قرارداد
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="لغو قرارداد">
        <div className="space-y-4">
          <p className="text-sm text-muted">لغو فقط تا پیش از ثبت پرداخت تأییدشده ممکن است.</p>
          <textarea className="input min-h-20" placeholder="دلیل لغو *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="btn btn-danger w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await cancelContract({ contractId, reason });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("قرارداد لغو شد");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending ? "در حال انجام…" : "تأیید لغو قرارداد"}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function SendReminderButton({ installmentId }: { installmentId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-sm btn-ghost"
      title="ارسال یادآوری پیامکی"
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await sendReminder(installmentId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("یادآوری ارسال و ثبت شد");
          router.refresh();
        })
      }
    >
      <BellRing className="size-3.5" />
    </button>
  );
}

/** Opens the server-generated PDF receipt in a new tab. */
export function PrintReceiptLink({ paymentId }: { paymentId: string }) {
  return (
    <a
      href={`/api/receipts/${paymentId}`}
      target="_blank"
      rel="noreferrer"
      className="btn btn-sm btn-outline"
      title="دریافت رسید PDF"
    >
      <ReceiptText className="size-3.5" />
      رسید
    </a>
  );
}
