import crypto from "crypto";
import type { Role } from "@/lib/auth";

export const ACCESS_TOKEN_TTL_SECONDS = Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 15 * 60);
const ISSUER = "installments-auth";
const AUDIENCE = "installments-app";

export interface AccessClaims {
  sub: string;
  role: Role;
  customerId: string | null;
  sessionVersion: number;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  aud: string;
}

let devSecretWarned = false;
let cachedDevSecret: string | null = null;

/**
 * Production REQUIRES a strong JWT_ACCESS_SECRET and fails closed without one.
 * Outside production a stable per-environment secret is derived so local/dev
 * previews work; it is never used when NODE_ENV=production.
 */
function secret(): string {
  const value = process.env.JWT_ACCESS_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_ACCESS_SECRET must be set to at least 32 characters in production");
  }
  if (!cachedDevSecret) {
    cachedDevSecret = crypto
      .createHash("sha256")
      .update(`dev-only:${process.env.DATABASE_URL ?? "local"}`)
      .digest("hex");
    if (!devSecretWarned) {
      devSecretWarned = true;
      console.warn("[auth] JWT_ACCESS_SECRET is not set — using a derived development secret. Set it before deploying.");
    }
  }
  return cachedDevSecret;
}

const encode = (input: string | Buffer) => Buffer.from(input).toString("base64url");

/** Standards-compatible HS256 JWT. No token is ever written to logs or DB. */
export function signAccessToken(
  user: { id: string; role: Role; customerId: string | null; sessionVersion: number },
  now = Date.now(),
): string {
  const iat = Math.floor(now / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const payload: AccessClaims = {
    sub: user.id,
    role: user.role,
    customerId: user.customerId,
    sessionVersion: user.sessionVersion,
    iat,
    exp: iat + ACCESS_TOKEN_TTL_SECONDS,
    jti: crypto.randomUUID(),
    iss: ISSUER,
    aud: AUDIENCE,
  };
  const body = `${header}.${encode(JSON.stringify(payload))}`;
  const signature = crypto.createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

export function verifyAccessToken(token: string, now = Date.now()): AccessClaims | null {
  try {
    const [header, payload, supplied, extra] = token.split(".");
    if (!header || !payload || !supplied || extra) return null;
    const parsedHeader = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string; typ?: string };
    if (parsedHeader.alg !== "HS256" || parsedHeader.typ !== "JWT") return null;
    const expected = crypto.createHmac("sha256", secret()).update(`${header}.${payload}`).digest();
    const got = Buffer.from(supplied, "base64url");
    if (got.length !== expected.length || !crypto.timingSafeEqual(got, expected)) return null;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as AccessClaims;
    if (!claims.sub || !claims.jti || claims.iss !== ISSUER || claims.aud !== AUDIENCE) return null;
    if (!Number.isInteger(claims.sessionVersion) || claims.sessionVersion < 0) return null;
    if (!Number.isInteger(claims.exp) || claims.exp <= Math.floor(now / 1000)) return null;
    if (!(["ADMIN", "OPERATOR", "CUSTOMER"] as string[]).includes(claims.role)) return null;
    return claims;
  } catch {
    return null;
  }
}
