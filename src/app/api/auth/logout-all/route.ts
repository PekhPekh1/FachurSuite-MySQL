import { clearAuthCookies, getAccessUser, revokeAllUserTokens } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { apiError, isTrustedOrigin, noStoreJson } from "@/lib/http-security";

export async function POST(req: Request) {
  if (!isTrustedOrigin(req)) return apiError("مبدأ درخواست مجاز نیست", 403);
  const user = await getAccessUser();
  if (!user) return apiError("توکن دسترسی نامعتبر یا منقضی است", 401);
  await revokeAllUserTokens(user.id);
  await clearAuthCookies();
  await logAction(user, "auth.logout_all", "user", user.id);
  return noStoreJson({ ok: true });
}
