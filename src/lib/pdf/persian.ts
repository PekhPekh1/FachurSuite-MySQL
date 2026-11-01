import { ArabicShaper } from "arabic-persian-reshaper";
import bidiFactory from "bidi-js";

/**
 * Persian text cannot be rendered directly by @react-pdf/renderer because it
 * performs no OpenType shaping and no bidirectional reordering. We therefore
 * (1) reshape Persian/Arabic letters into their contextual presentation forms
 * and (2) apply the Unicode bidi algorithm, returning an already-shaped string
 * in visual (left-to-right glyph) order.
 */
const bidi = bidiFactory();

export function shapePersian(text: string): string {
  if (!text) return "";
  const shaped = ArabicShaper.convertArabic(text);
  const levels = bidi.getEmbeddingLevels(shaped, "auto");
  return bidi.getReorderedString(shaped, levels);
}

/** Digits are rendered as Persian numerals on receipts. */
const FA_DIGITS = "۰۱۲۳۴۵۶۷۸۹";
export const toPdfFaDigits = (value: string | number) =>
  value.toString().replace(/[0-9]/g, (d) => FA_DIGITS[Number(d)]);

export const faNumber = (n: number) => toPdfFaDigits(Math.round(n).toLocaleString("en-US"));

/** LTR technical identifiers (card numbers, references) stay Latin. */
export const ltr = (value: string | null | undefined) => (value ? value : "—");

/** Masks a 16-digit card number as 1234-****-****-5678. */
export function maskCard(card: string | null | undefined): string {
  if (!card) return "—";
  const digits = card.replace(/\D/g, "");
  if (digits.length !== 16) return "—";
  return `${digits.slice(0, 4)}-****-****-${digits.slice(12)}`;
}
