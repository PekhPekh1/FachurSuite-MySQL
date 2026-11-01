import { NextResponse } from "next/server";

/** CSRF defense for cookie-authenticated state changes. Non-browser clients may omit Origin. */
export function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return true;
  try {
    const expected = new URL(req.url).origin;
    const configured = (process.env.CORS_ORIGIN ?? "").split(",").map((v) => v.trim()).filter(Boolean);
    return origin === expected || configured.includes(origin);
  } catch {
    return false;
  }
}

export const apiError = (error: string, status: number) =>
  NextResponse.json({ ok: false, error }, { status, headers: { "Cache-Control": "no-store" } });

export const noStoreJson = (body: unknown, status = 200) =>
  NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
