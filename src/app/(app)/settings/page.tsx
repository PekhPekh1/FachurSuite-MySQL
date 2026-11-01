import { desc, eq } from "drizzle-orm";
import { DatabaseBackup, MessageSquareText } from "lucide-react";
import { db } from "@/db";
import { customers, smsLogs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { defaultFinance } from "@/lib/finance";
import { getFinanceSettings, getSetting } from "@/lib/settings-server";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate, fmtNum, toFaDigits } from "@/lib/format";
import { Badge, Card, PageHeader, TableShell, EmptyState } from "@/components/ui";
import { BankAccountsForm, FinanceSettingsForm, StoreSettingsForm } from "@/components/forms/admin-forms";
import { AppearanceForm, BackupPanel, HolidayManager, StoreBrandingForm } from "@/components/forms/settings-forms";
import { listBackupHistory, listHolidays, listUsersSafe } from "@/server/actions/admin";
import { SmsProviderForm, SmsScheduleForm, SmsTemplateEditor } from "@/components/forms/sms-forms";
import { listSmsJobs, listSmsTemplates, readScheduleSettings } from "@/server/actions/sms";
import { getSmsProvider } from "@/lib/sms";
import type { BankAccountsSettings, StoreSettings } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const user = await requireUser(["ADMIN"]);
  const [fa, finance, store, bankAccounts, provider, schedule, templates, jobs, holidays, backups, me, sms] = await Promise.all([
    faDigits(),
    getFinanceSettings(),
    getSetting<StoreSettings>("store", { storeName: "فروشگاه من", phone: null, address: null }),
    getSetting<BankAccountsSettings>("bank_accounts", { accounts: [] }),
    getSmsProvider(),
    readScheduleSettings(),
    listSmsTemplates(),
    listSmsJobs(30),
    listHolidays(),
    listBackupHistory(),
    listUsersSafe(),
    db
      .select({ log: smsLogs, customerName: customers.fullName })
      .from(smsLogs)
      .leftJoin(customers, eq(customers.id, smsLogs.customerId))
      .orderBy(desc(smsLogs.createdAt))
      .limit(30),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="تنظیمات" subtitle="پیکربندی فروشگاه، قوانین مالی و ابزارهای نگهداری" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-bold">اطلاعات و برندینگ فروشگاه</h2>
          <StoreBrandingForm initial={store} />
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold">قوانین مالی و جرایم</h2>
          <FinanceSettingsForm initial={{ ...defaultFinance, ...finance }} />
        </Card>
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-bold">تنظیمات سرویس‌دهنده پیامک</h2>
        <p className="mb-4 text-xs leading-6 text-muted">
          ارسال پیامک از طریق یک آداپتور محدود انجام می‌شود: آدرس‌های شبکه داخلی رد می‌شوند، پیروی از تغییر مسیر غیرفعال است
          و کلید API هرگز در گزارش‌ها ثبت نمی‌شود.
        </p>
        <SmsProviderForm initial={provider} />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">زمان‌بندی یادآوری‌ها</h2>
        <p className="mb-4 text-xs leading-6 text-muted">
          پیام‌های زمان‌بندی‌شده در پایگاه داده نگهداری می‌شوند؛ بنابراین با راه‌اندازی مجدد برنامه از دست نمی‌روند و
          کلید یکتا مانع ثبت تکراری است.
        </p>
        <SmsScheduleForm initial={schedule} />
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-bold">قالب‌های پیامک</h2>
        <SmsTemplateEditor templates={templates} />
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-bold">صف پیام‌های زمان‌بندی‌شده</h2>
        {jobs.length === 0 ? (
          <EmptyState title="پیام زمان‌بندی‌شده‌ای وجود ندارد" hint="با «اجرای دستی چرخه یادآوری» پیام‌ها برنامه‌ریزی می‌شوند" />
        ) : (
          <TableShell>
            <thead><tr><th>قالب</th><th>گیرنده</th><th>زمان</th><th>وضعیت</th><th>تلاش</th></tr></thead>
            <tbody>
              {jobs.map((j) => (
                <tr key={j.id}>
                  <td className="font-mono text-[11px]" dir="ltr">{j.templateKey}</td>
                  <td dir="ltr">{j.phone}</td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(j.scheduledFor, true), fa)}</td>
                  <td><Badge tone={j.status === "SENT" ? "success" : j.status === "FAILED" ? "danger" : j.status === "CANCELLED" ? "muted" : "warning"}>{smsJobStatusFa(j.status)}</Badge></td>
                  <td>{fmtNum(j.attempts, fa)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">ترجیحات نمایش من</h2>
        <p className="mb-4 text-xs text-muted">این تنظیمات فقط برای حساب کاربری شما ذخیره می‌شود.</p>
        <AppearanceForm
          initial={{
            theme: (me.find((x) => x.id === user.id)?.prefTheme ?? "system") as "light" | "dark" | "system",
            palette: (me.find((x) => x.id === user.id)?.prefPalette ?? "blue") as "blue" | "green" | "purple" | "orange" | "teal" | "rose",
            faDigits: me.find((x) => x.id === user.id)?.prefFaDigits ?? true,
          }}
        />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">مدیریت مناسبت‌ها و تعطیلات</h2>
        <p className="mb-4 text-xs text-muted">تاریخ‌ها به‌صورت میلادی ذخیره و در رابط کاربری شمسی نمایش داده می‌شوند.</p>
        <HolidayManager initial={holidays.map((h) => ({ date: h.date, title: h.title }))} fa={fa} />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">پشتیبان‌گیری و بازیابی</h2>
        <BackupPanel history={backups} fa={fa} />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">کارت‌های بانکی فروشگاه</h2>
        <p className="mb-4 text-xs leading-6 text-muted">
          این کارت‌ها به مشتریان در پرتال برای واریز کارت‌به‌کارت نمایش داده می‌شوند. شماره کارت به‌صورت کامل
          نمایش داده می‌شود تا مشتری بتواند واریز را انجام دهد؛ سایر اطلاعات بانکی محفوظ می‌ماند.
        </p>
        <BankAccountsForm initial={bankAccounts} />
      </Card>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="flex items-center gap-2 text-sm font-bold">
                <DatabaseBackup className="size-4 text-brand" />
                پشتیبان‌گیری از داده‌ها
              </h2>
              <p className="mt-2 text-sm leading-7 text-muted">
                دریافت فایل JSON حاوی تمام جداول سامانه (مشتریان، قراردادها، اقساط، پرداخت‌ها، کاربران، تنظیمات و گزارش رویدادها).
                این فایل را در محل امن نگهداری کنید. بازیابی از طریق مدیر فنی سرور انجام می‌شود.
              </p>
            </div>
            <a href="/api/backup" className="btn btn-primary shrink-0">
              دانلود نسخه پشتیبان
            </a>
          </div>
        </Card>

        <Card>
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold">
            <MessageSquareText className="size-4 text-brand" />
            آخرین پیامک‌ها
          </h2>
          {sms.length === 0 ? (
            <EmptyState title="پیامکی ثبت نشده است" />
          ) : (
            <div className="max-h-72 space-y-2 overflow-y-auto">
              {sms.map(({ log, customerName }) => (
                <div key={log.id} className="rounded-xl border border-base p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{customerName ?? "—"} <span dir="ltr" className="text-muted">{fa ? toFaDigits(log.phone) : log.phone}</span></span>
                    <Badge tone={log.status === "SENT" ? "success" : log.status === "FAILED" ? "danger" : "warning"}>
                      {log.status === "SENT" ? "ارسال شد" : log.status === "FAILED" ? "ناموفق" : "شبیه‌سازی"}
                    </Badge>
                  </div>
                  <p className="mt-1.5 leading-6 text-muted">{log.body}</p>
                  <p className="mt-1 text-[10px] text-muted">{fmtDate(formatJalali(log.createdAt, true), fa)}</p>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function smsJobStatusFa(status: string) {
  const map: Record<string, string> = {
    PENDING: "در انتظار ارسال", SENDING: "در حال ارسال", SENT: "ارسال شد",
    FAILED: "ناموفق", CANCELLED: "لغو شد",
  };
  return map[status] ?? status;
}
