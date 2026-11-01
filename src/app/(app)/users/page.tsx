import Link from "next/link";
import { asc, eq, ne } from "drizzle-orm";
import { ShieldCheck } from "lucide-react";
import { db } from "@/db";
import { customers, users } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, RoleBadge, TableShell } from "@/components/ui";
import { EditUserButton, ResetPasswordButton, UserActiveToggle, UserCreateForm } from "@/components/forms/admin-forms";

export const dynamic = "force-dynamic";

export default async function UsersPage() {
  const me = await requireUser(["ADMIN"]);
  const fa = await faDigits();

  const [userRows, customerRows] = await Promise.all([
    db
      .select({
        id: users.id,
        username: users.username,
        fullName: users.fullName,
        role: users.role,
        isActive: users.isActive,
        canReviewPayments: users.canReviewPayments,
        createdAt: users.createdAt,
        customerName: customers.fullName,
        customerId: users.customerId,
      })
      .from(users)
      .leftJoin(customers, eq(customers.id, users.customerId))
      .orderBy(asc(users.createdAt)),
    db.select({ id: customers.id, fullName: customers.fullName }).from(customers).where(ne(customers.id, "00000000-0000-0000-0000-000000000000")).orderBy(asc(customers.fullName)),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="مدیریت کاربران"
        subtitle="سطوح دسترسی: مدیر سیستم، اپراتور و حساب مشتری برای پرتال"
        actions={<UserCreateForm customers={customerRows} />}
      />

      <Card>
        {userRows.length === 0 ? (
          <EmptyState icon={<ShieldCheck className="size-10" />} title="کاربری یافت نشد" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>نام</th>
                <th>نام کاربری</th>
                <th>نقش</th>
                <th>پرونده مشتری</th>
                <th>بررسی پرداخت</th>
                <th>وضعیت</th>
                <th>عضویت</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {userRows.map((r) => (
                <tr key={r.id}>
                  <td className="font-medium">{r.fullName}</td>
                  <td dir="ltr" className="text-left">{r.username}</td>
                  <td><RoleBadge role={r.role} /></td>
                  <td className="text-xs text-muted">{r.customerName ?? "—"}</td>
                  <td>{r.role === "OPERATOR" ? (r.canReviewPayments ? <Badge tone="success">مجاز</Badge> : <Badge tone="muted">غیرمجاز</Badge>) : "—"}</td>
                  <td>{r.isActive ? <Badge tone="success">فعال</Badge> : <Badge tone="danger">غیرفعال</Badge>}</td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(r.createdAt), fa)}</td>
                  <td>
                    <div className="flex gap-1">
                      {r.id !== me.id ? <EditUserButton user={{ id: r.id, fullName: r.fullName, role: r.role, customerId: r.customerId, canReviewPayments: r.canReviewPayments }} customers={customerRows} /> : null}
                      <ResetPasswordButton userId={r.id} />
                      {r.id !== me.id ? <UserActiveToggle userId={r.id} isActive={r.isActive} /> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
      <p className="text-xs text-muted">
        حساب‌های مشتری فقط به قراردادها و پرداخت‌های خودشان دسترسی دارند. برای ایجاد حساب مشتری ابتدا پرونده مشتری را ثبت کنید.
      </p>
    </div>
  );
}
