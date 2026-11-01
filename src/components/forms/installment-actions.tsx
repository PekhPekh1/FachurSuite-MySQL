"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarCog, HandHeart } from "lucide-react";
import { Modal } from "@/components/modal";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { changeInstallmentDueDate, forgiveInstallment } from "@/server/actions/installments";

export function ChangeDueDateButton({ installmentId, currentDueDate }: { installmentId: string; currentDueDate: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [dueDate, setDueDate] = useState<string | null>(currentDueDate);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" title="تغییر تاریخ سررسید" onClick={() => setOpen(true)}>
        <CalendarCog className="size-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="تغییر تاریخ سررسید قسط">
        <div className="space-y-4">
          <p className="text-xs leading-6 text-muted">
            تاریخ اصلی قسط برای ممیزی نگهداری می‌شود و تغییر سررسید در گزارش رویدادها ثبت می‌گردد.
          </p>
          <div>
            <label className="label">سررسید جدید *</label>
            <JalaliDatePicker value={dueDate} onChange={setDueDate} />
          </div>
          <textarea className="input min-h-20" placeholder="دلیل تغییر سررسید *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await changeInstallmentDueDate({ installmentId, dueDate, reason });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("سررسید قسط تغییر کرد");
                setOpen(false);
                setReason("");
                router.refresh();
              })
            }
          >
            {pending ? "در حال ثبت…" : "ثبت تغییر سررسید"}
          </button>
        </div>
      </Modal>
    </>
  );
}

export function ForgiveInstallmentButton({ installmentId }: { installmentId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  return (
    <>
      <button type="button" className="btn btn-sm btn-outline text-[var(--danger)]" onClick={() => setOpen(true)}>
        <HandHeart className="size-3.5" />
        بخشودگی قسط
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="بخشودگی کامل قسط">
        <div className="space-y-4">
          <p className="rounded-xl bg-[var(--warning-soft)] px-3 py-2 text-xs leading-6 text-[var(--warning)]">
            با این کار کل تعهد این قسط (اصل مبلغ و جریمه) بخشوده می‌شود و وضعیت آن به «بخشوده‌شده» تغییر می‌کند.
            این عمل قابل بازگشت نیست و در گزارش رویدادها ثبت می‌شود.
          </p>
          <textarea className="input min-h-20" placeholder="دلیل بخشودگی *" value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            type="button"
            className="btn btn-danger w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await forgiveInstallment({ installmentId, reason });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("قسط بخشوده شد");
                setOpen(false);
                setReason("");
                router.refresh();
              })
            }
          >
            {pending ? "در حال ثبت…" : "تأیید بخشودگی قسط"}
          </button>
        </div>
      </Modal>
    </>
  );
}
