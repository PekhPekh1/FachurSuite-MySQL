import { getAccessUser, publicSessionUser } from "@/lib/auth";
import { apiError, noStoreJson } from "@/lib/http-security";

export async function GET() {
  const user = await getAccessUser();
  if (!user) return apiError("توکن دسترسی نامعتبر یا منقضی است", 401);
  return noStoreJson({ ok: true, user: publicSessionUser(user) });
}
