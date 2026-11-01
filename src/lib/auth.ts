import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import crypto from "crypto";
import { and, eq, gt, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { refreshTokens, users } from "@/db/schema";
import { ACCESS_COOKIE, REFRESH_COOKIE } from "@/lib/auth-constants";
import { ACCESS_TOKEN_TTL_SECONDS, signAccessToken, verifyAccessToken } from "@/lib/jwt";
export { hashPassword, verifyPassword } from "@/lib/password";
import { hashPassword, verifyPassword } from "@/lib/password";

export type Role = "ADMIN" | "OPERATOR" | "CUSTOMER";

export interface SessionUser {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  customerId: string | null;
  canReviewPayments: boolean;
  /** Internal access-token invalidation counter; never expose publicly. */
  sessionVersion: number;
}

export interface TokenPair {
  accessToken: string;
  accessExpiresAt: Date;
  refreshToken: string;
  refreshExpiresAt: Date;
}

const REFRESH_TTL_DAYS = Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);

/** Only the SHA-256 digest is persisted — raw refresh tokens never touch the DB. */
export const hashToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

/* ------------------------------- Credentials ------------------------------- */

function toSessionUser(row: {
  id: string;
  username: string;
  fullName: string;
  role: Role;
  customerId: string | null;
  canReviewPayments: boolean;
  sessionVersion: number;
}): SessionUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    role: row.role,
    customerId: row.customerId,
    canReviewPayments: row.canReviewPayments,
    sessionVersion: row.sessionVersion,
  };
}

export async function findActiveUserById(userId: string): Promise<SessionUser | null> {
  const [row] = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      customerId: users.customerId,
      canReviewPayments: users.canReviewPayments,
      sessionVersion: users.sessionVersion,
      isActive: users.isActive,
    })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.isActive ? toSessionUser(row) : null;
}

/* ------------------------- Access + refresh token pair ------------------------- */

async function insertRefreshToken(tx: Pick<typeof db, "insert">, userId: string) {
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  const refreshExpiresAt = new Date(Date.now() + REFRESH_TTL_DAYS * 86_400_000);
  await tx.insert(refreshTokens).values({ tokenHash: hashToken(refreshToken), userId, expiresAt: refreshExpiresAt });
  return { refreshToken, refreshExpiresAt };
}

export async function createAuthSession(user: SessionUser): Promise<TokenPair> {
  await db.delete(refreshTokens).where(lt(refreshTokens.expiresAt, new Date()));
  const refresh = await insertRefreshToken(db, user.id);
  return {
    ...refresh,
    accessToken: signAccessToken(user),
    accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
  };
}

/**
 * One-time refresh rotation. The guarded UPDATE makes concurrent reuse safe:
 * only one request can revoke the old row; all others fail. Reuse of an already
 * revoked token triggers family-wide revocation for that user.
 */
export async function rotateRefreshToken(rawToken: string): Promise<{ pair: TokenPair; user: SessionUser } | null> {
  const tokenHash = hashToken(rawToken);
  const [record] = await db
    .select({ userId: refreshTokens.userId, expiresAt: refreshTokens.expiresAt, revokedAt: refreshTokens.revokedAt })
    .from(refreshTokens)
    .where(eq(refreshTokens.tokenHash, tokenHash))
    .limit(1);
  if (!record || record.expiresAt <= new Date()) return null;
  if (record.revokedAt) {
    // Refresh-token reuse is treated as credential theft.
    await revokeAllUserTokens(record.userId);
    return null;
  }
  const user = await findActiveUserById(record.userId);
  if (!user) {
    await revokeAllUserTokens(record.userId);
    return null;
  }

  const result = await db.transaction(async (tx) => {
    const revoked = await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.tokenHash, tokenHash), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())));
    if (revoked[0].affectedRows === 0) return null;
    const refresh = await insertRefreshToken(tx, user.id);
    return {
      pair: {
        ...refresh,
        accessToken: signAccessToken(user),
        accessExpiresAt: new Date(Date.now() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      },
      user,
    };
  });
  return result;
}

/** Revoke one refresh credential (logout). Rows remain for replay detection/audit. */
export async function destroySession(rawToken: string) {
  await db
    .update(refreshTokens)
    .set({ revokedAt: new Date() })
    .where(and(eq(refreshTokens.tokenHash, hashToken(rawToken)), isNull(refreshTokens.revokedAt)));
}

/** Revoke every active refresh token of a user (logout-all / deactivation). */
export async function revokeAllUserTokens(userId: string): Promise<SessionUser | null> {
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({ sessionVersion: sql`${users.sessionVersion} + 1` })
      .where(eq(users.id, userId));
    await tx
      .update(refreshTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(refreshTokens.userId, userId), isNull(refreshTokens.revokedAt)));
  });
  return findActiveUserById(userId);
}

async function findUserByRefreshToken(rawToken: string): Promise<SessionUser | null> {
  const rows = await db
    .select({
      id: users.id,
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      customerId: users.customerId,
      canReviewPayments: users.canReviewPayments,
      sessionVersion: users.sessionVersion,
      isActive: users.isActive,
    })
    .from(refreshTokens)
    .innerJoin(users, eq(users.id, refreshTokens.userId))
    .where(
      and(
        eq(refreshTokens.tokenHash, hashToken(rawToken)),
        gt(refreshTokens.expiresAt, new Date()),
        isNull(refreshTokens.revokedAt),
      ),
    )
    .limit(1);
  const row = rows[0];
  return row?.isActive ? toSessionUser(row) : null;
}

/* --------------------------------- Cookies -------------------------------- */

const baseCookie = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

export const accessCookieOpts = (expires: Date) => ({ ...baseCookie, expires });
export const refreshCookieOpts = (expires: Date) => ({ ...baseCookie, expires });

export async function setAuthCookies(pair: TokenPair) {
  const jar = await cookies();
  jar.set(ACCESS_COOKIE, pair.accessToken, accessCookieOpts(pair.accessExpiresAt));
  jar.set(REFRESH_COOKIE, pair.refreshToken, refreshCookieOpts(pair.refreshExpiresAt));
}

export async function clearAuthCookies() {
  const jar = await cookies();
  jar.delete(ACCESS_COOKIE);
  jar.delete(REFRESH_COOKIE);
}

/* ----------------------------- Current requester ---------------------------- */

/** Access JWT only: used by APIs that must reject expired access credentials. */
export async function getAccessUser(): Promise<SessionUser | null> {
  const token = (await cookies()).get(ACCESS_COOKIE)?.value;
  if (!token) return null;
  const claims = verifyAccessToken(token);
  if (!claims) return null;
  // DB lookup checks activation, current role/customer binding, and the
  // invalidation counter on every protected request.
  const user = await findActiveUserById(claims.sub);
  return user && user.sessionVersion === claims.sessionVersion ? user : null;
}

/**
 * Browser page session: JWT first; a valid refresh cookie may sustain an RSC
 * render while the client calls /api/auth/refresh. Rotation itself only occurs
 * at the dedicated endpoint, never silently during a read.
 */
export async function getSessionUser(): Promise<SessionUser | null> {
  const accessUser = await getAccessUser();
  if (accessUser) return accessUser;
  const refresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  return refresh ? findUserByRefreshToken(refresh) : null;
}

/* ------------------------------ Route guarding ----------------------------- */

export async function requireUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (roles && !roles.includes(user.role)) redirect(user.role === "CUSTOMER" ? "/portal" : "/");
  return user;
}

export async function requireActionUser(roles?: Role[]): Promise<SessionUser> {
  const user = await getSessionUser();
  if (!user) throw new Error("نشست کاربری معتبر نیست؛ دوباره وارد شوید");
  if (roles && !roles.includes(user.role)) throw new Error("شما مجوز انجام این عملیات را ندارید");
  return user;
}

export const publicSessionUser = (u: SessionUser) => ({
  id: u.id,
  username: u.username,
  fullName: u.fullName,
  role: u.role,
  customerId: u.customerId,
  canReviewPayments: u.canReviewPayments,
});

export const canReviewPayments = (u: SessionUser) => u.role === "ADMIN" || (u.role === "OPERATOR" && u.canReviewPayments);

/* --------------------------- Login attempt limiter -------------------------- */

const attempts = new Map<string, { count: number; resetAt: number }>();

export function loginThrottle(key: string): string | null {
  const now = Date.now();
  const record = attempts.get(key);
  if (record && record.resetAt > now && record.count >= 6) {
    return "به دلیل تلاش‌های ناموفق متعدد، چند دقیقه دیگر تلاش کنید";
  }
  return null;
}

export function loginFailed(key: string) {
  const now = Date.now();
  const record = attempts.get(key);
  if (!record || record.resetAt <= now) attempts.set(key, { count: 1, resetAt: now + 10 * 60_000 });
  else record.count += 1;
}

export function loginSucceeded(key: string) {
  attempts.delete(key);
}
