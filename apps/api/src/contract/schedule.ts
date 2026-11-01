/**
 * Jalali schedule generation for the API track.
 * Mirrors packages/shared/src/contracts.ts — the month-end fallback rule is:
 * when the target month is shorter than the contract's monthly payment day,
 * the due date falls back to that month's LAST day; the stored payment day is
 * never mutated, so later long months return to the original day.
 */
import { toJalaali, toGregorian, isLeapJalaaliYear } from "jalaali-js";

const pad = (n: number) => String(n).padStart(2, "0");

export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaaliYear(jy) ? 30 : 29;
}

export function gregToJalali(iso: string) {
  const [gy, gm, gd] = iso.slice(0, 10).split("-").map(Number);
  return toJalaali(gy, gm, gd);
}

export function jalaliToGreg(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

export interface ScheduleRow {
  seq: number;
  dueDate: string;
  amount: number;
  clamped: boolean;
}

export function buildInstallmentSchedule(input: {
  firstDueDate: string;
  paymentDay: number;
  installmentCount: number;
  installmentAmount: number;
  lastInstallmentAdjustment?: number;
}): ScheduleRow[] {
  const start = gregToJalali(input.firstDueDate);
  const adjustment = input.lastInstallmentAdjustment ?? 0;
  return Array.from({ length: input.installmentCount }, (_, index) => {
    const zeroBased = start.jm - 1 + index;
    const jy = start.jy + Math.floor(zeroBased / 12);
    const jm = (((zeroBased % 12) + 12) % 12) + 1;
    const monthLength = jalaliMonthLength(jy, jm);
    const day = Math.min(input.paymentDay, monthLength);
    const isLast = index === input.installmentCount - 1;
    return {
      seq: index + 1,
      dueDate: jalaliToGreg(jy, jm, day),
      amount: input.installmentAmount + (isLast ? adjustment : 0),
      clamped: day !== input.paymentDay,
    };
  });
}

export function checkContractFinancials(input: {
  totalPrice: number;
  downPayment: number;
  installmentCount: number;
  installmentAmount: number;
}) {
  const expectedTotal = input.downPayment + input.installmentCount * input.installmentAmount;
  const discrepancy = input.totalPrice - expectedTotal;
  return { expectedTotal, discrepancy, balanced: discrepancy === 0 };
}

export const jalaliYear = (iso: string) => gregToJalali(iso).jy;
export const todayTehran = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
