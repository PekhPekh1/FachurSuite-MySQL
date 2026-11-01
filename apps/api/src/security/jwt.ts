import crypto from "node:crypto";
import type { UserRole } from "@prisma/client";

const ISSUER = "installments-auth";
const AUDIENCE = "installments-app";
export const accessTtlSeconds = () => Number(process.env.ACCESS_TOKEN_TTL_SECONDS ?? 900);

export interface AccessClaims {
  sub: string;
  role: UserRole;
  customerId: string | null;
  sessionVersion: number;
  iat: number;
  exp: number;
  jti: string;
  iss: string;
  aud: string;
}

let cachedDevSecret: string | null = null;

/** Fails closed in production; derives a stable dev secret otherwise. */
function secret() {
  const value = process.env.JWT_ACCESS_SECRET;
  if (value && value.length >= 32) return value;
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_ACCESS_SECRET must be set to at least 32 characters in production");
  }
  if (!cachedDevSecret) {
    cachedDevSecret = crypto.createHash("sha256").update(`dev-only:${process.env.DATABASE_URL ?? "local"}`).digest("hex");
    console.warn("[auth] JWT_ACCESS_SECRET is not set — using a derived development secret.");
  }
  return cachedDevSecret;
}

const encode = (input: string | Buffer) => Buffer.from(input).toString("base64url");

export function signAccessToken(
  user: { id: string; role: UserRole; customerId: string | null; sessionVersion: number },
  now = Date.now(),
) {
  const iat = Math.floor(now / 1000);
  const header = encode(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const claims: AccessClaims = {
    sub: user.id,
    role: user.role,
    customerId: user.customerId,
    sessionVersion: user.sessionVersion,
    iat,
    exp: iat + accessTtlSeconds(),
    jti: crypto.randomUUID(),
    iss: ISSUER,
    aud: AUDIENCE,
  };
  const body = `${header}.${encode(JSON.stringify(claims))}`;
  return `${body}.${crypto.createHmac("sha256", secret()).update(body).digest("base64url")}`;
}

export function verifyAccessToken(token: string, now = Date.now()): AccessClaims | null {
  try {
    const [header, payload, signature, extra] = token.split(".");
    if (!header || !payload || !signature || extra) return null;
    const h = JSON.parse(Buffer.from(header, "base64url").toString("utf8")) as { alg?: string; typ?: string };
    if (h.alg !== "HS256" || h.typ !== "JWT") return null;
    const expected = crypto.createHmac("sha256", secret()).update(`${header}.${payload}`).digest();
    const supplied = Buffer.from(signature, "base64url");
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return null;
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
