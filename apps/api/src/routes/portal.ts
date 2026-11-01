import { Router } from "express";
import { prisma } from "../db";
import { asyncRoute, HttpError } from "../security/errors";
import { authenticate, authorize, type AuthRequest } from "../security/middleware";
import { computePenalty, defaultFinance, deriveInstallmentStatus, toIsoDate, todayTehran, type FinanceSettings } from "../installment/penalty";

export const portalRouter = Router();
portalRouter.use(authenticate, authorize("CUSTOMER"));

async function finance(): Promise<FinanceSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "finance" } });
  return { ...defaultFinance, ...((row?.value as Partial<FinanceSettings>) ?? {}) };
}

/**
 * The customer's own dashboard.
 * Ownership comes exclusively from the authenticated session (`req.auth.customerId`);
 * no customer identifier is accepted from the request, so cross-customer access is
 * impossible by construction.
 */
portalRouter.get(
  "/portal",
  asyncRoute(async (req: AuthRequest, res) => {
    const customerId = req.auth!.customerId;
    if (!customerId) throw new HttpError(404, "پرونده مشتری یافت نشد", "NO_CUSTOMER_PROFILE");

    const [customer, contracts, settings] = await Promise.all([
      prisma.customer.findUnique({
        where: { id: customerId },
        select: { id: true, fullName: true, nationalCode: true, mobile: true, creditScore: true },
      }),
      prisma.contract.findMany({
        where: { customerId },
        orderBy: { createdAt: "desc" },
        select: {
          id: true, contractNo: true, type: true, status: true, itemDescription: true,
          totalPrice: true, installmentCount: true, createdAt: true,
          installments: { orderBy: { seq: "asc" } },
        },
      }),
      finance(),
    ]);
    if (!customer) throw new HttpError(404, "پرونده مشتری یافت نشد", "NO_CUSTOMER_PROFILE");

    const today = todayTehran();
    const schedule = contracts.flatMap((c) =>
      c.installments.map((i) => {
        const dueDate = toIsoDate(i.dueDate);
        const display = deriveInstallmentStatus(i.status, dueDate, today);
        const penalty =
          display === "PENDING" || display === "OVERDUE"
            ? computePenalty(Number(i.amount), dueDate, today, settings, i.penaltyForgiven ?? false).penalty
            : 0;
        return {
          id: i.id,
          contractId: c.id,
          contractNo: c.contractNo,
          seq: i.seq,
          dueDate,
          amount: i.amount.toString(),
          status: display,
          penalty,
          penaltyForgiven: i.penaltyForgiven,
        };
      }),
    );

    const payments = await prisma.payment.findMany({
      where: { customerId },
      orderBy: { createdAt: "desc" },
      take: 50,
      select: {
        id: true, contractId: true, amount: true, penaltyAmount: true, method: true, status: true,
        referenceNo: true, sourceCardNumber: true, paidAt: true, isSettlement: true,
        reviewNote: true, isResubmittable: true, createdAt: true,
        contract: { select: { contractNo: true } },
      },
    });

    const overdue = schedule.filter((s) => s.status === "OVERDUE");
    const upcoming = schedule.filter((s) => s.status === "PENDING" && s.dueDate >= today);

    res.json({
      ok: true,
      customer,
      summary: {
        contracts: contracts.length,
        activeContracts: contracts.filter((c) => c.status === "ACTIVE").length,
        upcomingCount: upcoming.length,
        overdueCount: overdue.length,
        overduePenalty: overdue.reduce((a, s) => a + s.penalty, 0),
        outstanding: schedule
          .filter((s) => s.status === "PENDING" || s.status === "OVERDUE")
          .reduce((a, s) => a + Number(s.amount), 0)
          .toString(),
        confirmedPaid: payments
          .filter((p) => p.status === "CONFIRMED")
          .reduce((a, p) => a + Number(p.amount), 0)
          .toString(),
      },
      contracts: contracts.map((c) => ({
        ...c,
        totalPrice: c.totalPrice.toString(),
        installments: undefined,
      })),
      schedule,
      payments: payments.map((p) => ({
        ...p,
        amount: p.amount.toString(),
        penaltyAmount: p.penaltyAmount.toString(),
        sourceCardNumber: p.sourceCardNumber
          ? `${p.sourceCardNumber.slice(0, 4)}-****-****-${p.sourceCardNumber.slice(12)}`
          : null,
      })),
    });
  }),
);

/** Bank cards the customer may transfer to. Card numbers are shown in full on purpose. */
portalRouter.get(
  "/portal/bank-cards",
  asyncRoute(async (_req, res) => {
    const settings = await prisma.setting.findUnique({ where: { key: "bank_accounts" } });
    const accounts = ((settings?.value as { accounts?: { bankName: string; cardNumber: string; cardHolder: string; iban?: string | null; isActive?: boolean }[] })?.accounts ?? [])
      .filter((a) => a.isActive !== false)
      .map((a) => ({ bankName: a.bankName, cardNumber: a.cardNumber, cardHolder: a.cardHolder, iban: a.iban ?? null }));
    res.json({ ok: true, accounts });
  }),
);
