"use server";

import { cookies, headers } from "next/headers";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import {
  clearAuthCookies,
  createAuthSession,
  destroySession,
  getSessionUser,
  hashPassword,
  loginFailed,
  loginSucceeded,
  loginThrottle,
  revokeAllUserTokens,
  setAuthCookies,
  verifyPassword,
  type Role,
} from "@/lib/auth";
import { REFRESH_COOKIE } from "@/lib/auth-constants";
import { changePasswordSchema, loginSchema } from "@/lib/validators";
import { logAction } from "@/lib/audit";
import { logger } from "@/lib/logger";

export type LoginResult = { ok: true; role: Role } | { ok: false; error: string };
export type AuthResult = { ok: true } | { ok: false; error: string };

async function requestMeta() {
  const h = await headers();
  return {
    ip: (h.get("x-forwarded-for")?.split(",")[0] ?? "unknown").slice(0, 64),
    userAgent: (h.get("user-agent") ?? "unknown").slice(0, 180),
  };
}

export async function login(raw: unknown): Promise<LoginResult> {
  const parsed = loginSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است" };
  const { username, password } = parsed.data;
  const meta = await requestMeta();

  const throttled = loginThrottle(`${username}:${meta.ip}`);
  if (throttled) {
    logger.warn("auth login throttled", { username, ip: meta.ip });
    await logAction(null, "auth.login_throttled", "user", username, meta);
    return { ok: false, error: throttled };
  }

  const [user] = await db.select().from(users).where(eq(users.username, username)).limit(1);
  const valid = user ? await verifyPassword(password, user.passwordHash) : false;
  if (!user || !valid) {
    loginFailed(`${username}:${meta.ip}`);
    logger.warn("auth login failed", { username, ip: meta.ip });
    await logAction(null, "auth.login_failed", "user", username, { ...meta, reason: "invalid_credentials" });
    return { ok: false, error: "نام کاربری یا رمز عبور اشتباه است" };
  }
  if (!user.isActive) {
    logger.warn("auth disabled account login", { userId: user.id, ip: meta.ip });
    await logAction({ id: user.id, fullName: user.fullName, role: user.role }, "auth.login_blocked", "user", user.id, {
      ...meta,
      reason: "account_disabled",
    });
    return { ok: false, error: "حساب کاربری شما غیرفعال است؛ با مدیر سیستم تماس بگیرید" };
  }

  const sessionUser = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    role: user.role,
    customerId: user.customerId,
    canReviewPayments: user.canReviewPayments,
    sessionVersion: user.sessionVersion,
  };
  loginSucceeded(`${username}:${meta.ip}`);
  await setAuthCookies(await createAuthSession(sessionUser));
  await logAction(sessionUser, "auth.login", "user", user.id, meta);
  logger.info("auth login success", { userId: user.id, role: user.role, ip: meta.ip });
  return { ok: true, role: user.role };
}

export async function logout(): Promise<AuthResult> {
  const user = await getSessionUser();
  const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refresh) await destroySession(refresh);
  await clearAuthCookies();
  if (user) await logAction(user, "auth.logout", "user", user.id, await requestMeta());
  return { ok: true };
}

export async function logoutAllDevices(): Promise<AuthResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "نشست کاربری معتبر نیست" };
  await revokeAllUserTokens(user.id);
  await clearAuthCookies();
  await logAction(user, "auth.logout_all", "user", user.id, await requestMeta());
  logger.info("auth all sessions revoked", { userId: user.id });
  return { ok: true };
}

export async function changePassword(raw: unknown): Promise<AuthResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "نشست کاربری معتبر نیست" };
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "ورودی نامعتبر است" };

  const [record] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!record || !(await verifyPassword(parsed.data.currentPassword, record.passwordHash))) {
    await logAction(user, "auth.password_change_failed", "user", user.id, {
      ...(await requestMeta()),
      reason: "incorrect_current_password",
    });
    return { ok: false, error: "رمز عبور فعلی صحیح نیست" };
  }

  await db.transaction(async (tx) => {
    await tx.update(users).set({ passwordHash: await hashPassword(parsed.data.newPassword) }).where(eq(users.id, user.id));
  });
  // Invalidate every device, then issue a fresh pair only to this browser.
  const nextUser = await revokeAllUserTokens(user.id);
  if (!nextUser) return { ok: false, error: "حساب کاربری غیرفعال است" };
  await setAuthCookies(await createAuthSession(nextUser));
  await logAction(user, "auth.password_changed", "user", user.id, await requestMeta());
  logger.info("auth password changed", { userId: user.id });
  return { ok: true };
}
