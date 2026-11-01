import Link from "next/link";
import { and, desc, eq, like, or, sql } from "drizzle-orm";
import { UserPlus, Users, Search } from "lucide-react";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { fmtNum, fmtToman, toFaDigits } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, TableShell } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function CustomersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; active?: string; blacklisted?: string }>;
}) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const { q = "", active = "", blacklisted = "" } = await searchParams;
  const conditions = [];
  if (q.trim()) {
    conditions.push(
      or(
        like(customers.fullName, `%${q.trim()}%`),
        like(customers.nationalCode, `%${q.trim()}%`),
        like(customers.mobile, `%${q.trim()}%`),
      ),
    );
  }
  if (active === "true" || active === "false") conditions.push(eq(customers.isActive, active === "true"));
  if (blacklisted === "true" || blacklisted === "false") conditions.push(eq(customers.isBlacklisted, blacklisted === "true"));

  const rows = await db
    .select()
    .from(customers)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(customers.createdAt))
    .limit(200);
  const total = String((await db.select({ n: sql<number>`count(*)` }).from(customers))[0]?.n ?? 0);

  return (
    <div className="space-y-6">
      <PageHeader
        title="مشتریان"
        subtitle={`${fmtNum(Number(total), fa)} مشتری ثبت شده است`}
        actions={
          <Link href="/customers/new" className="btn btn-primary">
            <UserPlus className="size-4" />
            مشتری جدید
          </Link>
        }
      />

      <Card>
        <form className="mb-4 flex flex-wrap gap-2" action="/customers" method="get">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} className="input ps-10" placeholder="نام، کد ملی یا موبایل…" />
          </div>
          <select name="active" defaultValue={active} className="input w-auto">
            <option value="">همه وضعیت‌ها</option>
            <option value="true">فعال</option>
            <option value="false">غیرفعال</option>
          </select>
          <select name="blacklisted" defaultValue={blacklisted} className="input w-auto">
            <option value="">همه اعتبارها</option>
            <option value="false">عادی</option>
            <option value="true">فهرست سیاه</option>
          </select>
          <button type="submit" className="btn btn-outline">جستجو</button>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<Users className="size-10" />} title="نتیجه‌ای یافت نشد" hint="فیلترها یا عبارت جستجو را تغییر دهید" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>نام و نام خانوادگی</th>
                <th>کد ملی</th>
                <th>موبایل</th>
                <th>برچسب‌ها</th>
                <th>امتیاز</th>
                <th>سقف اعتبار</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="transition hover:bg-[var(--surface-2)]/60">
                  <td>
                    <Link href={`/customers/${c.id}`} className="font-medium text-brand hover:underline" prefetch={false}>
                      {c.fullName}
                    </Link>
                    {c.occupation ? <p className="text-[11px] text-muted">{c.occupation}</p> : null}
                  </td>
                  <td dir="ltr" className="text-left">{fa ? toFaDigits(c.nationalCode) : c.nationalCode}</td>
                  <td dir="ltr" className="text-left">{fa ? toFaDigits(c.mobile) : c.mobile}</td>
                  <td>
                    <div className="flex flex-wrap gap-1">
                      {c.tags.slice(0, 3).map((t) => <Badge key={t} tone="info">{t}</Badge>)}
                      {c.tags.length > 3 ? <Badge tone="muted">+{fmtNum(c.tags.length - 3, fa)}</Badge> : null}
                    </div>
                  </td>
                  <td className="font-medium">{fmtNum(c.creditScore, fa)}</td>
                  <td>{c.creditLimit > 0 ? fmtToman(c.creditLimit, fa) : "—"}</td>
                  <td>
                    <div className="flex gap-1">
                      <Badge tone={c.isActive ? "success" : "danger"}>{c.isActive ? "فعال" : "غیرفعال"}</Badge>
                      {c.isBlacklisted ? <Badge tone="danger">سیاه</Badge> : null}
                    </div>
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
