import { describe, expect, it } from "vitest";

// Locks the workspace boundary: the app's "@/lib/*" shims must re-export the
// canonical @installments/shared modules (same object identity).
import * as shimFormat from "@/lib/format";
import * as shimValidators from "@/lib/validators";
import * as shimJalali from "@/lib/jalali";
import * as shimFinance from "@/lib/finance";
import * as shimPalettes from "@/lib/palettes";
import * as sharedFormat from "@shared/format";
import * as sharedValidators from "@shared/validators";
import * as sharedJalali from "@shared/jalali";
import * as sharedFinance from "@shared/finance";
import * as sharedPalettes from "@shared/palettes";

describe("@installments/shared wiring", () => {
  it("re-export identity: format", () => {
    expect(shimFormat.toFaDigits).toBe(sharedFormat.toFaDigits);
    expect(shimFormat.fmtToman).toBe(sharedFormat.fmtToman);
  });
  it("re-export identity: validators", () => {
    expect(shimValidators.isValidNationalCode).toBe(sharedValidators.isValidNationalCode);
    expect(shimValidators.customerSchema).toBe(sharedValidators.customerSchema);
  });
  it("re-export identity: jalali", () => {
    expect(shimJalali.addMonthsJalali).toBe(sharedJalali.addMonthsJalali);
  });
  it("re-export identity: finance", () => {
    expect(shimFinance.computePenalty).toBe(sharedFinance.computePenalty);
    expect(shimFinance.defaultFinance).toBe(sharedFinance.defaultFinance);
  });
  it("re-export identity: palettes", () => {
    expect(shimPalettes.PALETTES).toBe(sharedPalettes.PALETTES);
  });
});
