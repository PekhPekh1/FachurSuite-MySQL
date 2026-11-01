import { z } from "zod";

/** Zod schemas for SMS administration. Kept out of "use server" files, which
 *  may only export async functions. */

export const providerSchema = z
  .object({
    name: z.string().trim().min(2, "نام سرویس‌دهنده الزامی است").max(60),
    apiUrl: z.string().trim().url("آدرس API معتبر نیست").max(500),
    apiKey: z.string().trim().max(300).default(""),
    senderNumber: z.string().trim().max(30).default(""),
    method: z.enum(["GET", "POST"]),
    bodyTemplate: z.string().trim().max(1000).default(""),
    successIndicator: z.string().trim().max(200).default(""),
    successPath: z.enum(["BODY_CONTAINS", "STATUS_2XX", "JSON_PATH"]),
    jsonPath: z.string().trim().max(200).optional().nullable(),
    authStyle: z.enum(["BEARER", "HEADER", "QUERY", "BODY", "NONE"]),
    authHeaderName: z.string().trim().max(60).optional().nullable(),
    requireTls: z.coerce.boolean().default(true),
    isActive: z.coerce.boolean().default(false),
  })
  .strict();

export const templateSchema = z.object({
  key: z.string().trim().min(2).max(60),
  title: z.string().trim().min(2, "عنوان الزامی است").max(120),
  body: z.string().trim().min(3, "متن قالب الزامی است").max(500),
  category: z.string().trim().max(40).default("CUSTOM"),
  isActive: z.coerce.boolean().default(true),
});

export const scheduleSchema = z
  .object({
    upcomingDaysBefore: z.coerce.number().int().min(0, "حداقل ۰ روز").max(30, "حداکثر ۳۰ روز").default(3),
    sendOnDueDate: z.coerce.boolean().default(true),
    overdueIntervalDays: z.coerce.number().int().min(0, "حداقل ۰ روز").max(60, "حداکثر ۶۰ روز").default(7),
    overdueMaxNotices: z.coerce.number().int().min(1, "حداقل ۱ بار").max(20, "حداکثر ۲۰ بار").default(4),
    runHour: z.coerce.number().int().min(0).max(23).default(9),
    isEnabled: z.coerce.boolean().default(true),
  })
  .strict();

export const testSmsSchema = z.object({
  phone: z.string().regex(/^09\d{9}$/, "شماره موبایل معتبر نیست"),
});
