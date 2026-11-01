import { desc, eq } from "drizzle-orm";
import { CheckCircle2, Clock3, MessageSquareText, Send, XCircle } from "lucide-react";
import { db } from "@/db";
import { customers, smsJobs, smsLogs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSmsProvider } from "@/lib/sms";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate, fmtNum, toFaDigits } from "@/lib/format";
import { listSmsJobs, listSmsTemplates, readScheduleSettings } from "@/server/actions/sms";
import { Badge, Card, EmptyState, PageHeader, StatCard, TableShell } from "@/components/ui";
import { SmsProviderForm, SmsScheduleForm, SmsTemplateEditor } from "@/components/forms/sms-forms";

export const dynamic = "force-dynamic";

const STATUS_FA: Record<string, string> = {
  SENT: "ارسال شد",
  SIMULATED: "شبیه‌سازی",
  FAILED: "ناموفق",
  PENDING: "در انتظار",
  SENDING: "در حال ارسال",
  CANCELLED: "لغو شد",
};

export default async function SmsManagementPage() {
  await requireUser(["ADMIN"]);
  const fa = await faDigits();
  const [provider, schedule, templates, jobs, logs] = await Promise.all([
    getSmsProvider(),
    readScheduleSettings(),
    listSmsTemplates(),
    listSmsJobs(100),
    db
      .select({ log: smsLogs, customerName: customers.fullName })
      .from(smsLogs)
      .leftJoin(customers, eq(customers.id, smsLogs.customerId))
      .orderBy(desc(smsLogs.createdAt))
      .limit(100),
  ]);

  const sent = logs.filter((r) => r.log.status === "SENT").length;
  const failed = logs.filter((r) => r.log.status === "FAILED").length;
  const pending = jobs.filter((j) => j.status === "PENDING" || j.status === "SENDING").length;
  const deliveryRate = logs.length ? Math.round((sent / logs.length) * 100) : 0;

  return (
    <div className="space-y-6">
      <PageHeader title="مدیریت پیامک" subtitle="پیکربندی سرویس‌دهنده، قالب‌ها، زمان‌بندی و گزارش ارسال" />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard icon={<Send className="size-5" />} label="ارسال موفق" value={fmtNum(sent, fa)} tone="success" />
        <StatCard icon={<XCircle className="size-5" />} label="ناموفق" value={fmtNum(failed, fa)} tone={failed ? "danger" : "brand"} />
        <StatCard icon={<Clock3 className="size-5" />} label="در صف" value={fmtNum(pending, fa)} tone={pending ? "warning" : "brand"} />
        <StatCard icon={<CheckCircle2 className="size-5" />} label="نرخ تحویل" value={`${toFaDigits(deliveryRate)}٪`} />
      </div>

      <Card>
        <h2 className="mb-1 text-sm font-bold">سرویس‌دهنده پیامک</h2>
        <p className="mb-4 text-xs leading-6 text-muted">اعتبارنامه‌ها در گزارش‌ها نمایش داده نمی‌شوند؛ آدرس‌های شبکه داخلی و تغییر مسیرها مسدود هستند.</p>
        <SmsProviderForm initial={provider} />
      </Card>

      <Card>
        <h2 className="mb-1 text-sm font-bold">زمان‌بندی خودکار</h2>
        <p className="mb-4 text-xs leading-6 text-muted">صف در پایگاه داده ذخیره می‌شود و کلید یکتا از ارسال تکراری جلوگیری می‌کند.</p>
        <SmsScheduleForm initial={schedule} />
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-bold">قالب‌های پیام</h2>
        <SmsTemplateEditor templates={templates} />
      </Card>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <Card>
          <h2 className="mb-4 text-sm font-bold">صف زمان‌بندی</h2>
          {jobs.length === 0 ? (
            <EmptyState icon={<Clock3 className="size-9" />} title="صف خالی است" />
          ) : (
            <TableShell>
              <thead><tr><th>قالب</th><th>گیرنده</th><th>زمان</th><th>وضعیت</th><th>تلاش</th></tr></thead>
              <tbody>
                {jobs.slice(0, 40).map((j) => (
                  <tr key={j.id}>
                    <td className="font-mono text-[10px]" dir="ltr">{j.templateKey}</td>
                    <td dir="ltr" className="text-xs">{fa ? toFaDigits(j.phone) : j.phone}</td>
                    <td className="text-[11px] text-muted">{fmtDate(formatJalali(j.scheduledFor, true), fa)}</td>
                    <td><Badge tone={j.status === "SENT" ? "success" : j.status === "FAILED" ? "danger" : j.status === "CANCELLED" ? "muted" : "warning"}>{STATUS_FA[j.status] ?? j.status}</Badge></td>
                    <td>{fmtNum(j.attempts, fa)}</td>
                  </tr>
                ))}
              </tbody>
            </TableShell>
          )}
        </Card>

        <Card>
          <h2 className="mb-4 text-sm font-bold">آخرین تلاش‌های ارسال</h2>
          {logs.length === 0 ? (
            <EmptyState icon={<MessageSquareText className="size-9" />} title="هنوز پیامی ثبت نشده است" />
          ) : (
            <div className="max-h-[32rem] space-y-2 overflow-y-auto">
              {logs.map(({ log, customerName }) => (
                <div key={log.id} className="rounded-xl border border-base p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium">{customerName ?? "پیام سفارشی"} <span dir="ltr" className="text-muted">{fa ? toFaDigits(log.phone) : log.phone}</span></span>
                    <Badge tone={log.status === "SENT" ? "success" : log.status === "FAILED" ? "danger" : "warning"}>{STATUS_FA[log.status] ?? log.status}</Badge>
                  </div>
                  <p className="mt-1.5 leading-6 text-muted">{log.body}</p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-muted">
                    <span className="font-mono" dir="ltr">{log.templateKey ?? "—"}</span>
                    <span>{fmtDate(formatJalali(log.createdAt, true), fa)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
