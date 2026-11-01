import Link from "next/link";
import { notFound } from "next/navigation";
import { and, desc, eq, inArray } from "drizzle-orm";
import { FileDown, MapPin, Phone, Smartphone, FileText } from "lucide-react";
import { db } from "@/db";
import { contracts, customerCreditHistory, customers, documents, guarantors, installments, payments } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate, fmtNum, fmtToman, toFaDigits } from "@/lib/format";
import { Badge, Card, EmptyState, MethodBadge, PageHeader, StatusBadge, TableShell } from "@/components/ui";
import { AddGuarantorButton, CustomerStateButtons, EditCustomerButton } from "@/components/forms/detail-actions";
import { DeleteGuarantorButton, DocumentUpload } from "@/components/forms/customer-forms";
import { PrintReceiptLink } from "@/components/forms/payment-forms";

export const dynamic = "force-dynamic";

export default async function CustomerDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const u = await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const { id } = await params;

  const [customer] = await db.select().from(customers).where(eq(customers.id, id)).limit(1);
  if (!customer) notFound();

  const [guars, contractRows, paymentRows] = await Promise.all([
    db.select().from(guarantors).where(and(eq(guarantors.customerId, id), eq(guarantors.isActive, true))),
    db
      .select({
        id: contracts.id,
        contractNo: contracts.contractNo,
        type: contracts.type,
        status: contracts.status,
        totalPrice: contracts.totalPrice,
        downPayment: contracts.downPayment,
        installmentCount: contracts.installmentCount,
        createdAt: contracts.createdAt,
      })
      .from(contracts)
      .where(eq(contracts.customerId, id))
      .orderBy(desc(contracts.createdAt)),
    db
      .select({
        id: payments.id,
        amount: payments.amount,
        method: payments.method,
        status: payments.status,
        createdAt: payments.createdAt,
        contractNo: contracts.contractNo,
      })
      .from(payments)
      .innerJoin(contracts, eq(contracts.id, payments.contractId))
      .where(eq(payments.customerId, id))
      .orderBy(desc(payments.createdAt))
      .limit(50),
  ]);

  const ownerIds = [id, ...guars.map((g) => g.id)];
  const [docs, creditHistory] = await Promise.all([
    ownerIds.length
      ? db.select().from(documents).where(inArray(documents.ownerId, ownerIds)).orderBy(desc(documents.createdAt))
      : Promise.resolve([]),
    db.select().from(customerCreditHistory).where(eq(customerCreditHistory.customerId, id)).orderBy(desc(customerCreditHistory.createdAt)).limit(10),
  ]);

  // outstanding per contract
  const instRows = contractRows.length
    ? await db
        .select({ contractId: installments.contractId, amount: installments.amount, paidAt: installments.paidAt })
        .from(installments)
        .where(inArray(installments.contractId, contractRows.map((c) => c.id)))
    : [];

  const outstanding = new Map<string, number>();
  for (const i of instRows) {
    if (!i.paidAt) outstanding.set(i.contractId, (outstanding.get(i.contractId) ?? 0) + i.amount);
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title={customer.fullName}
        subtitle={`عضویت از ${fmtDate(formatJalali(customer.createdAt), fa)}`}
        actions={
          <div className="flex gap-2">
            <Badge tone={customer.isActive ? "success" : "danger"}>{customer.isActive ? "فعال" : "غیرفعال"}</Badge>
            {customer.isBlacklisted ? <Badge tone="danger">فهرست سیاه</Badge> : null}
            <EditCustomerButton
              customerId={customer.id}
              initial={{
                firstName: customer.firstName,
                lastName: customer.lastName,
                nationalCode: customer.nationalCode,
                mobile: customer.mobile,
                phone: customer.phone ?? "",
                address: customer.address ?? "",
                occupation: customer.occupation ?? "",
                notes: customer.notes ?? "",
                creditLimit: customer.creditLimit,
                tags: customer.tags,
              }}
            />
            {u.role === "ADMIN" ? (
              <CustomerStateButtons customerId={customer.id} isActive={customer.isActive} isBlacklisted={customer.isBlacklisted} />
            ) : null}
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="space-y-3">
          <h2 className="text-sm font-bold">اطلاعات تماس و هویتی</h2>
          <div className="space-y-2.5 text-sm">
            <p className="flex items-center gap-2"><Smartphone className="size-4 text-muted" /><span dir="ltr">{fa ? toFaDigits(customer.mobile) : customer.mobile}</span></p>
            {customer.phone ? <p className="flex items-center gap-2"><Phone className="size-4 text-muted" /><span dir="ltr">{fa ? toFaDigits(customer.phone) : customer.phone}</span></p> : null}
            <p className="flex items-center gap-2"><FileText className="size-4 text-muted" />کد ملی: <span dir="ltr">{fa ? toFaDigits(customer.nationalCode) : customer.nationalCode}</span></p>
            {customer.occupation ? <p className="text-muted">شغل: <span className="text-body">{customer.occupation}</span></p> : null}
            {customer.address ? <p className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-muted" />{customer.address}</p> : null}
          </div>
          {customer.tags.length > 0 ? (
            <div className="flex flex-wrap gap-1.5 border-t border-base pt-3">
              {customer.tags.map((t) => <Badge key={t} tone="info">{t}</Badge>)}
            </div>
          ) : null}
          <div className="border-t border-base pt-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted">امتیاز اعتباری</span>
              <span className="font-bold text-brand">{fmtNum(customer.creditScore, fa)} / {fmtNum(1000, fa)}</span>
            </div>
            <div className="mt-2 h-2 overflow-hidden rounded-full bg-[var(--surface-2)]">
              <div className="h-full rounded-full bg-brand-grad" style={{ width: `${customer.creditScore / 10}%` }} />
            </div>
            {customer.creditLimit > 0 ? <p className="mt-2 text-muted">سقف اعتبار: <span className="font-medium text-body">{fmtToman(customer.creditLimit, fa)}</span></p> : null}
          </div>
          {customer.isBlacklisted && customer.blacklistReason ? <p className="rounded-xl bg-[var(--danger-soft)] p-3 text-xs text-[var(--danger)]">دلیل فهرست سیاه: {customer.blacklistReason}</p> : null}
          {customer.notes ? <p className="rounded-xl bg-[var(--surface-2)] p-3 text-xs leading-6 text-muted">{customer.notes}</p> : null}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold">ضامنین</h2>
            <AddGuarantorButton customerId={customer.id} />
          </div>
          {guars.length === 0 ? (
            <EmptyState title="ضامنی ثبت نشده است" hint="برای قراردادهای اقساطی می‌توانید ضامن اضافه کنید" />
          ) : (
            <ul className="space-y-3 text-sm">
              {guars.map((g) => (
                <li key={g.id} className="flex items-start justify-between gap-2 rounded-xl border border-base p-3">
                  <div>
                    <p className="font-medium">{g.fullName} {g.relation ? <span className="text-xs text-muted">({g.relation})</span> : null}</p>
                    <p className="mt-1 text-xs text-muted">
                      {g.nationalCode ? `کد ملی: ${fa ? toFaDigits(g.nationalCode) : g.nationalCode}` : ""} {g.mobile ? ` — ${fa ? toFaDigits(g.mobile) : g.mobile}` : ""}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <DocumentUpload ownerType="guarantor" ownerId={g.id} label="سند" />
                    <DeleteGuarantorButton id={g.id} customerId={customer.id} />
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold">اسناد و مدارک</h2>
            <DocumentUpload ownerType="customer" ownerId={customer.id} />
          </div>
          {docs.length === 0 ? (
            <EmptyState title="سندی بارگذاری نشده است" hint="تصویر کارت ملی، چک، سفته یا مدارک ضامن (JPG/PNG/PDF تا ۵ مگابایت)" />
          ) : (
            <ul className="space-y-2 text-sm">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-2 rounded-xl border border-base px-3 py-2">
                  <span className="truncate text-xs">{d.fileName}</span>
                  <a href={`/api/docs/${d.id}`} target="_blank" className="btn btn-ghost btn-sm shrink-0" rel="noreferrer">
                    <FileDown className="size-3.5" />
                  </a>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <Card>
        <h2 className="mb-4 text-sm font-bold">تاریخچه امتیاز اعتباری</h2>
        {creditHistory.length === 0 ? (
          <EmptyState title="تاریخچه‌ای ثبت نشده است" />
        ) : (
          <TableShell>
            <thead><tr><th>امتیاز قبلی</th><th>امتیاز جدید</th><th>علت</th><th>زمان</th></tr></thead>
            <tbody>
              {creditHistory.map((row) => (
                <tr key={row.id}>
                  <td>{fmtNum(row.oldScore, fa)}</td>
                  <td className="font-bold text-brand">{fmtNum(row.newScore, fa)}</td>
                  <td>{row.reason === "INITIAL" ? "امتیاز اولیه" : row.reason}</td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(row.createdAt, true), fa)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-bold">قراردادها</h2>
        {contractRows.length === 0 ? (
          <EmptyState title="قراردادی برای این مشتری ثبت نشده است" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>شماره قرارداد</th>
                <th>نوع</th>
                <th>مبلغ کل</th>
                <th>مانده</th>
                <th>وضعیت</th>
                <th>تاریخ</th>
              </tr>
            </thead>
            <tbody>
              {contractRows.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link href={`/contracts/${c.id}`} className="font-medium text-brand hover:underline" prefetch={false}>
                      <span dir="ltr">{c.contractNo}</span>
                    </Link>
                  </td>
                  <td>{c.type === "CASH" ? "نقدی" : `اقساطی (${fmtNum(c.installmentCount, fa)} قسط)`}</td>
                  <td>{fmtToman(c.totalPrice, fa)}</td>
                  <td>{fmtToman(outstanding.get(c.id) ?? 0, fa)}</td>
                  <td><StatusBadge status={c.status} /></td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(c.createdAt), fa)}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>

      <Card>
        <h2 className="mb-4 text-sm font-bold">سوابق پرداخت</h2>
        {paymentRows.length === 0 ? (
          <EmptyState title="پرداختی ثبت نشده است" />
        ) : (
          <TableShell>
            <thead>
              <tr>
                <th>قرارداد</th>
                <th>مبلغ</th>
                <th>روش</th>
                <th>وضعیت</th>
                <th>زمان</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {paymentRows.map((p) => (
                <tr key={p.id}>
                  <td><span dir="ltr">{p.contractNo}</span></td>
                  <td className="font-medium">{fmtToman(p.amount, fa)}</td>
                  <td><MethodBadge method={p.method} /></td>
                  <td><StatusBadge status={p.status} /></td>
                  <td className="text-xs text-muted">{fmtDate(formatJalali(p.createdAt, true), fa)}</td>
                  <td>{p.status === "CONFIRMED" ? <PrintReceiptLink paymentId={p.id} /> : null}</td>
                </tr>
              ))}
            </tbody>
          </TableShell>
        )}
      </Card>
    </div>
  );
}
