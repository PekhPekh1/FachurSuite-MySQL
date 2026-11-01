import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http-security";

/** Shared ADMIN guard for the settings/user administration endpoints. */
export async function requireAdmin() {
  const user = await getSessionUser();
  if (!user) return { error: apiError("نشست معتبر نیست", 401) } as const;
  if (user.role !== "ADMIN") return { error: apiError("شما مجوز انجام این عملیات را ندارید", 403) } as const;
  return { user } as const;
}

export async function readJson(req: Request) {
  return req.json().catch(() => ({}));
}

export function ok(extra: Record<string, unknown> = {}) {
  return NextResponse.json({ ok: true, ...extra });
}
