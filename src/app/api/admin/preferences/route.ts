import { updateMyPreferences } from "@/server/actions/admin";
import { readJson, ok } from "@/lib/admin-api";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http-security";

export const dynamic = "force-dynamic";

/** Any authenticated user may change their own appearance preferences. */
export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return apiError("نشست معتبر نیست", 401);
  const res = await updateMyPreferences(await readJson(req));
  return res.ok ? ok() : Response.json({ ok: false, error: res.error }, { status: 400 });
}
