import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, guarantors } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { getFinanceSettings } from "@/lib/settings-server";
import { Card, PageHeader, EmptyState } from "@/components/ui";
import { ContractForm } from "@/components/forms/contract-form";

export const dynamic = "force-dynamic";

export default async function NewContractPage() {
  await requireUser(["ADMIN", "OPERATOR"]);
  const [customerRows, guarantorRows, finance] = await Promise.all([
    db
      .select({ id: customers.id, fullName: customers.fullName, nationalCode: customers.nationalCode })
      .from(customers)
      .where(eq(customers.isActive, true))
      .orderBy(asc(customers.fullName)),
    db
      .select({ id: guarantors.id, fullName: guarantors.fullName, customerId: guarantors.customerId })
      .from(guarantors)
      .where(eq(guarantors.isActive, true)),
    getFinanceSettings(),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader title="ثبت قرارداد جدید" subtitle="ارقام مالی دقیقاً همان‌طور که با مشتری توافق شده وارد شود؛ سامانه سود را خودکار محاسبه نمی‌کند" />
      {customerRows.length === 0 ? (
        <Card>
          <EmptyState
            title="ابتدا یک مشتری ثبت کنید"
            hint="قرارداد باید به یک مشتری متصل باشد"
            action={<Link href="/customers/new" className="btn btn-primary mt-2">ثبت مشتری</Link>}
          />
        </Card>
      ) : (
        <Card>
          <ContractForm
            customers={customerRows}
            guarantors={guarantorRows}
            defaultInstallmentCount={finance.defaultInstallmentCount}
          />
        </Card>
      )}
    </div>
  );
}
