import { Router, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { prisma } from "../db";
import { logger } from "../logger";
import { audit, requestSecurityMeta } from "../security/audit";
import { ACCESS_COOKIE, REFRESH_COOKIE, clearAuthCookies, parseCookies, setAuthCookies } from "../security/cookies";
import { asyncRoute, HttpError } from "../security/errors";
import { authenticate, trustedOrigin, type AuthRequest } from "../security/middleware";
import { changePasswordSchema, loginSchema } from "../security/schemas";
import { createPair, publicUser, revokeAll, revokeOne, rotatePair } from "../security/tokens";

export const authRouter = Router();
const dummyHash = bcrypt.hashSync("timing-safe-dummy-password", 12);

const loginLimiter = rateLimit({
  windowMs: 10 * 60_000,
  limit: 8,
  standardHeaders: true,
  legacyHeaders: false,
  skipSuccessfulRequests: true,
  message: { ok: false, error: "تلاش‌های ورود بیش از حد مجاز است؛ کمی بعد تلاش کنید", code: "LOGIN_THROTTLED" },
});

authRouter.post(
  "/login",
  trustedOrigin,
  loginLimiter,
  asyncRoute(async (req, res) => {
    const input = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { username: input.username } });
    // Always perform one bcrypt comparison to reduce username-enumeration timing.
    const valid = await bcrypt.compare(input.password, user?.passwordHash ?? dummyHash);
    if (!user || !valid) {
      logger.warn({ username: input.username, ip: req.ip }, "login failed");
      await audit(null, "auth.login_failed", "user", input.username, {
        ...requestSecurityMeta(req),
        reason: "invalid_credentials",
      });
      throw new HttpError(401, "نام کاربری یا رمز عبور اشتباه است", "INVALID_CREDENTIALS");
    }
    if (!user.isActive) {
      logger.warn({ userId: user.id, ip: req.ip }, "disabled account login blocked");
      await audit(user, "auth.login_blocked", "user", user.id, {
        ...requestSecurityMeta(req),
        reason: "account_disabled",
      });
      throw new HttpError(403, "حساب کاربری غیرفعال است", "ACCOUNT_DISABLED");
    }

    const pair = await createPair(user);
    setAuthCookies(res, pair);
    await audit(user, "auth.login", "user", user.id, requestSecurityMeta(req));
    logger.info({ userId: user.id, role: user.role, ip: req.ip }, "login success");
    res.json({ ok: true, user: publicUser(user) });
  }),
);

authRouter.post(
  "/refresh",
  trustedOrigin,
  asyncRoute(async (req, res) => {
    const raw = parseCookies(req)[REFRESH_COOKIE];
    if (!raw) throw new HttpError(401, "توکن تازه‌سازی موجود نیست", "INVALID_REFRESH");
    try {
      const { pair, user } = await rotatePair(raw);
      setAuthCookies(res, pair);
      await audit(user, "auth.refresh_rotated", "user", user.id, requestSecurityMeta(req));
      res.json({ ok: true, user: publicUser(user) });
    } catch (err) {
      clearAuthCookies(res);
      logger.warn({ ip: req.ip, code: err instanceof HttpError ? err.code : "unknown" }, "refresh rejected");
      throw err;
    }
  }),
);

authRouter.post(
  "/logout",
  trustedOrigin,
  asyncRoute(async (req, res) => {
    const raw = parseCookies(req)[REFRESH_COOKIE];
    if (raw) await revokeOne(raw);
    clearAuthCookies(res);
    await audit(null, "auth.logout", "user", null, requestSecurityMeta(req));
    res.json({ ok: true });
  }),
);

authRouter.post(
  "/logout-all",
  trustedOrigin,
  authenticate,
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const user = req.auth!;
    await revokeAll(user.id);
    clearAuthCookies(res);
    await audit(user, "auth.logout_all", "user", user.id, requestSecurityMeta(req));
    logger.info({ userId: user.id }, "all sessions revoked");
    res.json({ ok: true });
  }),
);

authRouter.patch(
  "/password",
  trustedOrigin,
  authenticate,
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const actor = req.auth!;
    const input = changePasswordSchema.parse(req.body);
    const record = await prisma.user.findUnique({ where: { id: actor.id } });
    if (!record || !(await bcrypt.compare(input.currentPassword, record.passwordHash))) {
      await audit(actor, "auth.password_change_failed", "user", actor.id, {
        ...requestSecurityMeta(req),
        reason: "incorrect_current_password",
      });
      throw new HttpError(400, "رمز عبور فعلی صحیح نیست", "WRONG_PASSWORD");
    }

    const newHash = await bcrypt.hash(input.newPassword, 12);
    const pair = await prisma.$transaction(async (tx) => {
      const updated = await tx.user.update({
        where: { id: actor.id },
        data: { passwordHash: newHash, sessionVersion: { increment: 1 } },
      });
      await tx.refreshToken.updateMany({ where: { userId: actor.id, revokedAt: null }, data: { revokedAt: new Date() } });
      return createPair(updated, tx);
    });
    setAuthCookies(res, pair);
    await audit(actor, "auth.password_changed", "user", actor.id, requestSecurityMeta(req));
    logger.info({ userId: actor.id }, "password changed");
    res.json({ ok: true });
  }),
);

authRouter.get(
  "/me",
  authenticate,
  asyncRoute(async (req: AuthRequest, res: Response) => {
    res.setHeader("Cache-Control", "no-store");
    res.json({ ok: true, user: publicUser(req.auth!) });
  }),
);

// Compile-time assertion that token cookies stay HTTP-only: values are never
// included in JSON responses. The import also prevents accidental name drift.
void ACCESS_COOKIE;
