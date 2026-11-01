import { describe, expect, it } from "vitest";
import { customerSchema, isValidMobile, isValidNationalCode, normalizeDigits } from "@/lib/validators";
import { computePenalty, settlementBreakdown, defaultFinance } from "@/lib/finance";
import { addMonthsJalali, jalaliToGreg, gregToJalali, todayGreg } from "@/lib/jalali";
import { renderTemplate, toFaDigits, toEnDigits } from "@/lib/format";

const validCode = (base9: string) => {
  const d = base9.split("").map(Number);
  const sum = d.reduce((a, x, i) => a + x * (10 - i), 0);
  const r = sum % 11;
  return base9 + String(r < 2 ? r : 11 - r);
};

describe("Iranian national code validation", () => {
  it("normalizes Persian and Arabic-Indic digits in customer identity fields", () => {
    expect(normalizeDigits("۰۹۱۲۳٤٥٦٧٨٩")).toBe("09123456789");
    const code = validCode("049937089");
    const parsed = customerSchema.parse({
      firstName: "مرتضی",
      lastName: "قریشی",
      nationalCode: toFaDigits(code),
      mobile: toFaDigits("09121234567"),
    });
    expect(parsed.nationalCode).toBe(code);
    expect(parsed.mobile).toBe("09121234567");
  });
  it("accepts checksum-valid codes", () => {
    const code = validCode("049937089");
    expect(code).toHaveLength(10);
    expect(isValidNationalCode(code)).toBe(true);
  });
  it("rejects bad checksum", () => {
    const code = validCode("049937089");
    const broken = code.slice(0, 9) + String((Number(code[9]) + 1) % 10);
    expect(isValidNationalCode(broken)).toBe(false);
  });
  it("rejects repeated digits and wrong length", () => {
    expect(isValidNationalCode("1111111111")).toBe(false);
    expect(isValidNationalCode("123")).toBe(false);
  });
});

describe("Iranian mobile validation", () => {
  it("accepts 09xxxxxxxxx", () => expect(isValidMobile("09121234567")).toBe(true));
  it("rejects landlines and short numbers", () => {
    expect(isValidMobile("02122334455")).toBe(false);
    expect(isValidMobile("0912123456")).toBe(false);
  });
});

describe("penalty engine (integer Toman only)", () => {
  const s = { ...defaultFinance, penaltyType: "PERCENT_DAILY" as const, percentBpPerDay: 10, graceDays: 3 };
  it("applies grace period then percent-per-day", () => {
    // 8 days late, 3 grace → 5 penalized days; 1,000,000 × 0.1% × 5 = 5,000
    const due = "2025-01-01";
    const today = "2025-01-09";
    const r = computePenalty(1_000_000, due, today, s, false);
    expect(r.daysLate).toBe(5);
    expect(r.penalty).toBe(5_000);
  });
  it("fixed daily mode", () => {
    const r = computePenalty(1_000_000, "2025-01-01", "2025-01-06", { ...s, penaltyType: "FIXED_DAILY", fixedPerDay: 50_000 }, false);
    expect(r.daysLate).toBe(2);
    expect(r.penalty).toBe(100_000);
  });
  it("forgiven installments have zero penalty but keep day count", () => {
    const r = computePenalty(1_000_000, "2025-01-01", "2025-01-20", s, true);
    expect(r.penalty).toBe(0);
    expect(r.daysLate).toBeGreaterThan(0);
  });
  it("no penalty before due date", () => {
    const r = computePenalty(1_000_000, "2025-01-10", "2025-01-01", s, false);
    expect(r.penalty).toBe(0);
  });
});

describe("settlement breakdown", () => {
  it("totals principal + penalties with waiver option", () => {
    const lines = settlementBreakdown(
      [
        { id: "a", seq: 1, dueDate: "2025-01-01", amount: 1_000_000, penaltyForgiven: false },
        { id: "b", seq: 2, dueDate: "2025-02-01", amount: 1_000_000, penaltyForgiven: true },
      ],
      "2025-03-01",
      { ...defaultFinance, penaltyType: "PERCENT_DAILY", percentBpPerDay: 10, graceDays: 0 },
      false,
    );
    expect(lines.principalTotal).toBe(2_000_000);
    expect(lines.grandTotal).toBe(lines.principalTotal + lines.penaltyTotal);
    expect(lines.lines[1].penalty).toBe(0);
    const waived = settlementBreakdown(
      [{ id: "a", seq: 1, dueDate: "2025-01-01", amount: 1_000_000, penaltyForgiven: false }],
      "2025-03-01",
      { ...defaultFinance, graceDays: 0 },
      true,
    );
    expect(waived.grandTotal).toBe(1_000_000);
  });
});

describe("jalali calendar math", () => {
  it("round-trips gregorian↔jalali", () => {
    expect(jalaliToGreg(1403, 7, 12)).toBe("2024-10-03");
    const j = gregToJalali("2024-10-03");
    expect([j.jy, j.jm, j.jd]).toEqual([1403, 7, 12]);
  });
  it("month increment clamps days at month end", () => {
    // 30 هزارم... Bahman 30 + 2 months stays valid (1404 Ordibehesht)
    const g = jalaliToGreg(1403, 11, 30);
    const next = addMonthsJalali(g, 1); // → اسفند 30 (1403 کبیسه)
    const j = gregToJalali(next);
    expect([j.jm, j.jd]).toEqual([12, 30]);
    const after = gregToJalali(addMonthsJalali(g, 2));
    expect([after.jy, after.jm, after.jd]).toEqual([1404, 1, 30]);
  });
  it("todayGreg returns YYYY-MM-DD", () => {
    expect(todayGreg()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("formatting helpers", () => {
  it("SMS template rendering substitutes known keys only", () => {
    expect(renderTemplate("سلام {customer}، قرارداد {contractNo} ثبت شد.", { customer: "علی", contractNo: "INS-1" })).toBe("سلام علی، قرارداد INS-1 ثبت شد.");
    expect(renderTemplate("شماره {contractNo} و {unknown}", { contractNo: "X" })).toBe("شماره X و {unknown}");
  });
  it("digit conversion round-trips", () => {
    expect(toEnDigits(toFaDigits("1234567"))).toBe("1234567");
  });
});
