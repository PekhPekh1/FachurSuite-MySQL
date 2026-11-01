import { requireUser } from "@/lib/auth";
import { Card, PageHeader } from "@/components/ui";
import { CustomerForm } from "@/components/forms/customer-forms";

export const dynamic = "force-dynamic";

export default async function NewCustomerPage() {
  await requireUser(["ADMIN", "OPERATOR"]);
  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="ثبت مشتری جدید" subtitle="اطلاعات هویتی و تماس مشتری را با دقت وارد کنید" />
      <Card>
        <CustomerForm />
      </Card>
    </div>
  );
}
