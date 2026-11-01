import { updateStoreSettings } from "@/server/actions/admin";
import { readJson, requireAdmin, ok } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const body = await readJson(req);
  const res = await updateStoreSettings(body);
  return res.ok ? ok() : Response.json({ ok: false, error: res.error }, { status: 400 });
}
