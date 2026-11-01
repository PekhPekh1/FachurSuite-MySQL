import { addJalaliMonths, gregToJalali, jalaliMonthLength, jalaliToGreg } from "./jalali";

/**
 * Installment schedule generation (Stage 6).
 *
 * MONTH-END FALLBACK RULE (documented and consistent):
 *   The contract stores an explicit monthly payment day (`paymentDay`, 1..31).
 *   For every month in the schedule the due date is that day of the Jalali month.
 *   When the month is shorter than `paymentDay` (e.g. day 31 in a 30-day month,
 *   or day 30 in a 29-day Esfand), the due date falls back to the LAST DAY of
 *   that month. The payment day itself is never mutated, so a later long month
 *   returns to the original day instead of drifting earlier.
 *
 *   Example (paymentDay = 31): 31 Farvardin → 31 Ordibehesht → … → 30 Mehr
 *   (Mehr has 30 days) → 30 Aban → … → 29 Esfand (non-leap) → 31 Farvardin.
 */
export interface ScheduleRow {
  seq: number;
  /** Gregorian ISO date (YYYY-MM-DD) — storage format. */
  dueDate: string;
  amount: number;
  /** True when the month was shorter than paymentDay and the date was clamped. */
  clamped: boolean;
}

export interface ScheduleInput {
  firstDueDate: string;
  paymentDay: number;
  installmentCount: number;
  installmentAmount: number;
  /** Signed remainder applied to the final installment when an override is authorized. */
  lastInstallmentAdjustment?: number;
}

export function buildInstallmentSchedule(input: ScheduleInput): ScheduleRow[] {
  const { firstDueDate, paymentDay, installmentCount, installmentAmount } = input;
  if (!Number.isInteger(installmentCount) || installmentCount < 1) throw new Error("تعداد اقساط نامعتبر است");
  if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) throw new Error("روز پرداخت ماهانه نامعتبر است");

  const start = gregToJalali(firstDueDate);
  const adjustment = input.lastInstallmentAdjustment ?? 0;

  return Array.from({ length: installmentCount }, (_, index) => {
    const { jy, jm } = addJalaliMonths(start.jy, start.jm, index);
    const monthLength = jalaliMonthLength(jy, jm);
    const day = Math.min(paymentDay, monthLength);
    const isLast = index === installmentCount - 1;
    return {
      seq: index + 1,
      dueDate: jalaliToGreg(jy, jm, day),
      amount: installmentAmount + (isLast ? adjustment : 0),
      clamped: day !== paymentDay,
    };
  });
}

/* ----------------------------- Financial validation ---------------------------- */

export interface FinancialCheckInput {
  totalPrice: number;
  downPayment: number;
  installmentCount: number;
  installmentAmount: number;
}

export interface FinancialCheck {
  expectedTotal: number;
  /** totalPrice − (downPayment + count × amount). Positive ⇒ installments fall short. */
  discrepancy: number;
  balanced: boolean;
}

/**
 * Pure consistency check. This NEVER rewrites an operator's figures: it only
 * reports the difference so the UI/server can require an explicit, audited
 * override before the remainder is applied to the final installment.
 */
export function checkContractFinancials(input: FinancialCheckInput): FinancialCheck {
  const expectedTotal = input.downPayment + input.installmentCount * input.installmentAmount;
  const discrepancy = input.totalPrice - expectedTotal;
  return { expectedTotal, discrepancy, balanced: discrepancy === 0 };
}
