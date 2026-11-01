import { cookies } from "next/headers";
import { REFRESH_COOKIE } from "@/lib/auth-constants";
import { clearAuthCookies, destroySession, getSessionUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";
import { apiError, isTrustedOrigin, noStoreJson } from "@/lib/http-security";

export async function POST(req: Request) {
  if (!isTrustedOrigin(req)) return apiError("مبدأ درخواست مجاز نیست", 403);
  const user = await getSessionUser();
  const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  if (refresh) await destroySession(refresh);
  await clearAuthCookies();
  if (user) await logAction(user, "auth.logout", "user", user.id);
  return noStoreJson({ ok: true });
}
