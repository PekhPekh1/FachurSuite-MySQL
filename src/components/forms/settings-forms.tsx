"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2, Plus, Download, FileJson } from "lucide-react";
import { addHoliday, deleteHoliday, updateMyPreferences, updateStoreSettings } from "@/server/actions/admin";
import { PALETTES, PALETTE_FA, type Palette } from "@/lib/palettes";
import { JalaliDatePicker } from "@/components/jalali-date-picker";
import { fmtDate, fmtNum, toFaDigits } from "@/lib/format";
import { formatJalali } from "@/lib/jalali";
import type { StoreSettings, UserPreferences } from "@/lib/validators";

/* ------------------------------ Store branding ------------------------------ */

export function StoreBrandingForm({ initial }: { initial: StoreSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateStoreSettings({ ...v, logoUrl: v.logoUrl || null, description: v.description || null, printHeader: v.printHeader || null, printFooter: v.printFooter || null });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("تنظیمات فروشگاه ذخیره شد");
          router.refresh();
        });
      }}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">نام فروشگاه *</label>
          <input className="input" value={v.storeName} onChange={(e) => setV({ ...v, storeName: e.target.value })} />
        </div>
        <div>
          <label className="label">تلفن</label>
          <input className="input" dir="ltr" value={v.phone ?? ""} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">نشانی</label>
          <input className="input" value={v.address ?? ""} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">توضیحات فروشگاه</label>
          <textarea className="input min-h-16" value={v.description ?? ""} onChange={(e) => setV({ ...v, description: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">نشانی لوگو (URL)</label>
          <input className="input" dir="ltr" placeholder="/logo.png" value={v.logoUrl ?? ""} onChange={(e) => setV({ ...v, logoUrl: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">سربرگ چاپ (رسیدها و قراردادها)</label>
          <textarea className="input min-h-16" placeholder="مثلاً: فروشگاه لوازم خانگی پارس — نشانی و تلفن" value={v.printHeader ?? ""} onChange={(e) => setV({ ...v, printHeader: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">پانویس چاپ</label>
          <input className="input" value={v.printFooter ?? ""} onChange={(e) => setV({ ...v, printFooter: e.target.value })} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "…" : "ذخیره"}</button>
    </form>
  );
}

/* ------------------------------- Holidays ---------------------------------- */

export function HolidayManager({ initial, fa }: { initial: { date: string; title: string }[]; fa: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [date, setDate] = useState<string | null>(null);
  const [title, setTitle] = useState("");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-2">
        <div>
          <label className="label">تاریخ مناسبت (شمسی)</label>
          <JalaliDatePicker value={date} onChange={setDate} />
        </div>
        <div>
          <label className="label">عنوان *</label>
          <input className="input" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="مثلاً نوروز" />
        </div>
      </div>
      <button
        type="button"
        className="btn btn-outline btn-sm"
        disabled={pending || !date || title.trim().length < 2}
        onClick={() =>
          start(async () => {
            const res = await addHoliday({ date, title });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success("مناسبت ثبت شد");
            setTitle("");
            setDate(null);
            router.refresh();
          })
        }
      >
        <Plus className="size-4" />
        افزودن مناسبت
      </button>

      {initial.length === 0 ? (
        <p className="rounded-xl bg-[var(--surface-2)] px-4 py-3 text-sm text-muted">مناسبتی ثبت نشده است.</p>
      ) : (
        <ul className="space-y-2">
          {initial.map((h) => (
            <li key={h.date} className="flex items-center justify-between gap-2 rounded-xl border border-base px-3 py-2 text-sm">
              <span>{h.title}</span>
              <span className="flex items-center gap-2">
                <span className="text-xs text-muted">{fmtDate(formatJalali(h.date), fa)}</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm text-[var(--danger)]"
                  disabled={pending}
                  onClick={() =>
                    start(async () => {
                      const res = await deleteHoliday(h.date);
                      if (!res.ok) {
                        toast.error(res.error);
                        return;
                      }
                      toast.success("مناسبت حذف شد");
                      router.refresh();
                    })
                  }
                >
                  <Trash2 className="size-3.5" />
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* --------------------------- Appearance preferences -------------------------- */

export function AppearanceForm({ initial }: { initial: UserPreferences }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState<UserPreferences>(initial);

  return (
    <div className="space-y-4">
      <div>
        <label className="label">حالت نمایش</label>
        <div className="grid grid-cols-3 gap-2">
          {([["light", "روشن"], ["dark", "تیره"], ["system", "سیستم"]] as const).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className={`btn btn-sm ${v.theme === value ? "btn-primary" : "btn-outline"}`}
              onClick={() => setV({ ...v, theme: value })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div>
        <label className="label">پوسته رنگی</label>
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {PALETTES.map((p) => (
            <button
              key={p}
              type="button"
              className={`btn btn-sm ${v.palette === p ? "btn-primary" : "btn-outline"}`}
              onClick={() => setV({ ...v, palette: p as Palette })}
            >
              {PALETTE_FA[p as Palette]}
            </button>
          ))}
        </div>
      </div>
      <label className="flex cursor-pointer items-center gap-2 text-sm">
        <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.faDigits} onChange={(e) => setV({ ...v, faDigits: e.target.checked })} />
        نمایش ارقام فارسی
      </label>
      <button
        type="button"
        className="btn btn-primary"
        disabled={pending}
        onClick={() =>
          start(async () => {
            const res = await updateMyPreferences(v);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success("ترجیحات نمایش ذخیره شد");
            router.refresh();
          })
        }
      >
        {pending ? "…" : "ذخیره ترجیحات"}
      </button>
    </div>
  );
}

/* ------------------------------ Backup history ------------------------------- */

export function BackupPanel({
  history,
  fa,
}: {
  history: { id: string; fileName: string; sizeBytes: number; tableCount: number; status: string; takenByName: string | null; createdAt: Date }[];
  fa: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <a href="/api/backup" className="btn btn-primary btn-sm">
          <Download className="size-4" />
          دریافت نسخه پشتیبان
        </a>
        <span className="text-[11px] leading-5 text-muted">
          فایل پشتیبان مستقیماً به شما ارسال می‌شود و در مسیری عمومی ذخیره نمی‌گردد.
        </span>
      </div>

      <div className="rounded-xl bg-[var(--surface-2)] p-4 text-[11px] leading-6 text-muted">
        <p className="mb-1 font-medium text-body">دستورالعمل بازیابی</p>
        <ol className="list-decimal space-y-0.5 pe-4">
          <li>پرونده JSON را در محلی امن نگه دارید؛ این فایل شامل هش رمزهای عبور است.</li>
          <li>پیش از بازیابی، از پایگاه داده فعلی نسخه پشتیبان تهیه کنید.</li>
          <li>با دستور <code dir="ltr">psql</code> و کاربر دارای مجوز، جداول را از فایل بازیابی کنید.</li>
          <li>پس از بازیابی، شمار ردیف‌های جداول را با مقادیر ثبت‌شده در تاریخچه مقایسه کنید.</li>
          <li>همه نشست‌ها را با خروج از همه دستگاه‌ها باطل کنید تا توکن‌های قدیمی اعتبار نداشته باشند.</li>
        </ol>
      </div>

      {history.length === 0 ? (
        <p className="rounded-xl border border-dashed border-base px-4 py-6 text-center text-sm text-muted">
          هنوز نسخه پشتیبانی تهیه نشده است.
        </p>
      ) : (
        <ul className="space-y-2">
          {history.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-base px-3 py-2 text-sm">
              <span className="flex items-center gap-2">
                <FileJson className="size-4 text-brand" />
                <span dir="ltr" className="font-mono text-xs">{h.fileName}</span>
              </span>
              <span className="flex flex-wrap items-center gap-3 text-[11px] text-muted">
                <span>{fmtNum(Math.round(h.sizeBytes / 1024), fa)} کیلوبایت</span>
                <span>{fmtNum(h.tableCount, fa)} جدول</span>
                <span>{h.takenByName ?? "—"}</span>
                <span>{fmtDate(formatJalali(h.createdAt, true), fa)}</span>
                <span className={h.status === "COMPLETED" ? "text-[var(--success)]" : "text-[var(--danger)]"}>
                  {h.status === "COMPLETED" ? "کامل" : h.status === "FAILED" ? "ناموفق" : h.status}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11px] text-muted">جمع نسخه‌های ثبت‌شده: {toFaDigits(String(history.length))}</p>
    </div>
  );
}
