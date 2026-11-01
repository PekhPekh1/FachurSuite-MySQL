"use client";

import { useState, useTransition } from "react";
import { Scale } from "lucide-react";
import { toast } from "sonner";
import { getSettlementQuote, type SettlementQuote } from "@/server/actions/installments";
import { formatJalali } from "@/lib/jalali";
import { toFaDigits } from "@/lib/format";

const grp = (n: number) => toFaDigits(n.toLocaleString("en-US"));

export function SettlementPanel({ contractId, canWaive }: { contractId: string; canWaive: boolean }) {
  const [quote, setQuote] = useState<SettlementQuote | null>(null);
  const [waive, setWaive] = useState(false);
  const [pending, start] = useTransition();

  const load = (waivePenalties: boolean) =>
    start(async () => {
      const res = await getSettlementQuote({ contractId, waivePenalties });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setQuote(res.data ?? null);
    });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => load(waive)}>
          <Scale className="size-3.5" />
          {pending ? "در حال محاسبه…" : "محاسبه تسویه زودهنگام"}
        </button>
        {canWaive ? (
          <label className="flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={waive}
              onChange={(e) => {
                setWaive(e.target.checked);
                if (quote) load(e.target.checked);
              }}
            />
            بخشودگی جریمه‌ها (با مجوز)
          </label>
        ) : null}
      </div>

      {quote ? (
        <div className="rounded-xl border border-base p-3 text-sm">
          <div className="max-h-56 space-y-1 overflow-y-auto">
            {quote.lines.map((l) => (
              <div key={l.seq} className="flex items-center justify-between gap-2 rounded-lg bg-[var(--surface-2)] px-3 py-1.5 text-xs">
                <span className="text-muted">قسط {toFaDigits(l.seq)}</span>
                <span>{toFaDigits(formatJalali(l.dueDate))}</span>
                <span>{grp(l.amount)}</span>
                <span className={l.penalty > 0 ? "text-[var(--danger)]" : "text-muted"}>
                  {l.penalty > 0 ? `+${grp(l.penalty)}` : l.forgiven ? "بخشوده" : "—"}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 space-y-1 border-t border-base pt-2 text-sm">
            <div className="flex justify-between"><span className="text-muted">اصل اقساط باقی‌مانده</span><span>{grp(quote.principalTotal)} تومان</span></div>
            <div className="flex justify-between"><span className="text-muted">جریمه قابل دریافت</span><span>{grp(quote.penaltyTotal)} تومان</span></div>
            {quote.forgivenPenaltyTotal > 0 ? (
              <div className="flex justify-between text-[var(--warning)]"><span>جریمه بخشوده‌شده</span><span>{grp(quote.forgivenPenaltyTotal)} تومان</span></div>
            ) : null}
            <div className="flex justify-between border-t border-base pt-1 font-bold"><span>مبلغ نهایی تسویه</span><span className="text-brand">{grp(quote.grandTotal)} تومان</span></div>
          </div>
          <p className="mt-2 text-[11px] leading-5 text-muted">
            اقساط آینده بدون تخفیف و بدون هرگونه سود خودکار محاسبه می‌شوند. برای ثبت نهایی، از فرم «ثبت پرداخت» گزینه «تسویه کامل قرارداد» را انتخاب کنید.
          </p>
        </div>
      ) : null}
    </div>
  );
}
