import { eq } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schema";
import { changePasswordSchema } from "@/lib/validators";
import {
  createAuthSession,
  getAccessUser,
  hashPassword,
  revokeAllUserTokens,
  setAuthCookies,
  verifyPassword,
} from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { apiError, isTrustedOrigin, noStoreJson } from "@/lib/http-security";

export async function PATCH(req: Request) {
  if (!isTrustedOrigin(req)) return apiError("مبدأ درخواست مجاز نیست", 403);
  const user = await getAccessUser();
  if (!user) return apiError("توکن دسترسی نامعتبر یا منقضی است", 401);
  const raw = await req.json().catch(() => null);
  const parsed = changePasswordSchema.safeParse(raw);
  if (!parsed.success) return apiError(parsed.error.issues[0]?.message ?? "ورودی نامعتبر است", 400);
  const [record] = await db.select({ passwordHash: users.passwordHash }).from(users).where(eq(users.id, user.id)).limit(1);
  if (!record || !(await verifyPassword(parsed.data.currentPassword, record.passwordHash))) {
    await logAction(user, "auth.password_change_failed", "user", user.id, { reason: "incorrect_current_password" });
    return apiError("رمز عبور فعلی صحیح نیست", 400);
  }
  await db.update(users).set({ passwordHash: await hashPassword(parsed.data.newPassword) }).where(eq(users.id, user.id));
  await revokeAllUserTokens(user.id);
  await setAuthCookies(await createAuthSession(user));
  await logAction(user, "auth.password_changed", "user", user.id);
  return noStoreJson({ ok: true });
}
