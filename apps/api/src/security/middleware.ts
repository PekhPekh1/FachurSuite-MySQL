import type { NextFunction, Request, Response } from "express";
import type { UserRole } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { ACCESS_COOKIE, parseCookies } from "./cookies";
import { HttpError } from "./errors";
import { verifyAccessToken } from "./jwt";

export interface AuthUser {
  id: string;
  username: string;
  fullName: string;
  role: UserRole;
  customerId: string | null;
  canReviewPayments: boolean;
  /** Internal invalidation counter; never included in public JSON. */
  sessionVersion: number;
}

export interface AuthRequest extends Request {
  auth?: AuthUser;
}

export async function authenticate(req: AuthRequest, _res: Response, next: NextFunction) {
  try {
    const bearer = req.get("authorization")?.match(/^Bearer\s+(.+)$/i)?.[1];
    const token = bearer ?? parseCookies(req)[ACCESS_COOKIE];
    const claims = token ? verifyAccessToken(token) : null;
    if (!claims) throw new HttpError(401, "توکن دسترسی نامعتبر یا منقضی است", "UNAUTHENTICATED");

    // Every request checks activation and current role/customer mapping. JWT
    // claims are never used as the sole source of authorization truth.
    const user = await prisma.user.findUnique({
      where: { id: claims.sub },
      select: {
        id: true,
        username: true,
        fullName: true,
        role: true,
        customerId: true,
        canReviewPayments: true,
        sessionVersion: true,
        isActive: true,
      },
    });
    if (!user?.isActive) throw new HttpError(401, "حساب کاربری غیرفعال یا نامعتبر است", "ACCOUNT_DISABLED");
    if (user.sessionVersion !== claims.sessionVersion) {
      throw new HttpError(401, "نشست کاربری لغو شده است", "SESSION_REVOKED");
    }
    req.auth = user;
    next();
  } catch (err) {
    next(err);
  }
}

export function authorize(...roles: UserRole[]) {
  return (req: AuthRequest, _res: Response, next: NextFunction) => {
    if (!req.auth) return next(new HttpError(401, "نشست معتبر نیست", "UNAUTHENTICATED"));
    if (!roles.includes(req.auth.role)) {
      logger.warn({ userId: req.auth.id, role: req.auth.role, path: req.path }, "authorization denied");
      return next(new HttpError(403, "شما مجوز دسترسی به این بخش را ندارید", "FORBIDDEN"));
    }
    next();
  };
}

/** Same-origin check for browser cookie-authenticated mutations (CSRF defense). */
export function trustedOrigin(req: Request, _res: Response, next: NextFunction) {
  const origin = req.get("origin");
  if (!origin) return next(); // non-browser clients
  const allowed = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((v) => v.trim());
  if (!allowed.includes(origin)) return next(new HttpError(403, "مبدأ درخواست مجاز نیست", "ORIGIN_DENIED"));
  next();
}
