/** Client-safe palette registry (no server imports allowed here). */
export const PALETTES = ["blue", "green", "purple", "orange", "teal", "rose"] as const;
export type Palette = (typeof PALETTES)[number];

export const PALETTE_FA: Record<Palette, string> = {
  blue: "آبی",
  green: "سبز",
  purple: "بنفش",
  orange: "نارنجی",
  teal: "فیروزه‌ای",
  rose: "رز",
};
