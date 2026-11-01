import type { ReactNode } from "react";
import { and, eq, lt } from "drizzle-orm";
import { db } from "@/db";
import { contracts, installments, payments, smsJobs } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings-server";
import { faDigits, getPalette } from "@/lib/prefs";
import { todayGreg } from "@/lib/jalali";
import { AppShell } from "@/components/shell";
import type { ShellNotification } from "@/components/shell-widgets";
import type { StoreSettings } from "@/lib/validators";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();
  const store = await getSetting<StoreSettings>("store", {
    storeName: "فروشگاه من",
    phone: null,
    address: null,
    logoUrl: null,
    description: null,
    printHeader: null,
    printFooter: null,
  });
  const [palette, fa] = await Promise.all([getPalette(), faDigits()]);
  const notifications: ShellNotification[] = [];
  let pendingVerification = 0;

  if (user.role === "CUSTOMER" && user.customerId) {
    const [pending, rejected] = await Promise.all([
      db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.customerId, user.customerId), eq(payments.status, "PENDING_VERIFICATION"))),
      db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.customerId, user.customerId), eq(payments.status, "REJECTED"), eq(payments.isResubmittable, true))),
    ]);
    if (pending.length) notifications.push({ id: "my-pending", title: "فیش در انتظار تأیید", description: `${pending.length} فیش هنوز بررسی نشده است.`, href: "/portal", tone: "warning" });
    if (rejected.length) notifications.push({ id: "my-rejected", title: "فیش ردشده", description: `${rejected.length} فیش نیازمند اصلاح و ارسال مجدد است.`, href: "/portal", tone: "danger" });
  } else {
    const [pending, overdue, failedSms] = await Promise.all([
      db.select({ id: payments.id }).from(payments).where(eq(payments.status, "PENDING_VERIFICATION")),
      db
        .select({ id: installments.id })
        .from(installments)
        .innerJoin(contracts, eq(contracts.id, installments.contractId))
        .where(and(eq(installments.status, "PENDING"), eq(contracts.status, "ACTIVE"), lt(installments.dueDate, todayGreg()))),
      db.select({ id: smsJobs.id }).from(smsJobs).where(eq(smsJobs.status, "FAILED")),
    ]);
    pendingVerification = pending.length;
    if (pending.length) notifications.push({ id: "pending-verification", title: "پرداخت در انتظار تأیید", description: `${pending.length} فیش کارت‌به‌کارت نیازمند بررسی است.`, href: "/payments/verification", tone: "warning" });
    if (overdue.length) notifications.push({ id: "overdue-installments", title: "اقساط معوقه", description: `${overdue.length} قسط از سررسید گذشته است.`, href: "/installments?status=OVERDUE", tone: "danger" });
    if (failedSms.length && user.role === "ADMIN") notifications.push({ id: "failed-sms", title: "ارسال ناموفق پیامک", description: `${failedSms.length} پیامک پس از تلاش‌های مجدد ناموفق بوده است.`, href: "/sms", tone: "danger" });
  }

  return (
    <AppShell
      user={{ fullName: user.fullName, role: user.role }}
      storeName={store.storeName}
      storeLogo={store.logoUrl}
      palette={palette}
      faDigits={fa}
      notifications={notifications}
      pendingVerification={pendingVerification}
    >
      {children}
    </AppShell>
  );
}
