import { desc } from "drizzle-orm";
import { ScrollText, Search } from "lucide-react";
import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { requireUser, type Role } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate } from "@/lib/format";
import { Card, EmptyState, PageHeader, RoleBadge, TableShell } from "@/components/ui";

export const dynamic = "force-dynamic";

const ACTION_FA: Record<string, string> = {
  "auth.login": "ورود به سامانه",
  "auth.login_failed": "ورود ناموفق",
  "auth.login_blocked": "ورود حساب غیرفعال",
  "auth.login_throttled": "محدودسازی تلاش ورود",
  "auth.refresh_rotated": "چرخش توکن تازه‌سازی",
  "auth.logout": "خروج از سامانه",
  "auth.logout_all": "خروج از همه دستگاه‌ها",
  "auth.password_changed": "تغییر رمز عبور",
  "auth.password_change_failed": "تغییر رمز ناموفق",
  "customer.create": "ثبت مشتری",
  "customer.update": "ویرایش مشتری",
  "customer.delete": "حذف مشتری",
  "guarantor.create": "ثبت ضامن",
  "guarantor.delete": "حذف ضامن",
  "contract.create": "ثبت قرارداد",
  "contract.cancel": "لغو قرارداد",
  "payment.record": "ثبت پرداخت",
  "payment.submit_receipt": "ثبت فیش کارت‌به‌کارت",
  "payment.approve": "تأیید پرداخت",
  "payment.reject": "رد پرداخت",
  "penalty.forgive": "بخشودگی جریمه",
  "sms.reminder": "ارسال یادآوری پیامکی",
  "user.create": "ایجاد کاربر",
  "user.activate": "فعال‌سازی کاربر",
  "user.deactivate": "غیرفعال‌سازی کاربر",
  "user.reset_password": "بازنشانی رمز عبور",
  "settings.store.update": "ویرایش تنظیمات فروشگاه",
  "settings.finance.update": "ویرایش تنظیمات مالی",
  "document.upload": "بارگذاری سند",
  "backup.download": "دریافت نسخه پشتیبان",
};

export default async function AuditPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireUser(["ADMIN"]);
  const fa = await faDigits();
  const { q = "" } = await searchParams;

  const rows = (await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(400)).filter((r) => {
    if (!q.trim()) return true;
    const t = q.trim();
    return (
      (ACTION_FA[r.action] ?? r.action).includes(t) ||
      (r.userName ?? "").includes(t) ||
      (r.entityId ?? "").includes(t) ||
      JSON.stringify(r.meta ?? {}).includes(t)
    );
  });

  return (
    <div className="space-y-6">
      <PageHeader title="رویدادها و ممیزی" subtitle="تمام عملیات حساس سامانه با عامل و زمان ثبت می‌شود" />

      <Card>
        <form className="mb-4 flex gap-2" action="/audit" method="get">
          <div className="relative flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} className="input ps-10" placeholder="جستجو در رویدادها، کاربران یا داده‌ها…" />
          </div>
          <button type="submit" className="btn btn-outline">جستجو</button>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<ScrollText className="size-10" />} title="رویدادی یافت نشد" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>زمان</th>
                <th>کاربر</th>
                <th>نقش</th>
                <th>عملیات</th>
                <th>موجودیت</th>
                <th>جزئیات</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap text-xs text-muted">{fmtDate(formatJalali(r.createdAt, true), fa)}</td>
                  <td className="text-xs font-medium">{r.userName ?? "سیستم"}</td>
                  <td>{r.userRole ? <RoleBadge role={r.userRole as Role} /> : "—"}</td>
                  <td className="text-xs">{ACTION_FA[r.action] ?? r.action}</td>
                  <td className="text-xs text-muted" dir="ltr">{r.entity}:{r.entityId?.slice(0, 8) ?? "—"}</td>
                  <td className="max-w-72">
                    {r.meta ? (
                      <code className="block truncate rounded-lg bg-[var(--surface-2)] px-2 py-1 text-[10px] text-muted" dir="ltr" title={JSON.stringify(r.meta)}>
                        {JSON.stringify(r.meta)}
                      </code>
                    ) : (
                      "—"
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
