import { z } from "zod";

/** Convert Persian and Arabic-Indic numerals to ASCII before validation/storage. */
export function normalizeDigits(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.replace(/[۰-۹٠-٩]/g, (digit) => {
    const code = digit.charCodeAt(0);
    return String(code >= 0x06f0 && code <= 0x06f9 ? code - 0x06f0 : code - 0x0660);
  });
}

const normalizeOptionalDigits = normalizeDigits;

/* --------------------------- Iranian identity rules --------------------------- */

export function isValidNationalCode(code: string): boolean {
  if (!/^\d{10}$/.test(code)) return false;
  if (/^(\d)\1{9}$/.test(code)) return false;
  const check = Number(code[9]);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(code[i]) * (10 - i);
  const rem = sum % 11;
  return rem < 2 ? check === rem : check === 11 - rem;
}

export const isValidMobile = (m: string) => /^09\d{9}$/.test(m);
export const isValidPhone = (p: string) => /^0\d{9,10}$/.test(p);

/* --------------------------------- Schemas --------------------------------- */

const nationalCode = z.preprocess(
  normalizeOptionalDigits,
  z.string().regex(/^\d{10}$/, "کد ملی باید ۱۰ رقم باشد").refine(isValidNationalCode, "کد ملی معتبر نیست"),
);

const mobile = z.preprocess(
  normalizeOptionalDigits,
  z.string().regex(/^09\d{9}$/, "شماره موبایل معتبر نیست (مثال: 09123456789)"),
);

const money = (msg = "مبلغ باید عدد صحیح (تومان) باشد") =>
  z.coerce.number().int(msg).min(0, "مبلغ نمی‌تواند منفی باشد").max(900_000_000_000_000, "مبلغ بیش از حد مجاز است");

const moneyPos = money().min(1, "مبلغ باید بزرگ‌تر از صفر باشد");

const uuid = z.string().uuid("شناسه نامعتبر است");

export const loginSchema = z.object({
  username: z.string().min(3, "نام کاربری را وارد کنید"),
  password: z.string().min(1, "رمز عبور را وارد کنید"),
});
export type LoginInput = z.infer<typeof loginSchema>;

export const customerSchema = z.object({
  firstName: z.string().trim().min(2, "نام حداقل ۲ حرف است").max(60),
  lastName: z.string().trim().min(2, "نام خانوادگی حداقل ۲ حرف است").max(60),
  nationalCode,
  mobile,
  phone: z
    .preprocess(normalizeOptionalDigits, z.string().optional())
    .refine((v) => !v || isValidPhone(v), "شماره تماس دوم معتبر نیست (با پیش‌شماره، مثال: 02112345678)"),
  address: z.string().max(500, "آدرس حداکثر ۵۰۰ حرف").optional().nullable(),
  occupation: z.string().trim().max(120, "شغل حداکثر ۱۲۰ حرف").optional().nullable(),
  notes: z.string().max(1000, "یادداشت حداکثر ۱۰۰۰ حرف").optional().nullable(),
  tags: z.array(z.string().trim().min(1).max(30)).max(12, "حداکثر ۱۲ برچسب").default([]),
  creditLimit: money().default(0),
}).strict();
export type CustomerInput = z.infer<typeof customerSchema>;

export const guarantorSchema = z.object({
  customerId: uuid,
  fullName: z.string().trim().min(3, "نام ضامن حداقل ۳ حرف است").max(120),
  nationalCode: z
    .preprocess(normalizeOptionalDigits, z.string().optional())
    .refine((v) => !v || isValidNationalCode(v), "کد ملی ضامن معتبر نیست"),
  mobile: z
    .preprocess(normalizeOptionalDigits, z.string().optional())
    .refine((v) => !v || isValidMobile(v), "شماره موبایل ضامن معتبر نیست"),
  relation: z.string().max(60).optional().nullable(),
  address: z.string().max(500).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});
export type GuarantorInput = z.infer<typeof guarantorSchema>;

export const contractSchema = z
  .object({
    customerId: uuid,
    type: z.enum(["CASH", "INSTALLMENT"]),
    itemDescription: z.string().trim().min(2, "شرح کالا/خدمت الزامی است").max(500),
    itemSerialNumber: z.string().trim().max(80, "شماره سریال حداکثر ۸۰ نویسه").optional().nullable(),
    notes: z.string().trim().max(1000, "یادداشت حداکثر ۱۰۰۰ نویسه").optional().nullable(),
    cashPrice: moneyPos,
    totalPrice: moneyPos,
    downPayment: money().default(0),
    installmentCount: z.coerce.number().int("تعداد اقساط باید عدد صحیح باشد").min(0).max(72, "حداکثر ۷۲ قسط").default(0),
    installmentAmount: money().default(0),
    firstDueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است")
      .optional()
      .nullable(),
    /** 1..31; months shorter than this fall back to their last day. */
    paymentDay: z.coerce.number().int().min(1, "روز پرداخت باید بین ۱ تا ۳۱ باشد").max(31, "روز پرداخت باید بین ۱ تا ۳۱ باشد").optional().nullable(),
    guarantorId: uuid.optional().nullable(),
    /** Explicit authorized override for a financial discrepancy (audited). */
    overrideDiscrepancy: z.coerce.boolean().default(false),
    overrideReason: z.string().trim().max(300).optional().nullable(),
    idempotencyKey: z.string().trim().min(8, "کلید یکتا نامعتبر است").max(64).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.type === "CASH") {
      if (v.totalPrice !== v.cashPrice) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice"], message: "در فروش نقدی مبلغ کل باید برابر قیمت نقدی باشد" });
      }
    } else {
      if (v.installmentCount < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["installmentCount"], message: "تعداد اقساط حداقل ۱ است" });
      if (v.installmentAmount < 1) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["installmentAmount"], message: "مبلغ هر قسط باید بزرگ‌تر از صفر باشد" });
      if (v.downPayment >= v.totalPrice) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["downPayment"], message: "پیش‌پرداخت باید کمتر از مبلغ کل باشد" });
      if (!v.firstDueDate) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["firstDueDate"], message: "تاریخ سررسید اولین قسط الزامی است" });
      if (v.cashPrice > v.totalPrice) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["totalPrice"], message: "مبلغ اقساطی معمولاً نباید کمتر از قیمت نقدی باشد" });
      if (v.overrideDiscrepancy && (!v.overrideReason || v.overrideReason.trim().length < 3)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["overrideReason"], message: "برای اعمال مغایرت، ثبت دلیل الزامی است" });
      }
    }
  });
export type ContractInput = z.infer<typeof contractSchema>;

export const paymentCreateSchema = z
  .object({
    contractId: uuid,
    installmentIds: z.array(uuid).min(1, "حداقل یک قسط انتخاب کنید"),
    method: z.enum(["CASH", "CARD_READER", "CARD_TO_CARD"]),
    amount: moneyPos,
    /** When the money actually moved. Defaults to now on the server. */
    paidAt: z.string().datetime({ offset: true }).optional().nullable(),
    referenceNo: z.string().trim().max(80).optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
    /** 16-digit source card; required for customer card-to-card submissions. */
    sourceCardNumber: z
      .preprocess(
        normalizeOptionalDigits,
        z.string().trim().regex(/^[0-9]{16}$/, "شماره کارت مبدأ باید ۱۶ رقم باشد").optional().nullable(),
      ),
    receiptDocumentId: uuid.optional().nullable(),
    idempotencyKey: z.string().min(8).max(64),
    settle: z.coerce.boolean().default(false),
    waivePenalties: z.coerce.boolean().default(false),
    /** Set when resubmitting after a rejection. */
    resubmissionOf: uuid.optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (v.method === "CARD_TO_CARD") {
      if (!v.referenceNo || v.referenceNo.trim().length < 3) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["referenceNo"], message: "شماره پیگیری فیش الزامی است" });
      }
      if (!v.sourceCardNumber) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["sourceCardNumber"], message: "شماره کارت مبدأ الزامی است" });
      }
    }
  });
export type PaymentCreateInput = z.infer<typeof paymentCreateSchema>;

export const reviewSchema = z
  .object({
    paymentId: uuid,
    approve: z.boolean(),
    reviewNote: z.string().trim().max(300).optional().nullable(),
  })
  .superRefine((v, ctx) => {
    if (!v.approve && (!v.reviewNote || v.reviewNote.trim().length < 3)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reviewNote"], message: "برای رد فیش، ذکر دلیل الزامی است" });
    }
  });
export type ReviewInput = z.infer<typeof reviewSchema>;

export const forgivePenaltySchema = z.object({
  installmentId: uuid,
  reason: z.string().trim().min(3, "دلیل بخشودگی الزامی است").max(300),
});

/** Waive the entire installment obligation (status → FORGIVEN). ADMIN only. */
export const forgiveInstallmentSchema = z.object({
  installmentId: uuid,
  reason: z.string().trim().min(3, "دلیل بخشودگی قسط الزامی است").max(300),
});

/** Authorized due-date change for a single unpaid installment. ADMIN only. */
export const changeDueDateSchema = z.object({
  installmentId: uuid,
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است"),
  reason: z.string().trim().min(3, "دلیل تغییر سررسید الزامی است").max(300),
});

export const settlementQuoteSchema = z.object({
  contractId: uuid,
  waivePenalties: z.coerce.boolean().default(false),
});

export const cancelContractSchema = z.object({
  contractId: uuid,
  reason: z.string().trim().min(3, "دلیل لغو الزامی است").max(300),
});

export const storeSettingsSchema = z.object({
  storeName: z.string().trim().min(2, "نام فروشگاه الزامی است").max(120),
  phone: z.string().max(20).optional().nullable(),
  address: z.string().max(300).optional().nullable(),
  /** Stored document id or public path of the store logo. */
  logoUrl: z.string().trim().max(300).optional().nullable(),
  description: z.string().trim().max(500, "توضیحات حداکثر ۵۰۰ نویسه").optional().nullable(),
  /** Free-text lines printed at the top of receipts and contracts. */
  printHeader: z.string().trim().max(300, "سربرگ چاپ حداکثر ۳۰۰ نویسه").optional().nullable(),
  printFooter: z.string().trim().max(300).optional().nullable(),
});
export type StoreSettings = z.infer<typeof storeSettingsSchema>;

/** A store bank card customers can transfer card-to-card payments to. */
export const bankAccountSchema = z
  .object({
    bankName: z.string().trim().min(2, "نام بانک الزامی است").max(60),
    cardNumber: z.preprocess(normalizeDigits, z.string().trim().regex(/^[0-9]{16}$/, "شماره کارت باید ۱۶ رقم باشد")),
    cardHolder: z.string().trim().min(2, "نام صاحب کارت الزامی است").max(120),
    iban: z.preprocess(
      normalizeOptionalDigits,
      z.string().trim().regex(/^IR[0-9]{24}$/, "شماره شبا معتبر نیست (مثال: IR followed by 24 digits)").optional().nullable(),
    ),
    isActive: z.coerce.boolean().default(true),
  })
  .strict();

export const bankAccountsSettingsSchema = z.object({
  accounts: z.array(bankAccountSchema).max(6, "حداکثر ۶ کارت").default([]),
});
export type BankAccount = z.infer<typeof bankAccountSchema>;
export type BankAccountsSettings = z.infer<typeof bankAccountsSettingsSchema>;

export const emptyBankAccounts: BankAccountsSettings = { accounts: [] };

export const financeSettingsSchema = z.object({
  penaltyType: z.enum(["NONE", "PERCENT_MONTHLY", "FIXED_DAILY", "PERCENT_DAILY"]),
  percentBpPerMonth: z.coerce.number().int().min(0, "نرخ نامعتبر است").max(10_000, "حداکثر ۱۰۰٪ در ماه").default(120),
  percentBpPerDay: z.coerce.number().int().min(0, "نرخ نامعتبر است").max(1000, "حداکثر ۱۰٪ در روز").default(10),
  fixedPerDay: money().default(0),
  graceDays: z.coerce.number().int().min(0).max(60, "حداکثر ۶۰ روز مهلت"),
  /** Default installment count pre-filled on the contract form. */
  defaultInstallmentCount: z.coerce.number().int().min(1, "حداقل ۱ قسط").max(72, "حداکثر ۷۲ قسط").default(12),
  /** Toman (default) or Rial display. */
  currency: z.enum(["TOMAN", "RIAL"]).default("TOMAN"),
});
export type FinanceSettingsInput = z.infer<typeof financeSettingsSchema>;

export const userCreateSchema = z
  .object({
    username: z.string().regex(/^[a-zA-Z0-9_.]{3,60}$/, "نام کاربری: ۳ تا ۶۰ حرف لاتین، عدد، نقطه یا خط زیرین"),
    password: z.string().min(6, "رمز عبور حداقل ۶ کاراکتر است").max(100),
    fullName: z.string().trim().min(3, "نام کامل الزامی است").max(120),
    role: z.enum(["ADMIN", "OPERATOR", "CUSTOMER"]),
    customerId: uuid.optional().nullable(),
    canReviewPayments: z.coerce.boolean().default(false),
  })
  .refine((v) => v.role !== "CUSTOMER" || !!v.customerId, {
    path: ["customerId"],
    message: "برای کاربر مشتری، انتخاب پرونده مشتری الزامی است",
  });
export type UserCreateInput = z.infer<typeof userCreateSchema>;

export const passwordResetSchema = z.object({
  userId: uuid,
  password: z.string().min(8, "رمز عبور حداقل ۸ کاراکتر است").max(100),
});

/** Editing an existing user's profile (role and review permission). */
export const userUpdateSchema = z
  .object({
    userId: uuid,
    fullName: z.string().trim().min(3, "نام کامل الزامی است").max(120),
    role: z.enum(["ADMIN", "OPERATOR", "CUSTOMER"]),
    customerId: uuid.optional().nullable(),
    canReviewPayments: z.coerce.boolean().default(false),
  })
  .refine((v) => v.role !== "CUSTOMER" || !!v.customerId, {
    path: ["customerId"],
    message: "برای کاربر مشتری، انتخاب پرونده مشتری الزامی است",
  });

/** Per-user appearance preferences. */
export const userPreferencesSchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).default("system"),
    palette: z.enum(["blue", "green", "purple", "orange", "teal", "rose"]).default("blue"),
    faDigits: z.boolean().default(true),
  })
  .strict();
export type UserPreferences = z.infer<typeof userPreferencesSchema>;

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, "رمز عبور فعلی را وارد کنید"),
    newPassword: z
      .string()
      .min(8, "رمز عبور جدید حداقل ۸ کاراکتر است")
      .max(100)
      .regex(/[A-Za-zآ-ی]/, "رمز عبور باید حداقل یک حرف داشته باشد")
      .regex(/[0-9۰-۹]/, "رمز عبور باید حداقل یک عدد داشته باشد"),
  })
  .refine((v) => v.currentPassword !== v.newPassword, {
    path: ["newPassword"],
    message: "رمز عبور جدید باید با رمز فعلی متفاوت باشد",
  });
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;

