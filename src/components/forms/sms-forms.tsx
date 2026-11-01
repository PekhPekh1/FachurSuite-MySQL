"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Play, Send } from "lucide-react";
import {
  runReminderCycle,
  testSmsProvider,
  updateSmsProvider,
  updateSmsSchedule,
  updateSmsTemplate,
} from "@/server/actions/sms";
import type { SmsProviderConfig } from "@/lib/sms/provider";
import type { SmsScheduleSettings } from "@/lib/sms";
import { toEnDigits } from "@/lib/format";

const num = (s: string) => Number(toEnDigits(s).replace(/[^0-9]/g, "")) || 0;

export function SmsProviderForm({ initial }: { initial: SmsProviderConfig }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [testPhone, setTestPhone] = useState("");
  const [testing, setTesting] = useState(false);

  const set = <K extends keyof SmsProviderConfig>(k: K, val: SmsProviderConfig[K]) => setV((p) => ({ ...p, [k]: val }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">نام سرویس‌دهنده *</label>
          <input className="input" value={v.name} onChange={(e) => set("name", e.target.value)} placeholder="مثلاً کاوه‌نگار" />
        </div>
        <div>
          <label className="label">شماره ارسال‌کننده</label>
          <input className="input" dir="ltr" value={v.senderNumber} onChange={(e) => set("senderNumber", e.target.value)} placeholder="50004000" />
        </div>
        <div className="sm:col-span-2">
          <label className="label">آدرس API *</label>
          <input className="input" dir="ltr" value={v.apiUrl} onChange={(e) => set("apiUrl", e.target.value)} placeholder="https://api.example.com/sms/send" />
          <p className="mt-1 text-[11px] leading-5 text-muted">
            فقط آدرس‌های اینترنتی معتبر پذیرفته می‌شوند. آدرس‌های شبکه داخلی و localhost رد می‌شوند و پیروی از تغییر مسیر (redirect) غیرفعال است.
          </p>
        </div>
        <div className="sm:col-span-2">
          <label className="label">کلید یا توکن API</label>
          <input className="input" dir="ltr" type="password" value={v.apiKey} onChange={(e) => set("apiKey", e.target.value)} placeholder="••••••••" />
          <p className="mt-1 text-[11px] text-muted">
            این کلید در گزارش‌ها و پایگاه داده ثبت نمی‌شود. در محیط عملیاتی می‌توانید آن را فقط در متغیر محیطی <code dir="ltr">SMS_API_KEY</code> نگه دارید.
          </p>
        </div>
        <div>
          <label className="label">متد HTTP</label>
          <select className="input" value={v.method} onChange={(e) => set("method", e.target.value as "GET" | "POST")}>
            <option value="POST">POST</option>
            <option value="GET">GET</option>
          </select>
        </div>
        <div>
          <label className="label">نوع احراز هویت</label>
          <select className="input" value={v.authStyle} onChange={(e) => set("authStyle", e.target.value as SmsProviderConfig["authStyle"])}>
            <option value="BEARER">Bearer (هدِر Authorization)</option>
            <option value="HEADER">هدِر سفارشی</option>
            <option value="QUERY">پارامتر کوئری</option>
            <option value="BODY">درون بدنه درخواست</option>
            <option value="NONE">بدون احراز هویت</option>
          </select>
        </div>
        {v.authStyle === "HEADER" ? (
          <div>
            <label className="label">نام هدِر</label>
            <input className="input" dir="ltr" value={v.authHeaderName ?? ""} onChange={(e) => set("authHeaderName", e.target.value)} placeholder="X-API-Key" />
          </div>
        ) : null}
        <div>
          <label className="label">نحوه تشخیص موفقیت</label>
          <select className="input" value={v.successPath} onChange={(e) => set("successPath", e.target.value as SmsProviderConfig["successPath"])}>
            <option value="STATUS_2XX">کد وضعیت 2xx</option>
            <option value="BODY_CONTAINS">وجود متن در بدنه پاسخ</option>
            <option value="JSON_PATH">مقدار در مسیر JSON</option>
          </select>
        </div>
        {v.successPath === "BODY_CONTAINS" ? (
          <div className="sm:col-span-2">
            <label className="label">متن نشانگر موفقیت *</label>
            <input className="input" dir="ltr" value={v.successIndicator} onChange={(e) => set("successIndicator", e.target.value)} placeholder="success" />
          </div>
        ) : null}
        {v.successPath === "JSON_PATH" ? (
          <div className="sm:col-span-2">
            <label className="label">مسیر JSON *</label>
            <input className="input" dir="ltr" value={v.jsonPath ?? ""} onChange={(e) => set("jsonPath", e.target.value)} placeholder="status" />
            <p className="mt-1 text-[11px] text-muted">مقدار این مسیر باید شامل «متن نشانگر موفقیت» باشد.</p>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <label className="label">قالب بدنه درخواست</label>
          <textarea
            className="input min-h-20 font-mono text-xs"
            dir="ltr"
            value={v.bodyTemplate}
            onChange={(e) => set("bodyTemplate", e.target.value)}
            placeholder={'{"to":"{phone}","message":"{message}","sender":"{sender}"}'}
          />
          <p className="mt-1 text-[11px] leading-5 text-muted">
            متغیرهای مجاز: <code dir="ltr">{`{phone}`}</code> <code dir="ltr">{`{message}`}</code> <code dir="ltr">{`{sender}`}</code>. کلید API فقط در صورت نیاز و به‌صورت <code dir="ltr">{`{apiKey}`}</code> قابل استفاده است.
          </p>
        </div>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.requireTls} onChange={(e) => set("requireTls", e.target.checked)} />
          الزام HTTPS
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.isActive} onChange={(e) => set("isActive", e.target.checked)} />
          فعال (در صورت غیرفعال بودن، پیامک‌ها به‌صورت شبیه‌سازی ثبت می‌شوند)
        </label>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateSmsProvider({ ...v, jsonPath: v.jsonPath || null, authHeaderName: v.authHeaderName || null });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("تنظیمات سرویس‌دهنده ذخیره شد");
              router.refresh();
            })
          }
        >
          {pending ? "…" : "ذخیره تنظیمات"}
        </button>
        <div className="flex gap-2">
          <input className="input w-40" dir="ltr" inputMode="numeric" maxLength={11} placeholder="09xxxxxxxxx" value={testPhone} onChange={(e) => setTestPhone(toEnDigits(e.target.value).replace(/[^0-9]/g, ""))} />
          <button
            type="button"
            className="btn btn-outline"
            disabled={testing || testPhone.length !== 11}
            onClick={async () => {
              setTesting(true);
              const res = await testSmsProvider({ phone: testPhone });
              setTesting(false);
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success(`نتیجه ارسال آزمایشی: ${res.data?.status}`);
              router.refresh();
            }}
          >
            <Send className="size-4" />
            {testing ? "در حال ارسال…" : "ارسال آزمایشی"}
          </button>
        </div>
      </div>
    </div>
  );
}

export function SmsScheduleForm({ initial }: { initial: SmsScheduleSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [running, setRunning] = useState(false);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div>
          <label className="label">یادآوری قبل از سررسید (روز)</label>
          <input className="input" dir="ltr" inputMode="numeric" value={String(v.upcomingDaysBefore)} onChange={(e) => setV({ ...v, upcomingDaysBefore: num(e.target.value) })} />
        </div>
        <div>
          <label className="label">فاصله اطلاعیه‌های معوقه (روز)</label>
          <input className="input" dir="ltr" inputMode="numeric" value={String(v.overdueIntervalDays)} onChange={(e) => setV({ ...v, overdueIntervalDays: num(e.target.value) })} />
        </div>
        <div>
          <label className="label">حداکثر اطلاعیه معوقه</label>
          <input className="input" dir="ltr" inputMode="numeric" value={String(v.overdueMaxNotices)} onChange={(e) => setV({ ...v, overdueMaxNotices: num(e.target.value) })} />
        </div>
        <div>
          <label className="label">ساعت اجرا (تهران)</label>
          <input className="input" dir="ltr" inputMode="numeric" value={String(v.runHour)} onChange={(e) => setV({ ...v, runHour: num(e.target.value) })} />
        </div>
      </div>
      <div className="flex flex-wrap gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.sendOnDueDate} onChange={(e) => setV({ ...v, sendOnDueDate: e.target.checked })} />
          ارسال یادآوری در روز سررسید
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm">
          <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.isEnabled} onChange={(e) => setV({ ...v, isEnabled: e.target.checked })} />
          فعال بودن زمان‌بندی
        </label>
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn btn-primary"
          disabled={pending}
          onClick={() =>
            start(async () => {
              const res = await updateSmsSchedule(v);
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("تنظیمات زمان‌بندی ذخیره شد");
              router.refresh();
            })
          }
        >
          {pending ? "…" : "ذخیره زمان‌بندی"}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          disabled={running}
          onClick={async () => {
            setRunning(true);
            const res = await runReminderCycle();
            setRunning(false);
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            const d = res.data!;
            toast.success(
              `برنامه‌ریزی: ${d.planned.upcoming + d.planned.dueDate + d.planned.overdue} پیام — ارسال: ${d.sent}، ناموفق: ${d.failed}`,
            );
            router.refresh();
          }}
        >
          <Play className="size-4" />
          {running ? "در حال اجرا…" : "اجرای دستی چرخه یادآوری"}
        </button>
      </div>
    </div>
  );
}

export function SmsTemplateEditor({
  templates,
}: {
  templates: { key: string; title: string; body: string; category: string; isActive: boolean }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [rows, setRows] = useState(templates);

  const update = (key: string, patch: Partial<(typeof rows)[number]>) =>
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div className="space-y-4">
      <p className="rounded-xl bg-[var(--surface-2)] px-4 py-2.5 text-[11px] leading-6 text-muted">
        متغیرهای مجاز: <code dir="ltr">{`{customer}`}</code> نام مشتری، <code dir="ltr">{`{contractNo}`}</code> شماره قرارداد،{" "}
        <code dir="ltr">{`{seq}`}</code> شماره قسط، <code dir="ltr">{`{amount}`}</code> مبلغ، <code dir="ltr">{`{dueDate}`}</code> سررسید،{" "}
        <code dir="ltr">{`{daysLate}`}</code> روزهای تأخیر، <code dir="ltr">{`{reason}`}</code> دلیل رد، <code dir="ltr">{`{message}`}</code> پیام سفارشی.
      </p>
      {rows.map((t) => (
        <div key={t.key} className="space-y-2 rounded-2xl border border-base p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs text-muted" dir="ltr">{t.key}</span>
            <span className="badge badge-info">{t.category}</span>
            <label className="ms-auto flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={t.isActive} onChange={(e) => update(t.key, { isActive: e.target.checked })} />
              فعال
            </label>
          </div>
          <input className="input" value={t.title} onChange={(e) => update(t.key, { title: e.target.value })} placeholder="عنوان" />
          <textarea className="input min-h-16" value={t.body} onChange={(e) => update(t.key, { body: e.target.value })} />
          <button
            type="button"
            className="btn btn-outline btn-sm"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await updateSmsTemplate({ ...t });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success(`قالب ${t.key} ذخیره شد`);
                router.refresh();
              })
            }
          >
            ذخیره این قالب
          </button>
        </div>
      ))}
    </div>
  );
}
