import { describe, expect, it } from "vitest";
import {
  computePenalty,
  defaultFinance,
  deriveInstallmentStatus,
  settlementBreakdown,
  type FinanceSettings,
} from "@/lib/finance";

const monthly: FinanceSettings = { ...defaultFinance, penaltyType: "PERCENT_MONTHLY", percentBpPerMonth: 120, graceDays: 3 };
const fixed: FinanceSettings = { ...defaultFinance, penaltyType: "FIXED_DAILY", fixedPerDay: 50_000, graceDays: 3 };

describe("grace period", () => {
  it("charges nothing on or before the due date", () => {
    expect(computePenalty(1_000_000, "2026-03-10", "2026-03-10", monthly).penalty).toBe(0);
    expect(computePenalty(1_000_000, "2026-03-10", "2026-03-09", monthly).reason).toBe("NOT_DUE");
  });

  it("charges nothing while inside the grace window", () => {
    const r = computePenalty(1_000_000, "2026-03-10", "2026-03-13", monthly); // 3 days late, 3 grace
    expect(r.rawDaysLate).toBe(3);
    expect(r.daysLate).toBe(0);
    expect(r.penalty).toBe(0);
    expect(r.reason).toBe("WITHIN_GRACE");
  });

  it("charges only the days beyond grace — grace days are never retro-charged", () => {
    const r = computePenalty(1_000_000, "2026-03-10", "2026-03-14", monthly); // 4 days late
    expect(r.rawDaysLate).toBe(4);
    expect(r.daysLate).toBe(1);
    // floor(1,000,000 × 120 × 1 / (10000 × 30)) = 400
    expect(r.penalty).toBe(400);
  });

  it("supports a zero-day grace period", () => {
    const r = computePenalty(1_000_000, "2026-03-10", "2026-03-11", { ...monthly, graceDays: 0 });
    expect(r.daysLate).toBe(1);
    expect(r.penalty).toBe(400);
  });
});

describe("penalty modes and rounding", () => {
  it("PERCENT_MONTHLY pro-rates over a 30-day month", () => {
    // 30 chargeable days = exactly one month = 1.2% of 2,000,000 = 24,000
    const r = computePenalty(2_000_000, "2026-01-01", "2026-02-03", monthly); // 33 raw − 3 grace = 30
    expect(r.daysLate).toBe(30);
    expect(r.penalty).toBe(24_000);
  });

  it("PERCENT_MONTHLY floors fractional Toman (never over-charges)", () => {
    // 123,456 × 120 × 1 / 300000 = 49.38 → 49
    const r = computePenalty(123_456, "2026-03-10", "2026-03-14", monthly);
    expect(r.penalty).toBe(49);
  });

  it("FIXED_DAILY multiplies the daily amount by chargeable days", () => {
    const r = computePenalty(1_000_000, "2026-03-10", "2026-03-20", fixed); // 10 − 3 = 7
    expect(r.daysLate).toBe(7);
    expect(r.penalty).toBe(350_000);
  });

  it("NONE disables penalties entirely", () => {
    const r = computePenalty(5_000_000, "2026-01-01", "2026-06-01", { ...monthly, penaltyType: "NONE" });
    expect(r.penalty).toBe(0);
    expect(r.reason).toBe("DISABLED");
  });

  it("is deterministic and never negative", () => {
    const a = computePenalty(777_777, "2026-02-01", "2026-04-01", monthly);
    const b = computePenalty(777_777, "2026-02-01", "2026-04-01", monthly);
    expect(a).toEqual(b);
    expect(a.penalty).toBeGreaterThanOrEqual(0);
  });

  it("returns zero for a forgiven installment but keeps the day count", () => {
    const r = computePenalty(1_000_000, "2026-01-01", "2026-03-01", monthly, true);
    expect(r.penalty).toBe(0);
    expect(r.reason).toBe("FORGIVEN");
    expect(r.daysLate).toBeGreaterThan(0);
  });
});

describe("installment status derivation", () => {
  it("marks an unpaid past-due installment overdue", () => {
    expect(deriveInstallmentStatus("PENDING", "2026-03-01", "2026-03-02")).toBe("OVERDUE");
  });

  it("keeps a not-yet-due installment pending (due date itself is not overdue)", () => {
    expect(deriveInstallmentStatus("PENDING", "2026-03-02", "2026-03-02")).toBe("PENDING");
  });

  it("never lets a paid or forgiven installment become overdue again", () => {
    expect(deriveInstallmentStatus("PAID", "2020-01-01", "2026-03-02")).toBe("PAID");
    expect(deriveInstallmentStatus("FORGIVEN", "2020-01-01", "2026-03-02")).toBe("FORGIVEN");
  });

  it("keeps reserved installments in review state", () => {
    expect(deriveInstallmentStatus("RESERVED", "2020-01-01", "2026-03-02")).toBe("RESERVED");
  });
});

describe("early settlement", () => {
  const unpaid = [
    { id: "a", seq: 1, dueDate: "2026-01-01", amount: 1_000_000, penaltyForgiven: false }, // overdue
    { id: "b", seq: 2, dueDate: "2026-09-01", amount: 1_000_000, penaltyForgiven: false }, // future
  ];

  it("sums principal of all unpaid installments without discount or interest", () => {
    const r = settlementBreakdown(unpaid, "2026-03-01", monthly, false);
    expect(r.principalTotal).toBe(2_000_000);
    expect(r.grandTotal).toBe(r.principalTotal + r.penaltyTotal);
  });

  it("charges penalties only on overdue lines", () => {
    const r = settlementBreakdown(unpaid, "2026-03-01", monthly, false);
    expect(r.lines[0].penalty).toBeGreaterThan(0);
    expect(r.lines[1].penalty).toBe(0);
  });

  it("waiving penalties drops the charge and reports the forgiven amount", () => {
    const gross = settlementBreakdown(unpaid, "2026-03-01", monthly, false);
    const waived = settlementBreakdown(unpaid, "2026-03-01", monthly, true);
    expect(waived.penaltyTotal).toBe(0);
    expect(waived.grandTotal).toBe(waived.principalTotal);
    expect(waived.forgivenPenaltyTotal).toBe(gross.penaltyTotal);
  });

  it("respects a per-installment forgiveness flag", () => {
    const r = settlementBreakdown(
      [{ ...unpaid[0], penaltyForgiven: true }, unpaid[1]],
      "2026-03-01",
      monthly,
      false,
    );
    expect(r.penaltyTotal).toBe(0);
    expect(r.forgivenPenaltyTotal).toBeGreaterThan(0);
  });
});
