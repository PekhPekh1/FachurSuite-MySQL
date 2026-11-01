import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { getAccessUser } from "@/lib/auth";
import { apiError, noStoreJson } from "@/lib/http-security";

/** Protected example resource: CUSTOMER may read only their own record. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getAccessUser();
  if (!user) return apiError("توکن دسترسی نامعتبر یا منقضی است", 401);
  const { id } = await params;
  if (user.role === "CUSTOMER" && user.customerId !== id) {
    // 404 prevents resource-existence disclosure.
    return apiError("مشتری یافت نشد", 404);
  }
  const [customer] = await db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      nationalCode: customers.nationalCode,
      mobile: customers.mobile,
      phone: customers.phone,
      address: customers.address,
    })
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  if (!customer) return apiError("مشتری یافت نشد", 404);
  return noStoreJson({ ok: true, customer });
}
