import { createUser } from "@/server/actions/admin";
import { readJson, requireAdmin, ok } from "@/lib/admin-api";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const guard = await requireAdmin();
  if ("error" in guard) return guard.error;
  const body = await readJson(req);
  const res = await createUser(body);
  return res.ok ? Response.json({ ok: true }, { status: 201 }) : Response.json({ ok: false, error: res.error, duplicate: Boolean(res.duplicate) }, { status: res.duplicate ? 409 : 400 });
}
