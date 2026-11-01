const FA = "۰۱۲۳۴۵۶۷۸۹";

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");

export const toFaDigits = (s: string | number): string =>
  s.toString().replace(/[0-9]/g, (d) => FA[Number(d)]);

export const toEnDigits = (s: string): string =>
  s.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d))).replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));

/** Group thousands (latin), then optionally convert to Persian digits. */
export function fmtNum(n: number | null | undefined, fa: boolean): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  const g = Math.round(n).toLocaleString("en-US");
  return fa ? toFaDigits(g) : g;
}

export function fmtToman(n: number | null | undefined, fa: boolean, withUnit = true): string {
  return withUnit ? `${fmtNum(n, fa)} تومان` : fmtNum(n, fa);
}

export function fmtRial(nToman: number | null | undefined, fa: boolean): string {
  if (nToman === null || nToman === undefined) return "—";
  return `${fmtNum(nToman * 10, fa)} ریال`;
}

export function fmtDate(j: string, fa: boolean): string {
  return fa ? toFaDigits(j) : j;
}

/** {placeholder} substitution used by the SMS template engine. Unknown keys are left intact. */
export function renderTemplate(body: string, vars: Record<string, string | number>): string {
  return body.replace(/\{(\w+)\}/g, (_, k: string) => (k in vars ? String(vars[k]) : `{${k}}`));
}

export const PAYMENT_METHOD_FA: Record<string, string> = {
  CASH: "نقدی",
  CARD_READER: "کارتخوان",
  CARD_TO_CARD: "کارت به کارت",
};

export const PAYMENT_STATUS_FA: Record<string, string> = {
  PENDING_VERIFICATION: "در انتظار بررسی",
  CONFIRMED: "تأیید شده",
  REJECTED: "رد شده",
};

export const CONTRACT_STATUS_FA: Record<string, string> = {
  ACTIVE: "فعال",
  SETTLED: "تسویه شده",
  CANCELED: "لغو شده",
};

export const ROLE_FA: Record<string, string> = {
  ADMIN: "مدیر سیستم",
  OPERATOR: "اپراتور",
  CUSTOMER: "مشتری",
};
