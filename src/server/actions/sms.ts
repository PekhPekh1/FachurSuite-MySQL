"use server";

import { asc, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/db";
import { smsJobs, smsTemplates } from "@/db/schema";
import { requireActionUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { getScheduleSettings, planReminders, processSmsQueue, getSmsProvider, sendTemplateSms } from "@/lib/sms";
import { allowPrivateHosts, validateProviderConfig, type SmsProviderConfig } from "@/lib/sms/provider";
import { providerSchema, scheduleSchema, templateSchema, testSmsSchema } from "@/server/schemas/sms";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "خطای غیرمنتظره رخ داد" });

/* ------------------------------ Provider config ----------------------------- */


export async function updateSmsProvider(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const parsed = providerSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است" };

    const config = parsed.data as SmsProviderConfig;
    // An active provider must pass validation before it can be saved.
    const validation = validateProviderConfig(config, allowPrivateHosts());
    if (config.isActive && !validation.ok) return { ok: false, error: validation.error ?? "تنظیمات سرویس‌دهنده نامعتبر است" };

    const { settings } = await import("@/db/schema");
    const value = { ...config, jsonPath: config.jsonPath || null, authHeaderName: config.authHeaderName || null };
    await db
      .insert(settings)
      .values({ key: "sms_provider", value, updatedBy: actor.id, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value, updatedBy: actor.id, updatedAt: new Date() } });

    // Never record the API key in the audit log.
    await logAction(actor, "settings.sms_provider.update", "settings", "sms_provider", {
      name: config.name,
      apiUrl: config.apiUrl,
      method: config.method,
      successPath: config.successPath,
      isActive: config.isActive,
      keyLength: (config.apiKey ?? "").length,
    });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Sends a test message to a staff-supplied Iranian mobile number. */
export async function testSmsProvider(raw: unknown): Promise<Result<{ status: string }>> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const { phone } = testSmsSchema.parse(raw);
    const config = await getSmsProvider();
    const validation = validateProviderConfig(config, allowPrivateHosts());
    if (config.isActive && !validation.ok) return { ok: false, error: validation.error ?? "تنظیمات سرویس‌دهنده نامعتبر است" };

    const status = await sendTemplateSms({
      key: "custom_message",
      vars: { customer: actor.fullName, message: "این یک پیامک آزمایشی از سامانه FachurSuite است." },
      phone,
      fallback: `${actor.fullName} گرامی، این یک پیامک آزمایشی از سامانه FachurSuite است.`,
    });
    await logAction(actor, "settings.sms_provider.test", "settings", "sms_provider", { status });
    return { ok: true, data: { status } };
  } catch (e) {
    return fail(e);
  }
}

/* --------------------------------- Templates -------------------------------- */

export async function updateSmsTemplate(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const v = templateSchema.parse(raw);
    const placeholders = [...v.body.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
    const allowed = new Set(["customer", "contractNo", "seq", "amount", "dueDate", "daysLate", "message", "reason"]);
    const invalid = placeholders.filter((p) => !allowed.has(p));
    if (invalid.length > 0) return { ok: false, error: `متغیر ناشناخته: ${invalid.join("، ")}` };

    await db
      .insert(smsTemplates)
      .values({ key: v.key, title: v.title, body: v.body, category: v.category, isActive: v.isActive, updatedAt: new Date() })
      .onDuplicateKeyUpdate({
        set: { title: v.title, body: v.body, category: v.category, isActive: v.isActive, updatedAt: new Date() },
      });
    await logAction(actor, "settings.sms_template.update", "sms_template", v.key, { placeholders });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* -------------------------------- Scheduling -------------------------------- */


export async function updateSmsSchedule(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const v = scheduleSchema.parse(raw);
    const { settings } = await import("@/db/schema");
    await db
      .insert(settings)
      .values({ key: "sms_schedule", value: v, updatedBy: actor.id, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value: v, updatedBy: actor.id, updatedAt: new Date() } });
    await logAction(actor, "settings.sms_schedule.update", "settings", "sms_schedule", v);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Runs the planner and immediately drains the queue (manual trigger). */
export async function runReminderCycle(): Promise<
  Result<{ planned: { upcoming: number; dueDate: number; overdue: number }; processed: number; sent: number; failed: number }>
> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    const planned = await planReminders();
    const processed = await processSmsQueue();
    await logAction(actor, "sms.reminder_cycle", "system", null, { ...planned, ...processed });
    revalidatePath("/settings");
    return { ok: true, data: { planned, ...processed } };
  } catch (e) {
    return fail(e);
  }
}

/** Cancels a pending job. */
export async function cancelSmsJob(jobId: string): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    await db.update(smsJobs).set({ status: "CANCELLED" }).where(eq(smsJobs.id, jobId));
    await logAction(actor, "sms.job.cancel", "sms_job", jobId);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Lists scheduled jobs for the settings screen. */
export async function listSmsJobs(limit = 50) {
  return db.select().from(smsJobs).orderBy(asc(smsJobs.scheduledFor)).limit(limit);
}

export async function listSmsTemplates() {
  return db.select().from(smsTemplates).orderBy(asc(smsTemplates.key));
}

export async function readScheduleSettings() {
  return getScheduleSettings();
}
