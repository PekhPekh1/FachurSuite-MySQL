import { z } from "zod";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const digits = (value: string) => value.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));

export function isValidNationalCode(raw: string) {
  const code = digits(raw);
  if (!/^\d{10}$/.test(code) || /^(\d)\1{9}$/.test(code)) return false;
  const check = Number(code[9]);
  const sum = [...code.slice(0, 9)].reduce((total, char, index) => total + Number(char) * (10 - index), 0);
  const remainder = sum % 11;
  return check === (remainder < 2 ? remainder : 11 - remainder);
}

const nationalCode = z
  .string()
  .transform(digits)
  .refine(isValidNationalCode, "کد ملی معتبر نیست");
const mobile = z
  .string()
  .transform(digits)
  .refine((value) => /^09\d{9}$/.test(value), "شماره موبایل معتبر نیست");
const secondaryPhone = z
  .string()
  .transform(digits)
  .refine((value) => !value || /^0\d{9,10}$/.test(value), "شماره تماس دوم معتبر نیست")
  .optional()
  .nullable();

export const customerCreateSchema = z
  .object({
    firstName: z.string().trim().min(2, "نام حداقل ۲ حرف است").max(60),
    lastName: z.string().trim().min(2, "نام خانوادگی حداقل ۲ حرف است").max(60),
    nationalCode,
    mobile,
    secondaryPhone,
    address: z.string().trim().max(500).optional().nullable(),
    occupation: z.string().trim().max(120).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    tags: z.array(z.string().trim().min(1).max(30)).max(12).default([]),
    creditLimit: z.coerce.number().int().min(0).max(900_000_000_000_000).default(0),
  })
  .strict();

export const customerUpdateSchema = customerCreateSchema.partial().strict();

export const customerListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  isActive: z.enum(["true", "false"]).optional(),
  blacklisted: z.enum(["true", "false"]).optional(),
  tag: z.string().trim().max(30).optional(),
});

export const customerStateSchema = z.object({ reason: z.string().trim().min(3, "ذکر دلیل الزامی است").max(300) }).strict();
export const blacklistSchema = z
  .object({ blacklisted: z.boolean(), reason: z.string().trim().max(300).default("") })
  .superRefine((value, ctx) => {
    if (value.blacklisted && value.reason.length < 3) ctx.addIssue({ code: "custom", path: ["reason"], message: "دلیل فهرست سیاه الزامی است" });
  });

export const guarantorCreateSchema = z
  .object({
    fullName: z.string().trim().min(3).max(120),
    nationalCode: z
      .string()
      .transform(digits)
      .refine((value) => !value || isValidNationalCode(value), "کد ملی ضامن معتبر نیست")
      .optional()
      .nullable(),
    mobile: z
      .string()
      .transform(digits)
      .refine((value) => !value || /^09\d{9}$/.test(value), "موبایل ضامن معتبر نیست")
      .optional()
      .nullable(),
    relation: z.string().trim().max(60).optional().nullable(),
    address: z.string().trim().max(500).optional().nullable(),
    notes: z.string().trim().max(500).optional().nullable(),
  })
  .strict();
export const guarantorUpdateSchema = guarantorCreateSchema.partial().strict();

export const documentCategorySchema = z.enum(["NATIONAL_CARD", "GUARANTEE", "CHEQUE", "RECEIPT", "OTHER"]);
