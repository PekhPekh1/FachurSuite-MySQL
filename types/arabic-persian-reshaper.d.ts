declare module "arabic-persian-reshaper" {
  export const ArabicShaper: { convertArabic(input: string): string };
  export const PersianShaper: { convertPersian(input: string): string };
}
