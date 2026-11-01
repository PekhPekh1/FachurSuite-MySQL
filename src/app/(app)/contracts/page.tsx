import Link from "next/link";
import { and, desc, eq, like, or } from "drizzle-orm";
import { FilePlus2, FileText, Search } from "lucide-react";
import { db } from "@/db";
import { contracts, customers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate, fmtToman, toFaDigits } from "@/lib/format";
import { Card, EmptyState, PageHeader, StatusBadge, TableShell } from "@/components/ui";

export const dynamic = "force-dynamic";

export default async function ContractsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; status?: string; type?: string }>;
}) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const { q = "", status = "", type = "" } = await searchParams;

  const conds = [];
  if (status === "ACTIVE" || status === "SETTLED" || status === "CANCELED") conds.push(eq(contracts.status, status));
  if (type === "CASH" || type === "INSTALLMENT") conds.push(eq(contracts.type, type));
  if (q.trim()) {
    conds.push(or(like(contracts.contractNo, `%${q.trim()}%`), like(customers.fullName, `%${q.trim()}%`)));
  }

  const rows = await db
    .select({
      id: contracts.id,
      contractNo: contracts.contractNo,
      type: contracts.type,
      status: contracts.status,
      totalPrice: contracts.totalPrice,
      downPayment: contracts.downPayment,
      installmentCount: contracts.installmentCount,
      createdAt: contracts.createdAt,
      customerName: customers.fullName,
      nationalCode: customers.nationalCode,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(contracts.createdAt))
    .limit(200);

  return (
    <div className="space-y-6">
      <PageHeader
        title="قراردادها"
        subtitle={`${toFaDigits(rows.length)} قرارداد`}
        actions={
          <Link href="/contracts/new" className="btn btn-primary">
            <FilePlus2 className="size-4" />
            قرارداد جدید
          </Link>
        }
      />

      <Card>
        <form className="mb-4 flex flex-wrap gap-2" action="/contracts" method="get">
          <div className="relative min-w-56 flex-1">
            <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input name="q" defaultValue={q} className="input ps-10" placeholder="شماره قرارداد یا نام مشتری…" />
          </div>
          <select name="status" defaultValue={status} className="input w-auto">
            <option value="">همه وضعیت‌ها</option>
            <option value="ACTIVE">فعال</option>
            <option value="SETTLED">تسویه شده</option>
            <option value="CANCELED">لغو شده</option>
          </select>
          <select name="type" defaultValue={type} className="input w-auto">
            <option value="">همه انواع</option>
            <option value="INSTALLMENT">اقساطی</option>
            <option value="CASH">نقدی</option>
          </select>
          <button type="submit" className="btn btn-outline">اعمال فیلتر</button>
        </form>

        {rows.length === 0 ? (
          <EmptyState icon={<FileText className="size-10" />} title="قراردادی یافت نشد" hint="فیلترها را تغییر دهید یا قرارداد جدیدی ثبت کنید" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>شماره قرارداد</th>
                <th>مشتری</th>
                <th>نوع</th>
                <th>مبلغ کل</th>
                <th>وضعیت</th>
                <th>تاریخ ثبت</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="transition hover:bg-[var(--surface-2)]/60">
                  <td>
                    <Link href={`/contracts/${c.id}`} className="font-medium text-brand hover:underline" prefetch={false}>
                      <span dir="ltr">{c.contractNo}</span>
                    </Link>
                  </td>
                  <td>
                    {c.customerName}
                    <span className="ms-2 text-[11px] text-muted" dir="ltr">{fa ? toFaDigits(c.nationalCode) : c.nationalCode}</span>
                  </td>
                  <td>{c.type === "CASH" ? "نقدی" : "اقساطی"}</td>
                  <td>{fmtToman(c.totalPrice, fa)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(c.createdAt), fa)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
