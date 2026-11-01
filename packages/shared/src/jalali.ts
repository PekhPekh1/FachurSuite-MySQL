import { toJalaali, toGregorian, isLeapJalaaliYear } from "jalaali-js";

export const FA_MONTHS = [
  "فروردین",
  "اردیبهشت",
  "خرداد",
  "تیر",
  "مرداد",
  "شهریور",
  "مهر",
  "آبان",
  "آذر",
  "دی",
  "بهمن",
  "اسفند",
] as const;

export interface JDate {
  jy: number;
  jm: number;
  jd: number;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Gregorian 'YYYY-MM-DD' of "today" in Asia/Tehran. */
export function todayGreg(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
}

export function gregToJalali(d: string | Date): JDate {
  if (d instanceof Date) {
    const parts = new Intl.DateTimeFormat("en-US-u-ca-gregory", {
      timeZone: "Asia/Tehran",
      year: "numeric",
      month: "numeric",
      day: "numeric",
    }).formatToParts(d);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
    return toJalaali(get("year"), get("month"), get("day"));
  }
  const [gy, gm, gd] = d.slice(0, 10).split("-").map(Number);
  return toJalaali(gy, gm, gd);
}

export function jalaliToGreg(jy: number, jm: number, jd: number): string {
  const { gy, gm, gd } = toGregorian(jy, jm, jd);
  return `${gy}-${pad(gm)}-${pad(gd)}`;
}

/** Number of days in a Jalali month (Esfand is 29, or 30 in a leap year). */
export function jalaliMonthLength(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isLeapJalaaliYear(jy) ? 30 : 29;
}

const jmLen = jalaliMonthLength;

/** Advance `months` Jalali months from (jy, jm) without touching the day. */
export function addJalaliMonths(jy: number, jm: number, months: number): { jy: number; jm: number } {
  const zeroBased = jm - 1 + months;
  return { jy: jy + Math.floor(zeroBased / 12), jm: ((zeroBased % 12) + 12) % 12 + 1 };
}

/** Add N Jalali months to a Gregorian date string, clamping the day. */
export function addMonthsJalali(greg: string, months: number): string {
  if (months === 0) return greg.slice(0, 10);
  const { jy, jm, jd } = gregToJalali(greg);
  let m = jm + months;
  const y = jy + Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  const day = Math.min(jd, jmLen(y, m));
  return jalaliToGreg(y, m, day);
}

/** '1403/07/12' (Latin digits; convert at display time if needed). */
export function formatJalali(d: string | Date | null | undefined, withTime = false): string {
  if (!d) return "—";
  const { jy, jm, jd } = gregToJalali(d);
  const base = `${jy}/${pad(jm)}/${pad(jd)}`;
  if (!withTime) return base;
  const dt = d instanceof Date ? d : new Date(d.length === 10 ? `${d}T12:00:00Z` : d);
  const time = new Intl.DateTimeFormat("en-GB-u-ca-gregory", {
    timeZone: "Asia/Tehran",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(dt);
  return `${base} - ${time}`;
}

/** '12 مهر 1403' long form (latin digits). */
export function formatJalaliLong(d: string | Date | null | undefined): string {
  if (!d) return "—";
  const { jy, jm, jd } = gregToJalali(d);
  return `${jd} ${FA_MONTHS[jm - 1]} ${jy}`;
}

export function jalaliYear(d: string | Date): number {
  return gregToJalali(d).jy;
}

/** Whole days from `from` to `to` (Gregorian date strings). Negative if to<from. */
export function diffDays(from: string, to: string): number {
  return Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

/** First day of the Jalali month containing `greg` (Gregorian string). */
export function jalaliMonthStart(greg: string): string {
  const { jy, jm } = gregToJalali(greg);
  return jalaliToGreg(jy, jm, 1);
}

/** 'مهر 1403' (latin digits) for month charts. */
export function jalaliMonthLabel(greg: string): string {
  const { jy, jm } = gregToJalali(greg);
  return `${FA_MONTHS[jm - 1]} ${jy}`;
}
