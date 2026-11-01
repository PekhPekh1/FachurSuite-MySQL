import { cookies } from "next/headers";
import { REFRESH_COOKIE } from "@/lib/auth-constants";
import { clearAuthCookies, publicSessionUser, rotateRefreshToken, setAuthCookies } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { apiError, isTrustedOrigin, noStoreJson } from "@/lib/http-security";
import { logger } from "@/lib/logger";

export async function POST(req: Request) {
  if (!isTrustedOrigin(req)) return apiError("مبدأ درخواست مجاز نیست", 403);
  const raw = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (!raw) return apiError("توکن تازه‌سازی موجود نیست", 401);
  const rotated = await rotateRefreshToken(raw);
  if (!rotated) {
    await clearAuthCookies();
    logger.warn("auth refresh rejected");
    return apiError("توکن تازه‌سازی نامعتبر، منقضی یا قبلاً استفاده شده است", 401);
  }
  await setAuthCookies(rotated.pair);
  await logAction(rotated.user, "auth.refresh_rotated", "user", rotated.user.id);
  return noStoreJson({ ok: true, user: publicSessionUser(rotated.user) });
}
