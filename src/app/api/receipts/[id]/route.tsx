import { asc, eq } from "drizzle-orm";
import { renderToBuffer } from "@react-pdf/renderer";
import { db } from "@/db";
import { contracts, customers, installments, paymentInstallments, payments, users } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { getSetting } from "@/lib/settings-server";
import { formatJalali } from "@/lib/jalali";
import { PAYMENT_METHOD_FA } from "@/lib/format";
import { ReceiptDocument } from "@/lib/pdf/receipt-document";
import type { StoreSettings } from "@/lib/validators";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const METHOD_FA: Record<string, string> = {
  CASH: "نقدی (حضوری)",
  CARD_READER: "کارتخوان (حضوری)",
  CARD_TO_CARD: "کارت به کارت",
};

function tehranDateTime(d: Date) {
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
  const time = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Tehran", hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
  return `${formatJalali(date)} - ${time}`;
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return Response.json({ ok: false, error: "نشست معتبر نیست" }, { status: 401 });

  const { id } = await params;
  const rows = await db
    .select({
      payment: payments,
      contract: contracts,
      customer: customers,
      verifierName: users.fullName,
    })
    .from(payments)
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .leftJoin(users, eq(users.id, payments.reviewedBy))
    .where(eq(payments.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) return Response.json({ ok: false, error: "پرداخت یافت نشد" }, { status: 404 });
  // Customers may only download their own receipts.
  if (user.role === "CUSTOMER" && row.payment.customerId !== user.customerId) {
    return Response.json({ ok: false, error: "پرداخت یافت نشد" }, { status: 404 });
  }
  // Only a confirmed payment is a valid receipt.
  if (row.payment.status !== "CONFIRMED") {
    return Response.json({ ok: false, error: "رسید فقط برای پرداخت تأییدشده صادر می‌شود" }, { status: 409 });
  }

  const links = await db
    .select({ seq: installments.seq, dueDate: installments.dueDate, amount: installments.amount })
    .from(paymentInstallments)
    .innerJoin(installments, eq(installments.id, paymentInstallments.installmentId))
    .where(eq(paymentInstallments.paymentId, id))
    .orderBy(asc(installments.seq));

  const store = await getSetting<StoreSettings>("store", { storeName: "فروشگاه من", phone: null, address: null });
  const effectiveDate = row.payment.paidAt ?? row.payment.reviewedAt ?? row.payment.createdAt;

  const buffer = await renderToBuffer(
    <ReceiptDocument
      storeName={store.storeName}
      storePhone={store.phone}
      storeAddress={store.address}
      receiptNo={row.payment.id.slice(0, 8).toUpperCase()}
      contractNo={row.contract.contractNo}
      customerName={row.customer.fullName}
      customerNationalCode={row.customer.nationalCode}
      customerMobile={row.customer.mobile}
      itemDescription={row.contract.itemDescription}
      amount={row.payment.amount}
      penaltyAmount={row.payment.penaltyAmount}
      method={METHOD_FA[row.payment.method] ?? PAYMENT_METHOD_FA[row.payment.method] ?? row.payment.method}
      referenceNo={row.payment.referenceNo}
      sourceCardNumber={row.payment.sourceCardNumber}
      paidAt={tehranDateTime(effectiveDate)}
      isSettlement={row.payment.isSettlement}
      verifiedBy={row.verifierName}
      lines={links.map((l) => ({
        seq: l.seq,
        dueDate: formatJalali(l.dueDate),
        amount: l.amount,
        penalty: 0,
      }))}
    />,
  );

  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="receipt-${row.payment.id.slice(0, 8)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
