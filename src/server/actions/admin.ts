"use server";

import { and, asc, desc, eq, ne, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { backupHistory, customers, holidays, refreshTokens, settings, users } from "@/db/schema";
import { hashPassword, requireActionUser, revokeAllUserTokens, type SessionUser } from "@/lib/auth";
import {
  bankAccountsSettingsSchema,
  financeSettingsSchema,
  passwordResetSchema,
  storeSettingsSchema,
  userCreateSchema,
  userPreferencesSchema,
  userUpdateSchema,
} from "@/lib/validators";
import { logAction } from "@/lib/audit";
import { logger } from "@/lib/logger";
import { z } from "zod";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string; duplicate?: boolean };
const fail = (e: unknown): Result => ({ ok: false, error: "خطای غیرمنتظره رخ داد" });
/** Detects a PostgreSQL unique-violation, including Drizzle's wrapped errors. */
function isUnique(e: unknown): boolean {
  let cur: unknown = e;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (code === "23505" || code === "P2002") return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** The final active administrator can never be removed or demoted. */
async function activeAdminCount(): Promise<number> {
  const rows = await db.select({ n: sql<string>`count(*)` }).from(users).where(and(eq(users.role, "ADMIN"), eq(users.isActive, true)));
  return Number(rows[0]?.n ?? 0);
}

async function assertNotLastAdmin(targetUserId: string): Promise<Result | null> {
  const [target] = await db.select({ role: users.role, isActive: users.isActive }).from(users).where(eq(users.id, targetUserId)).limit(1);
  if (!target) return { ok: false, error: "کاربر یافت نشد" };
  // Only a guard when the change would remove an active administrator.
  if (target.role !== "ADMIN" || !target.isActive) return null;
  if ((await activeAdminCount()) <= 1) {
    return { ok: false, error: "آخرین مدیر فعال سیستم است؛ امکان حذف یا غیرفعال‌سازی وجود ندارد" };
  }
  return null;
}

/* ------------------------------- User management ------------------------------ */

export async function createUser(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = userCreateSchema.parse(raw);
    await db.insert(users).values({
      username: v.username,
      passwordHash: await hashPassword(v.password),
      fullName: v.fullName,
      role: v.role,
      customerId: v.role === "CUSTOMER" ? v.customerId! : null,
      canReviewPayments: v.role === "OPERATOR" ? v.canReviewPayments : false,
    });
    await logAction(u, "user.create", "user", v.username, { role: v.role });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: "این نام کاربری قبلاً استفاده شده است", duplicate: true };
    return fail(e);
  }
}

export async function updateUser(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const v = userUpdateSchema.parse(raw);
    const guard = await assertNotLastAdmin(v.userId);
    if (guard) return guard;

    await db
      .update(users)
      .set({
        fullName: v.fullName,
        role: v.role,
        customerId: v.role === "CUSTOMER" ? v.customerId ?? null : null,
        canReviewPayments: v.role === "OPERATOR" ? v.canReviewPayments : false,
      })
      .where(eq(users.id, v.userId));
    // Role changes invalidate existing access tokens so permissions apply immediately.
    await revokeAllUserTokens(v.userId);
    await logAction(actor, "user.update", "user", v.userId, { role: v.role, fullName: v.fullName });
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setUserActive(userId: string, active: boolean): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    if (u.id === userId) return { ok: false, error: "نمی‌توانید حساب خودتان را غیرفعال کنید" };
    const guard = await assertNotLastAdmin(userId);
    if (!active && guard) return guard;

    await db.update(users).set({ isActive: active }).where(eq(users.id, userId));
    if (!active) await revokeAllUserTokens(userId); // instant session revocation
    await logAction(u, active ? "user.activate" : "user.deactivate", "user", userId);
    revalidatePath("/users");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function resetUserPassword(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = passwordResetSchema.parse(raw);
    await db.update(users).set({ passwordHash: await hashPassword(v.password) }).where(eq(users.id, v.userId));
    await revokeAllUserTokens(v.userId);
    await logAction(u, "user.reset_password", "user", v.userId, { sessionsRevoked: true });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Users may change their own appearance preferences. */
export async function updateMyPreferences(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser();
    const v = userPreferencesSchema.parse(raw);
    await db
      .update(users)
      .set({ prefTheme: v.theme, prefPalette: v.palette, prefFaDigits: v.faDigits })
      .where(eq(users.id, actor.id));
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** ADMIN-only listing; never exposes password hashes. */
export async function listUsersSafe() {
  await requireActionUser(["ADMIN"]);
  return db
    .select({
      id: users.id, username: users.username, fullName: users.fullName, role: users.role,
      customerId: users.customerId, canReviewPayments: users.canReviewPayments,
      isActive: users.isActive, createdAt: users.createdAt,
      prefTheme: users.prefTheme, prefPalette: users.prefPalette, prefFaDigits: users.prefFaDigits,
    })
    .from(users)
    .orderBy(asc(users.createdAt));
}

/* ---------------------------------- Settings ---------------------------------- */

export async function updateStoreSettings(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = storeSettingsSchema.parse(raw);
    await db
      .insert(settings)
      .values({ key: "store", value: v, updatedBy: u.id, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value: v, updatedBy: u.id, updatedAt: new Date() } });
    await logAction(u, "settings.store.update", "settings", "store", { storeName: v.storeName });
    revalidatePath("/", "layout");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function updateFinanceSettings(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = financeSettingsSchema.parse(raw);
    await db
      .insert(settings)
      .values({ key: "finance", value: v, updatedBy: u.id, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value: v, updatedBy: u.id, updatedAt: new Date() } });
    await logAction(u, "settings.finance.update", "settings", "finance", v);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Store bank cards customers can transfer to. */
export async function updateBankAccounts(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = bankAccountsSettingsSchema.parse(raw);
    await db
      .insert(settings)
      .values({ key: "bank_accounts", value: v, updatedBy: u.id, updatedAt: new Date() })
      .onDuplicateKeyUpdate({ set: { value: v, updatedBy: u.id, updatedAt: new Date() } });
    await logAction(u, "settings.bank_accounts.update", "settings", "bank_accounts", { count: v.accounts.length });
    revalidatePath("/settings");
    revalidatePath("/portal");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/* ------------------------------ Holiday management ----------------------------- */

const holidaySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است"),
  title: z.string().trim().min(2, "عنوان مناسبت الزامی است").max(120),
});

export async function addHoliday(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = holidaySchema.parse(raw);
    await db.insert(holidays).values({ date: v.date, title: v.title });
    await logAction(u, "settings.holiday.create", "holiday", v.date, { title: v.title });
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: "این تاریخ قبلاً ثبت شده است", duplicate: true };
    return fail(e);
  }
}

export async function deleteHoliday(date: string): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    await db.delete(holidays).where(eq(holidays.date, date));
    await logAction(u, "settings.holiday.delete", "holiday", date);
    revalidatePath("/settings");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function listHolidays() {
  await requireActionUser(["ADMIN", "OPERATOR"]);
  return db.select().from(holidays).orderBy(asc(holidays.date));
}

/* ----------------------------------- Backup ----------------------------------- */

export async function listBackupHistory(): Promise<
  { id: string; fileName: string; sizeBytes: number; tableCount: number; status: string; detail: string | null; takenByName: string | null; createdAt: Date }[]
> {
  await requireActionUser(["ADMIN"]);
  return db
    .select({
      id: backupHistory.id, fileName: backupHistory.fileName, sizeBytes: backupHistory.sizeBytes,
      tableCount: backupHistory.tableCount, status: backupHistory.status, detail: backupHistory.detail,
      takenByName: backupHistory.takenByName, createdAt: backupHistory.createdAt,
    })
    .from(backupHistory)
    .orderBy(desc(backupHistory.createdAt))
    .limit(25);
}

/** Records a completed backup in the history table. */
export async function recordBackup(entry: {
  fileName: string; sizeBytes: number; tableCount: number; tableCounts: Record<string, number>;
  actor: SessionUser;
}): Promise<Result> {
  try {
    await db.insert(backupHistory).values({
      fileName: entry.fileName,
      sizeBytes: entry.sizeBytes,
      tableCount: entry.tableCount,
      tableCounts: entry.tableCounts,
      status: "COMPLETED",
      takenBy: entry.actor.id,
      takenByName: entry.actor.fullName,
    });
    await logAction(entry.actor, "backup.download", "system", null, {
      fileName: entry.fileName,
      sizeBytes: entry.sizeBytes,
      tableCount: entry.tableCount,
    });
    logger.info("backup recorded", { fileName: entry.fileName, sizeBytes: entry.sizeBytes });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

void refreshTokens;
void customers;
void ne;
