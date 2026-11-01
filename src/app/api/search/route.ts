import { and, desc, eq, like, or } from "drizzle-orm";
import { db } from "@/db";
import { contracts, customers, payments } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "نشست معتبر نیست" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim().slice(0, 80) ?? "";
  if (q.length < 2) return Response.json({ ok: true, results: [] });

  if (user.role === "CUSTOMER") {
    if (!user.customerId) return Response.json({ ok: true, results: [] });
    const ownContracts = await db
      .select({ id: contracts.id, title: contracts.contractNo, subtitle: contracts.itemDescription, status: contracts.status })
      .from(contracts)
      .where(and(eq(contracts.customerId, user.customerId), or(like(contracts.contractNo, `%${q}%`), like(contracts.itemDescription, `%${q}%`))))
      .orderBy(desc(contracts.createdAt))
      .limit(8);
    return Response.json({
      ok: true,
      results: ownContracts.map((r) => ({ type: "contract", href: `/contracts/${r.id}`, ...r })),
    });
  }

  const [customerRows, contractRows, paymentRows] = await Promise.all([
    db
      .select({ id: customers.id, title: customers.fullName, subtitle: customers.nationalCode, status: customers.isActive })
      .from(customers)
      .where(or(like(customers.fullName, `%${q}%`), like(customers.nationalCode, `%${q}%`), like(customers.mobile, `%${q}%`)))
      .orderBy(desc(customers.createdAt))
      .limit(6),
    db
      .select({ id: contracts.id, title: contracts.contractNo, subtitle: contracts.itemDescription, status: contracts.status })
      .from(contracts)
      .where(or(like(contracts.contractNo, `%${q}%`), like(contracts.itemDescription, `%${q}%`), like(contracts.itemSerialNumber, `%${q}%`)))
      .orderBy(desc(contracts.createdAt))
      .limit(6),
    db
      .select({ id: payments.id, title: payments.referenceNo, amount: payments.amount, status: payments.status, contractId: payments.contractId })
      .from(payments)
      .where(like(payments.referenceNo, `%${q}%`))
      .orderBy(desc(payments.createdAt))
      .limit(4),
  ]);

  const results = [
    ...customerRows.map((r) => ({ type: "customer", href: `/customers/${r.id}`, id: r.id, title: r.title, subtitle: `کد ملی ${r.subtitle}`, status: r.status ? "فعال" : "غیرفعال" })),
    ...contractRows.map((r) => ({ type: "contract", href: `/contracts/${r.id}`, ...r })),
    ...paymentRows.filter((r) => r.title).map((r) => ({ type: "payment", href: `/payments?payment=${r.id}`, id: r.id, title: `پیگیری ${r.title}`, subtitle: `${r.amount.toLocaleString("en-US")} تومان`, status: r.status })),
  ];

  return Response.json({ ok: true, results });
}
