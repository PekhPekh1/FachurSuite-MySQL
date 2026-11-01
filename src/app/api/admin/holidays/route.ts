import { addHoliday } from "@/server/actions/admin";
import { readJson, requireAdmin, ok } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const res = await addHoliday(await readJson(req));
  return res.ok ? ok() : Response.json({ ok: false, error: res.error, duplicate: Boolean(res.duplicate) }, { status: res.duplicate ? 409 : 400 });
}
