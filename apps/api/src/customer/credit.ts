import { prisma } from "../db";
import { HttpError } from "../security/errors";

/**
 * Credit score v1 (deterministic, range 0..1000):
 *   base                                  500
 *   each installment paid on/before due   +15 (positive contribution capped +300)
 *   each installment paid after due        -20
 *   each currently overdue installment     -40
 *   each rejected payment                  -25
 *   each settled contract                  +20 (capped +100)
 *   blacklisted customer                      0 (hard override)
 * No request field can set this value; only this service writes it.
 */
export async function calculateCreditScore(customerId: string) {
  const customer = await prisma.customer.findUnique({ where: { id: customerId }, select: { id: true, isBlacklisted: true, creditScore: true } });
  if (!customer) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");

  const [installments, rejectedPayments, settledContracts] = await Promise.all([
    prisma.installment.findMany({
      where: { contract: { customerId } },
      select: { dueDate: true, paidAt: true, status: true },
    }),
    prisma.payment.count({ where: { customerId, status: "REJECTED" } }),
    prisma.contract.count({ where: { customerId, status: "SETTLED" } }),
  ]);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  let onTimePaid = 0;
  let latePaid = 0;
  let overdue = 0;
  for (const installment of installments) {
    if (installment.status === "PAID" && installment.paidAt) {
      const paidDate = new Date(installment.paidAt);
      paidDate.setHours(0, 0, 0, 0);
      if (paidDate <= installment.dueDate) onTimePaid += 1;
      else latePaid += 1;
    } else if (installment.dueDate < today) {
      overdue += 1;
    }
  }

  const positivePaid = Math.min(300, onTimePaid * 15);
  const settledBonus = Math.min(100, settledContracts * 20);
  const rawScore = 500 + positivePaid + settledBonus - latePaid * 20 - overdue * 40 - rejectedPayments * 25;
  const score = customer.isBlacklisted ? 0 : Math.max(0, Math.min(1000, rawScore));
  return {
    score,
    oldScore: customer.creditScore,
    ruleVersion: 1,
    breakdown: { base: 500, onTimePaid, latePaid, overdue, rejectedPayments, settledContracts, positivePaid, settledBonus, blacklisted: customer.isBlacklisted },
  };
}

export async function recalculateCreditScore(customerId: string, computedBy: string, reason = "AUTOMATED_PAYMENT_HISTORY") {
  const result = await calculateCreditScore(customerId);
  if (result.score === result.oldScore) return result;
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customerId },
      data: { creditScore: result.score, creditScoreUpdatedAt: new Date(), updatedAt: new Date() },
    }),
    prisma.customerCreditHistory.create({
      data: {
        customerId,
        oldScore: result.oldScore,
        newScore: result.score,
        reason,
        details: result.breakdown,
        computedBy,
      },
    }),
  ]);
  return result;
}
