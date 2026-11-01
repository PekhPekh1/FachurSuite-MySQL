import { z } from "zod";

const FA = "۰۱۲۳۴۵۶۷۸۹";
const digits = (value: string) => value.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));
const money = z.coerce.number().int("مبلغ باید عدد صحیح باشد").min(0).max(900_000_000_000_000);
const isoDate = z.string().transform(digits).refine((v) => /^\d{4}-\d{2}-\d{2}$/.test(v), "تاریخ نامعتبر است");

export const contractCreateSchema = z
  .object({
    customerId: z.string().uuid("شناسه مشتری نامعتبر است"),
    type: z.enum(["CASH", "INSTALLMENT"]),
    itemDescription: z.string().trim().min(2, "شرح کالا الزامی است").max(500),
    itemSerialNumber: z.string().trim().max(80).optional().nullable(),
    notes: z.string().trim().max(1000).optional().nullable(),
    cashPrice: money.refine((v) => v > 0, "قیمت نقدی باید بزرگ‌تر از صفر باشد"),
    totalPrice: money.refine((v) => v > 0, "مبلغ کل باید بزرگ‌تر از صفر باشد"),
    downPayment: money.default(0),
    installmentCount: z.coerce.number().int().min(0).max(72, "حداکثر ۷۲ قسط").default(0),
    installmentAmount: money.default(0),
    firstDueDate: isoDate.optional().nullable(),
    paymentDay: z.coerce.number().int().min(1).max(31).optional().nullable(),
    guarantorId: z.string().uuid().optional().nullable(),
    overrideDiscrepancy: z.coerce.boolean().default(false),
    overrideReason: z.string().trim().max(300).optional().nullable(),
    idempotencyKey: z.string().trim().min(8).max(64).optional().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.type === "CASH") {
      if (v.totalPrice !== v.cashPrice) ctx.addIssue({ code: "custom", path: ["totalPrice"], message: "در فروش نقدی مبلغ کل باید برابر قیمت نقدی باشد" });
      return;
    }
    if (v.installmentCount < 1) ctx.addIssue({ code: "custom", path: ["installmentCount"], message: "تعداد اقساط حداقل ۱ است" });
    if (v.installmentAmount < 1) ctx.addIssue({ code: "custom", path: ["installmentAmount"], message: "مبلغ هر قسط باید بزرگ‌تر از صفر باشد" });
    if (v.downPayment >= v.totalPrice) ctx.addIssue({ code: "custom", path: ["downPayment"], message: "پیش‌پرداخت باید کمتر از مبلغ کل باشد" });
    if (!v.firstDueDate) ctx.addIssue({ code: "custom", path: ["firstDueDate"], message: "تاریخ سررسید اولین قسط الزامی است" });
    if (v.overrideDiscrepancy && (!v.overrideReason || v.overrideReason.trim().length < 3)) {
      ctx.addIssue({ code: "custom", path: ["overrideReason"], message: "برای اعمال مغایرت، ثبت دلیل الزامی است" });
    }
  });

export const contractListSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(120).optional(),
  status: z.enum(["ACTIVE", "SETTLED", "CANCELED"]).optional(),
  type: z.enum(["CASH", "INSTALLMENT"]).optional(),
  customerId: z.string().uuid().optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
});

export const contractCancelSchema = z.object({ reason: z.string().trim().min(3, "دلیل لغو الزامی است").max(300) }).strict();
export const contractNotesSchema = z.object({ notes: z.string().trim().max(1000) }).strict();
