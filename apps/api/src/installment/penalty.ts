/**
 * Penalty engine for the API track — mirrors packages/shared/src/finance.ts.
 *
 * Rules (authoritative, documented):
 *   start      : day AFTER the due date (payment on the due date is never late)
 *   grace      : `graceDays` free days; charging begins on day graceDays + 1 and
 *                only days beyond grace are charged
 *   modes      : PERCENT_MONTHLY → floor(amount × bpPerMonth × days / (10000×30))
 *                FIXED_DAILY     → fixedPerDay × days
 *                PERCENT_DAILY   → floor(amount × bpPerDay / 10000) × days (legacy)
 *                NONE            → 0
 *   rounding   : floor to whole Toman (never over-charges the customer)
 *   decimals   : integer Toman arithmetic only — no floating-point accumulation
 *   idempotence: derived on read, never stored per-day, so it cannot double-charge
 */
export type PenaltyType = "NONE" | "PERCENT_MONTHLY" | "FIXED_DAILY" | "PERCENT_DAILY";

export interface FinanceSettings {
  penaltyType: PenaltyType;
  percentBpPerMonth: number;
  percentBpPerDay: number;
  fixedPerDay: number;
  graceDays: number;
}

export const defaultFinance: FinanceSettings = {
  penaltyType: "PERCENT_MONTHLY",
  percentBpPerMonth: 120,
  percentBpPerDay: 10,
  fixedPerDay: 50_000,
  graceDays: 3,
};

export const PENALTY_MONTH_DAYS = 30;

export type StoredInstallmentStatus = "PENDING" | "RESERVED" | "PAID" | "FORGIVEN";
export type DisplayInstallmentStatus = StoredInstallmentStatus | "OVERDUE";

export const todayTehran = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });

export const toIsoDate = (value: Date | string) =>
  typeof value === "string" ? value.slice(0, 10) : value.toISOString().slice(0, 10);

/** Whole civil days between two ISO dates (to − from). */
export function daysBetween(from: string, to: string): number {
  return Math.floor((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

export function deriveInstallmentStatus(
  stored: StoredInstallmentStatus,
  dueDate: string,
  today: string,
): DisplayInstallmentStatus {
  if (stored === "PAID" || stored === "FORGIVEN" || stored === "RESERVED") return stored;
  return dueDate < today ? "OVERDUE" : "PENDING";
}

export interface PenaltyResult {
  rawDaysLate: number;
  daysLate: number;
  penalty: number;
  reason: "NOT_DUE" | "WITHIN_GRACE" | "DISABLED" | "FORGIVEN" | "CHARGED";
}

export function computePenalty(
  amount: number,
  dueDate: string,
  today: string,
  s: FinanceSettings,
  forgiven = false,
): PenaltyResult {
  const rawDaysLate = Math.max(0, daysBetween(dueDate, today));
  if (rawDaysLate <= 0) return { rawDaysLate: 0, daysLate: 0, penalty: 0, reason: "NOT_DUE" };

  const daysLate = Math.max(0, rawDaysLate - Math.max(0, s.graceDays));
  if (daysLate === 0) return { rawDaysLate, daysLate: 0, penalty: 0, reason: "WITHIN_GRACE" };
  if (s.penaltyType === "NONE") return { rawDaysLate, daysLate, penalty: 0, reason: "DISABLED" };
  if (forgiven) return { rawDaysLate, daysLate, penalty: 0, reason: "FORGIVEN" };

  const principal = Math.round(amount);
  let penalty = 0;
  if (s.penaltyType === "PERCENT_MONTHLY") {
    penalty = Math.floor((principal * s.percentBpPerMonth * daysLate) / (10_000 * PENALTY_MONTH_DAYS));
  } else if (s.penaltyType === "FIXED_DAILY") {
    penalty = Math.max(0, Math.round(s.fixedPerDay)) * daysLate;
  } else if (s.penaltyType === "PERCENT_DAILY") {
    penalty = Math.floor((principal * s.percentBpPerDay) / 10_000) * daysLate;
  }
  return { rawDaysLate, daysLate, penalty: Math.max(0, penalty), reason: "CHARGED" };
}

export interface SettlementInput {
  id: string;
  seq: number;
  dueDate: string;
  amount: number;
  penaltyForgiven: boolean;
}

export function settlementBreakdown(unpaid: SettlementInput[], today: string, s: FinanceSettings, waivePenalties: boolean) {
  const lines = unpaid.map((i) => {
    const forgiven = i.penaltyForgiven || waivePenalties;
    const charged = computePenalty(i.amount, i.dueDate, today, s, forgiven);
    const gross = computePenalty(i.amount, i.dueDate, today, s, false);
    return {
      installmentId: i.id,
      seq: i.seq,
      dueDate: i.dueDate,
      amount: i.amount,
      daysLate: charged.daysLate,
      penalty: charged.penalty,
      grossPenalty: gross.penalty,
      forgiven: forgiven && gross.penalty > 0,
    };
  });
  const principalTotal = lines.reduce((a, l) => a + l.amount, 0);
  const penaltyTotal = lines.reduce((a, l) => a + l.penalty, 0);
  const forgivenPenaltyTotal = lines.reduce((a, l) => a + (l.forgiven ? l.grossPenalty : 0), 0);
  return { lines, principalTotal, penaltyTotal, forgivenPenaltyTotal, grandTotal: principalTotal + penaltyTotal };
}
