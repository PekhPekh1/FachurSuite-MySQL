import { diffDays } from "./jalali";

/* --------------------------------- Settings -------------------------------- */

export type PenaltyType = "NONE" | "PERCENT_MONTHLY" | "FIXED_DAILY" | "PERCENT_DAILY";

export interface FinanceSettings {
  penaltyType: PenaltyType;
  /** Basis points of the installment charged per 30-day month (120 = 1.2%/month). */
  percentBpPerMonth: number;
  /** Legacy daily-percent rate, in basis points per day (10 = 0.1%/day). */
  percentBpPerDay: number;
  /** Fixed Toman charged per late day when penaltyType = FIXED_DAILY. */
  fixedPerDay: number;
  /** Whole days after the due date before any penalty accrues. */
  graceDays: number;
  /** UI default for new installment contracts. */
  defaultInstallmentCount: number;
  /** Display preference; authoritative monetary values remain Toman. */
  currency: "TOMAN" | "RIAL";
}

export const defaultFinance: FinanceSettings = {
  penaltyType: "PERCENT_MONTHLY",
  percentBpPerMonth: 120,
  percentBpPerDay: 10,
  fixedPerDay: 50_000,
  graceDays: 3,
  defaultInstallmentCount: 12,
  currency: "TOMAN",
};

/** Days used to pro-rate a monthly penalty rate. Fixed by policy, not calendar. */
export const PENALTY_MONTH_DAYS = 30;

/* ------------------------------ Installment status --------------------------- */

export type StoredInstallmentStatus = "PENDING" | "RESERVED" | "PAID" | "FORGIVEN";
export type DisplayInstallmentStatus = "PENDING" | "RESERVED" | "PAID" | "FORGIVEN" | "OVERDUE";

/**
 * OVERDUE is always DERIVED, never stored: an installment is overdue when it is
 * still PENDING and its due date is strictly before today (Asia/Tehran civil
 * date). Because PAID/FORGIVEN are terminal, a settled installment can never
 * become overdue again — even if its due date is in the past.
 */
export function deriveInstallmentStatus(
  stored: StoredInstallmentStatus,
  dueDate: string,
  today: string,
): DisplayInstallmentStatus {
  if (stored === "PAID" || stored === "FORGIVEN" || stored === "RESERVED") return stored;
  return dueDate < today ? "OVERDUE" : "PENDING";
}

/* ------------------------------ Penalty engine ------------------------------ */

export interface PenaltyResult {
  /** Whole days past the due date, before the grace period is applied. */
  rawDaysLate: number;
  /** Chargeable days: rawDaysLate − graceDays, floored at 0. */
  daysLate: number;
  /** Penalty in whole Toman (never negative). */
  penalty: number;
  /** Why the penalty is zero, when it is. */
  reason: "NOT_DUE" | "WITHIN_GRACE" | "DISABLED" | "FORGIVEN" | "CHARGED";
}

/**
 * AUTHORITATIVE PENALTY RULES (Stage 7)
 *
 * Start date  : the day AFTER the due date. `rawDaysLate` is the number of whole
 *               civil days (Asia/Tehran) between the due date and today, so a
 *               payment made on the due date itself is never late.
 * Grace       : `graceDays` whole days are free. Charging begins on day
 *               graceDays + 1, and `daysLate = max(0, rawDaysLate − graceDays)`.
 *               Only the days beyond grace are charged — grace days are never
 *               retro-charged once the grace window is exceeded.
 * Modes       :
 *   PERCENT_MONTHLY : floor(amount × bpPerMonth × daysLate / (10000 × 30))
 *                     A monthly rate pro-rated per day over a fixed 30-day
 *                     month; a single division keeps it exact to the Toman.
 *   FIXED_DAILY     : fixedPerDay × daysLate
 *   PERCENT_DAILY   : floor(amount × bpPerDay / 10000) × daysLate   (legacy)
 *   NONE            : always 0
 * Rounding    : floor to whole Toman — the customer is never over-charged by
 *               rounding, and the result is deterministic for the same inputs.
 * Decimal-safe: every input is an integer number of Toman and all arithmetic is
 *               integer arithmetic; no floating-point accumulation occurs.
 * Idempotence : penalties are DERIVED on read from (amount, dueDate, today,
 *               settings). Nothing is stored per-day, so the same penalty can
 *               never be charged twice; once an installment is PAID/FORGIVEN it
 *               stops accruing entirely.
 */
export function computePenalty(
  amount: number,
  dueDate: string,
  today: string,
  s: FinanceSettings,
  forgiven = false,
): PenaltyResult {
  const rawDaysLate = Math.max(0, diffDays(dueDate, today));
  if (rawDaysLate <= 0) return { rawDaysLate: 0, daysLate: 0, penalty: 0, reason: "NOT_DUE" };

  const daysLate = Math.max(0, rawDaysLate - Math.max(0, s.graceDays));
  if (daysLate === 0) return { rawDaysLate, daysLate: 0, penalty: 0, reason: "WITHIN_GRACE" };
  if (s.penaltyType === "NONE") return { rawDaysLate, daysLate, penalty: 0, reason: "DISABLED" };
  if (forgiven) return { rawDaysLate, daysLate, penalty: 0, reason: "FORGIVEN" };

  const principal = Math.round(amount);
  let penalty: number;
  switch (s.penaltyType) {
    case "PERCENT_MONTHLY":
      penalty = Math.floor((principal * s.percentBpPerMonth * daysLate) / (10_000 * PENALTY_MONTH_DAYS));
      break;
    case "FIXED_DAILY":
      penalty = Math.max(0, Math.round(s.fixedPerDay)) * daysLate;
      break;
    case "PERCENT_DAILY":
      penalty = Math.floor((principal * s.percentBpPerDay) / 10_000) * daysLate;
      break;
    default:
      penalty = 0;
  }
  return { rawDaysLate, daysLate, penalty: Math.max(0, penalty), reason: "CHARGED" };
}

/* --------------------------- Settlement calculation -------------------------- */

export interface SettlementLine {
  installmentId: string;
  seq: number;
  dueDate: string;
  amount: number;
  daysLate: number;
  penalty: number;
  forgiven: boolean;
}

export interface SettlementBreakdown {
  lines: SettlementLine[];
  principalTotal: number;
  penaltyTotal: number;
  /** Penalties that exist but are not charged (already forgiven or waived now). */
  forgivenPenaltyTotal: number;
  grandTotal: number;
}

export interface SettlementInput {
  id: string;
  seq: number;
  dueDate: string;
  amount: number;
  penaltyForgiven: boolean;
}

/**
 * Early settlement: principal of every unpaid installment (future installments
 * are NOT discounted and NO interest is derived) plus penalties accrued to date
 * on overdue ones. `waivePenalties` applies an authorized blanket forgiveness.
 */
export function settlementBreakdown(
  unpaid: SettlementInput[],
  today: string,
  s: FinanceSettings,
  waivePenalties: boolean,
): SettlementBreakdown {
  const lines: SettlementLine[] = unpaid.map((i) => {
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
      forgiven: forgiven && gross.penalty > 0,
    };
  });

  const principalTotal = lines.reduce((a, l) => a + l.amount, 0);
  const penaltyTotal = lines.reduce((a, l) => a + l.penalty, 0);
  const forgivenPenaltyTotal = unpaid.reduce((acc, i) => {
    const forgiven = i.penaltyForgiven || waivePenalties;
    if (!forgiven) return acc;
    return acc + computePenalty(i.amount, i.dueDate, today, s, false).penalty;
  }, 0);

  return { lines, principalTotal, penaltyTotal, forgivenPenaltyTotal, grandTotal: principalTotal + penaltyTotal };
}
