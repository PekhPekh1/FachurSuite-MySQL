import { describe, expect, it } from "vitest";
import { buildInstallmentSchedule, checkContractFinancials } from "@/lib/contracts";
import { gregToJalali, jalaliMonthLength, jalaliToGreg } from "@/lib/jalali";

const jalali = (iso: string) => {
  const { jy, jm, jd } = gregToJalali(iso);
  return `${jy}/${jm}/${jd}`;
};

describe("installment schedule generation", () => {
  it("keeps the payment day across normal months", () => {
    const rows = buildInstallmentSchedule({
      firstDueDate: jalaliToGreg(1404, 1, 15),
      paymentDay: 15,
      installmentCount: 4,
      installmentAmount: 1_000_000,
    });
    expect(rows.map((r) => jalali(r.dueDate))).toEqual(["1404/1/15", "1404/2/15", "1404/3/15", "1404/4/15"]);
    expect(rows.every((r) => !r.clamped)).toBe(true);
  });

  it("falls back to the last day in shorter months, then restores the original day", () => {
    // Day 31 exists in Farvardin..Shahrivar (31) but not in Mehr..Bahman (30).
    const rows = buildInstallmentSchedule({
      firstDueDate: jalaliToGreg(1404, 5, 31),
      paymentDay: 31,
      installmentCount: 4,
      installmentAmount: 500_000,
    });
    expect(rows.map((r) => jalali(r.dueDate))).toEqual(["1404/5/31", "1404/6/31", "1404/7/30", "1404/8/30"]);
    expect(rows.map((r) => r.clamped)).toEqual([false, false, true, true]);

    // Crossing into the next year returns to day 31 (Farvardin has 31 days).
    const yearCross = buildInstallmentSchedule({
      firstDueDate: jalaliToGreg(1404, 11, 31 > jalaliMonthLength(1404, 11) ? jalaliMonthLength(1404, 11) : 31),
      paymentDay: 31,
      installmentCount: 3,
      installmentAmount: 100,
    });
    expect(jalali(yearCross[2].dueDate)).toBe("1405/1/31");
  });

  it("handles Esfand length in leap and non-leap years", () => {
    const rows = buildInstallmentSchedule({
      firstDueDate: jalaliToGreg(1403, 11, 30),
      paymentDay: 30,
      installmentCount: 2,
      installmentAmount: 100,
    });
    // 1403 is a leap year → Esfand has 30 days, so day 30 survives.
    expect(jalaliMonthLength(1403, 12)).toBe(30);
    expect(jalali(rows[1].dueDate)).toBe("1403/12/30");

    const nonLeap = buildInstallmentSchedule({
      firstDueDate: jalaliToGreg(1404, 11, 30),
      paymentDay: 30,
      installmentCount: 2,
      installmentAmount: 100,
    });
    expect(jalaliMonthLength(1404, 12)).toBe(29);
    expect(jalali(nonLeap[1].dueDate)).toBe("1404/12/29");
    expect(nonLeap[1].clamped).toBe(true);
  });

  it("applies an authorized adjustment only to the final installment", () => {
    const rows = buildInstallmentSchedule({
      firstDueDate: jalaliToGreg(1404, 1, 10),
      paymentDay: 10,
      installmentCount: 3,
      installmentAmount: 1_000_000,
      lastInstallmentAdjustment: 25_000,
    });
    expect(rows.map((r) => r.amount)).toEqual([1_000_000, 1_000_000, 1_025_000]);
  });

  it("rejects invalid counts and payment days", () => {
    const base = { firstDueDate: jalaliToGreg(1404, 1, 1), paymentDay: 1, installmentCount: 1, installmentAmount: 1 };
    expect(() => buildInstallmentSchedule({ ...base, installmentCount: 0 })).toThrow();
    expect(() => buildInstallmentSchedule({ ...base, paymentDay: 32 })).toThrow();
  });
});

describe("contract financial validation", () => {
  it("accepts a balanced contract", () => {
    const result = checkContractFinancials({ totalPrice: 13_000_000, downPayment: 1_000_000, installmentCount: 12, installmentAmount: 1_000_000 });
    expect(result).toEqual({ expectedTotal: 13_000_000, discrepancy: 0, balanced: true });
  });

  it("reports a shortfall without mutating the figures", () => {
    const result = checkContractFinancials({ totalPrice: 13_050_000, downPayment: 1_000_000, installmentCount: 12, installmentAmount: 1_000_000 });
    expect(result.balanced).toBe(false);
    expect(result.discrepancy).toBe(50_000);
    expect(result.expectedTotal).toBe(13_000_000);
  });

  it("reports an excess as a negative discrepancy", () => {
    const result = checkContractFinancials({ totalPrice: 12_900_000, downPayment: 1_000_000, installmentCount: 12, installmentAmount: 1_000_000 });
    expect(result.discrepancy).toBe(-100_000);
  });
});
