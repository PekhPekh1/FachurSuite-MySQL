import { randomUUID } from "node:crypto";
import { and, asc, eq, lte, sql, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, installments, contracts, smsJobs, smsLogs, smsTemplates } from "@/db/schema";
import { logger } from "@/lib/logger";
import { renderTemplate } from "@/lib/format";
import { getSetting } from "@/lib/settings-server";
import {
  allowPrivateHosts,
  defaultProvider,
  sendViaProvider,
  validateProviderConfig,
  type SmsProviderConfig,
} from "@/lib/sms/provider";

export type SmsTemplateKey =
  | "upcoming_reminder"
  | "due_date_reminder"
  | "overdue_reminder"
  | "overdue_notice"
  | "contract_created"
  | "contract_canceled"
  | "payment_recorded"
  | "receipt_submitted"
  | "receipt_approved"
  | "receipt_rejected"
  | "custom_message";

export const PROVIDER_SETTINGS_KEY = "sms_provider";

/** Reads the provider configuration; the API key may be overridden by env. */
export async function getSmsProvider(): Promise<SmsProviderConfig> {
  const stored = await getSetting<Partial<SmsProviderConfig>>(PROVIDER_SETTINGS_KEY, defaultProvider);
  const config: SmsProviderConfig = { ...defaultProvider, ...stored };
  // Prefer the environment secret when present so credentials need not live in
  // the database.
  const envKey = process.env.SMS_API_KEY;
  if (envKey) config.apiKey = envKey;
  return config;
}

async function providerIsActive(): Promise<boolean> {
  const config = await getSmsProvider();
  return config.isActive && validateProviderConfig(config, allowPrivateHosts()).ok;
}

/* --------------------------------- Templates -------------------------------- */

export async function getTemplate(key: SmsTemplateKey) {
  const [row] = await db.select().from(smsTemplates).where(eq(smsTemplates.key, key)).limit(1);
  return row ?? null;
}

/** Sends a template message immediately (no scheduling). */
export async function sendTemplateSms(opts: {
  key: SmsTemplateKey;
  vars: Record<string, string | number>;
  phone: string;
  customerId?: string | null;
  fallback?: string;
}): Promise<"SENT" | "FAILED" | "SKIPPED" | "SIMULATED"> {
  let body = opts.fallback ?? "";
  try {
    const template = await getTemplate(opts.key);
    if (template?.isActive) body = renderTemplate(template.body, opts.vars);
  } catch (e) {
    logger.warn("sms template lookup failed", { key: opts.key, error: String(e) });
  }
  if (!body) return "SKIPPED";
  return sendSms({ customerId: opts.customerId, phone: opts.phone, body, templateKey: opts.key, vars: opts.vars });
}

/* ---------------------------------- Sending -------------------------------- */

export interface SmsLogInput {
  phone: string;
  body: string;
  status: string;
  detail?: string | null;
  templateKey?: string | null;
  vars?: Record<string, string | number> | null;
  customerId?: string | null;
}

/**
 * Sends one message. When an active, valid provider is configured the request
 * goes through the adapter; otherwise it is recorded as SIMULATED so the whole
 * flow stays testable without credentials. Every attempt is logged, and the API
 * key is never persisted or logged.
 */
export async function sendSms(opts: {
  customerId?: string | null;
  phone: string;
  body: string;
  templateKey?: string | null;
  vars?: Record<string, string | number> | null;
}): Promise<"SENT" | "FAILED" | "SIMULATED"> {
  const config = await getSmsProvider();
  let status: "SENT" | "FAILED" | "SIMULATED";
  let detail: string;

  if (config.isActive && validateProviderConfig(config, allowPrivateHosts()).ok) {
    const outcome = await sendViaProvider(config, opts.phone, opts.body, { timeoutMs: 8000, allowPrivate: allowPrivateHosts() });
    status = outcome.ok ? "SENT" : "FAILED";
    // Credentials are already redacted from the body by the adapter.
    detail = outcome.ok
      ? `HTTP ${outcome.status}`
      : `${outcome.error ?? "خطای ناشناخته"}${outcome.body ? ` | ${outcome.body.slice(0, 200)}` : ""}`;
    if (!outcome.ok) logger.warn("sms provider send failed", { templateKey: opts.templateKey, detail });
  } else {
    status = "SIMULATED";
    detail = "سرویس‌دهنده پیامک فعال یا معتبر نیست — ثبت شبیه‌سازی";
  }

  await db.insert(smsLogs).ignore()
      .values({
    customerId: opts.customerId ?? null,
    phone: opts.phone,
    body: opts.body,
    status,
    detail,
    templateKey: opts.templateKey ?? null,
    vars: opts.vars ?? null,
  });
  return status;
}

/* -------------------------------- Scheduling -------------------------------- */

/** Reminder schedule configuration, stored in settings["sms_schedule"]. */
export interface SmsScheduleSettings {
  /** Days before the due date to send an upcoming-payment reminder. */
  upcomingDaysBefore: number;
  /** Send a reminder on the due date itself. */
  sendOnDueDate: boolean;
  /** Recurring overdue notices: interval in days after the first overdue notice. */
  overdueIntervalDays: number;
  /** Maximum overdue notices per installment. */
  overdueMaxNotices: number;
  /** Hour of day (Tehran) at which the queue is processed. */
  runHour: number;
  isEnabled: boolean;
}

export const defaultSchedule: SmsScheduleSettings = {
  upcomingDaysBefore: 3,
  sendOnDueDate: true,
  overdueIntervalDays: 7,
  overdueMaxNotices: 4,
  runHour: 9,
  isEnabled: true,
};

export const getScheduleSettings = () =>
  getSetting<SmsScheduleSettings>("sms_schedule", defaultSchedule);

function tehranDayKey(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Tehran" }).format(d);
}

/**
 * Schedules a message. The dedupe key makes duplicate scheduling impossible:
 * a second insert for the same (template, installment, day) is silently ignored,
 * which also makes the operation idempotent across restarts.
 */
export async function scheduleSms(opts: {
  templateKey: SmsTemplateKey;
  phone: string;
  vars: Record<string, string | number>;
  scheduledFor: Date;
  customerId?: string | null;
  dedupeKey: string;
}): Promise<{ scheduled: boolean; id?: string }> {
  try {
    const rowId = randomUUID();
    // MySQL has no RETURNING; affectedRows tells us whether the row was actually
    // inserted (1) or skipped by the unique dedupe key (0).
    const result = await db
      .insert(smsJobs)
      .values({
        dedupeKey: opts.dedupeKey,
        templateKey: opts.templateKey,
        customerId: opts.customerId ?? null,
        phone: opts.phone,
        vars: opts.vars,
        scheduledFor: opts.scheduledFor,
        status: "PENDING",
        id: rowId,
      });
    const inserted = result[0].affectedRows === 1;
    return inserted ? { scheduled: true, id: rowId } : { scheduled: false };
  } catch (e) {
    logger.error("sms scheduling failed", { dedupeKey: opts.dedupeKey, error: String(e) });
    return { scheduled: false };
  }
}

/** Cancels pending jobs (e.g. when an installment is paid). */
export async function cancelPendingSms(dedupePrefixes: string[]) {
  if (dedupePrefixes.length === 0) return;
  await db
    .update(smsJobs)
    .set({ status: "CANCELLED" })
    .where(and(eq(smsJobs.status, "PENDING"), inArray(smsJobs.dedupeKey, dedupePrefixes)));
}

/**
 * Plans reminder jobs from current installment state. Safe to run repeatedly:
 * every job carries a stable dedupe key, so re-running after a restart schedules
 * nothing twice.
 */
export async function planReminders(now = new Date()): Promise<{ upcoming: number; dueDate: number; overdue: number }> {
  const schedule = await getScheduleSettings();
  if (!schedule.isEnabled) return { upcoming: 0, dueDate: 0, overdue: 0 };

  const today = tehranDayKey(now);
  const rows = await db
    .select({
      instId: installments.id,
      seq: installments.seq,
      dueDate: installments.dueDate,
      amount: installments.amount,
      status: installments.status,
      paidAt: installments.paidAt,
      penaltyForgiven: installments.penaltyForgiven,
      contractNo: contracts.contractNo,
      contractStatus: contracts.status,
      customerId: customers.id,
      customerName: customers.fullName,
      phone: customers.mobile,
    })
    .from(installments)
    .innerJoin(contracts, eq(contracts.id, installments.contractId))
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(and(eq(contracts.status, "ACTIVE"), eq(installments.status, "PENDING")));

  let upcoming = 0;
  let dueDate = 0;
  let overdue = 0;
  const dayMs = 86_400_000;
  const todayTime = Date.parse(`${today}T00:00:00Z`);

  for (const r of rows) {
    if (r.paidAt) continue;
    const dueTime = Date.parse(`${r.dueDate}T00:00:00Z`);
    const diffDays = Math.round((dueTime - todayTime) / dayMs);
    const base = {
      customer: r.customerName,
      contractNo: r.contractNo,
      seq: r.seq,
      amount: r.amount.toLocaleString("en-US"),
      dueDate: r.dueDate.replace(/-/g, "/"),
      daysLate: Math.max(0, -diffDays),
    };

    // Upcoming reminder, N days before the due date.
    if (diffDays > 0 && diffDays <= schedule.upcomingDaysBefore) {
      const res = await scheduleSms({
        templateKey: "upcoming_reminder",
        phone: r.phone,
        vars: base,
        customerId: r.customerId,
        scheduledFor: now,
        dedupeKey: `upcoming:${r.instId}:${today}`,
      });
      if (res.scheduled) upcoming += 1;
    }

    // Reminder on the due date itself.
    if (diffDays === 0 && schedule.sendOnDueDate) {
      const res = await scheduleSms({
        templateKey: "due_date_reminder",
        phone: r.phone,
        vars: base,
        customerId: r.customerId,
        scheduledFor: now,
        dedupeKey: `duedate:${r.instId}:${today}`,
      });
      if (res.scheduled) dueDate += 1;
    }

    // Recurring overdue notice, respecting the interval and the maximum count.
    if (diffDays < 0 && schedule.overdueIntervalDays > 0) {
      const daysLate = -diffDays;
      if (daysLate % schedule.overdueIntervalDays === 0) {
        const already = await db
          .select({ n: sql<string>`count(*)` })
          .from(smsJobs)
          .where(and(eq(smsJobs.templateKey, "overdue_notice"), eq(smsJobs.phone, r.phone), sql`${smsJobs.vars}->>'contractNo' = ${r.contractNo}`, sql`${smsJobs.vars}->>'seq' = ${String(r.seq)}`));
        const sent = Number(already[0]?.n ?? 0);
        if (sent < schedule.overdueMaxNotices) {
          const res = await scheduleSms({
            templateKey: "overdue_notice",
            phone: r.phone,
            vars: base,
            customerId: r.customerId,
            scheduledFor: now,
            dedupeKey: `overdue:${r.instId}:${today}`,
          });
          if (res.scheduled) overdue += 1;
        }
      }
    }
  }

  return { upcoming, dueDate, overdue };
}

/** Number of overdue notices already scheduled for an installment. */
export async function overdueNoticeCount(contractNo: string, seq: number, phone: string): Promise<number> {
  const rows = await db
    .select({ n: sql<string>`count(*)` })
    .from(smsJobs)
    .where(and(eq(smsJobs.templateKey, "overdue_notice"), eq(smsJobs.phone, phone), sql`${smsJobs.vars}->>'contractNo' = ${contractNo}`, sql`${smsJobs.vars}->>'seq' = ${String(seq)}`));
  return Number(rows[0]?.n ?? 0);
}

const MAX_ATTEMPTS = 3;

/**
 * Processes due jobs. Rows are claimed with a guarded UPDATE so concurrent
 * invocations (or overlapping cron ticks) cannot send the same message twice.
 */
export async function processSmsQueue(now = new Date(), limit = 50): Promise<{ processed: number; sent: number; failed: number }> {
  const due = await db
    .select()
    .from(smsJobs)
    .where(and(eq(smsJobs.status, "PENDING"), lte(smsJobs.scheduledFor, now)))
    .orderBy(asc(smsJobs.scheduledFor))
    .limit(limit);

  let sent = 0;
  let failed = 0;
  let processed = 0;

  for (const job of due) {
    // Claim the row atomically; skip if another worker already took it.
    const claimed = await db
      .update(smsJobs)
      .set({ status: "SENDING", attempts: sql`${smsJobs.attempts} + 1`, lastAttemptAt: now })
      .where(and(eq(smsJobs.id, job.id), eq(smsJobs.status, "PENDING")));
    if (claimed[0].affectedRows === 0) continue;
    processed += 1;

    let body = "";
    try {
      const template = await getTemplate(job.templateKey as SmsTemplateKey);
      if (template?.isActive) body = renderTemplate(template.body, job.vars ?? {});
    } catch {
      /* fall through to no body */
    }

    const result = body
      ? await sendSms({ customerId: job.customerId, phone: job.phone, body, templateKey: job.templateKey, vars: job.vars })
      : "SKIPPED";

    if (result === "SENT" || result === "SIMULATED") {
      sent += 1;
      await db
        .update(smsJobs)
        .set({ status: "SENT", lastError: null })
        .where(eq(smsJobs.id, job.id));
    } else if (result === "SKIPPED") {
      // Template disabled or missing: nothing to send.
      await db.update(smsJobs).set({ status: "CANCELLED", lastError: "قالب غیرفعال است" }).where(eq(smsJobs.id, job.id));
    } else {
      failed += 1;
      const attempts = job.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS;
      // Exponential backoff: 5m, 20m, then give up.
      const backoffMs = 5 * 60_000 * Math.pow(4, attempts - 1);
      await db
        .update(smsJobs)
        .set({
          status: giveUp ? "FAILED" : "PENDING",
          lastError: "ارسال ناموفق",
          ...(giveUp ? {} : { scheduledFor: new Date(now.getTime() + backoffMs) }),
        })
        .where(eq(smsJobs.id, job.id));
    }
  }

  return { processed, sent, failed };
}

export async function smsProviderIsConfigured(): Promise<boolean> {
  return providerIsActive();
}
