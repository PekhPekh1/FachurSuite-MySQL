import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const startedAt = Date.now();

export async function GET() {
  try {
    await db.execute(sql`select 1`);
    return Response.json({
      ok: true,
      db: true,
      service: "installments-web",
      uptimeSec: Math.round((Date.now() - startedAt) / 1000),
    });
  } catch {
    return Response.json({ ok: false, db: false, service: "installments-web" }, { status: 500 });
  }
}
