import crypto from "node:crypto";
import type { Prisma, User, UserRole } from "@prisma/client";
import { prisma } from "../db";
import { signAccessToken, accessTtlSeconds } from "./jwt";
import { HttpError } from "./errors";

const refreshDays = () => Number(process.env.REFRESH_TOKEN_TTL_DAYS ?? 7);
export const hashRefreshToken = (token: string) => crypto.createHash("sha256").update(token).digest("hex");

export type TokenUser = Pick<
  User,
  "id" | "username" | "fullName" | "role" | "customerId" | "canReviewPayments" | "sessionVersion"
>;

function newRefresh() {
  const refreshToken = crypto.randomBytes(32).toString("base64url");
  return {
    refreshToken,
    refreshExpiresAt: new Date(Date.now() + refreshDays() * 86_400_000),
    tokenHash: hashRefreshToken(refreshToken),
  };
}

export async function createPair(user: TokenUser, tx: Prisma.TransactionClient = prisma) {
  const refresh = newRefresh();
  await tx.refreshToken.create({
    data: { tokenHash: refresh.tokenHash, userId: user.id, expiresAt: refresh.refreshExpiresAt },
  });
  return {
    accessToken: signAccessToken({
      id: user.id,
      role: user.role,
      customerId: user.customerId,
      sessionVersion: user.sessionVersion,
    }),
    accessExpiresAt: new Date(Date.now() + accessTtlSeconds() * 1000),
    refreshToken: refresh.refreshToken,
    refreshExpiresAt: refresh.refreshExpiresAt,
  };
}

export async function rotatePair(rawToken: string) {
  const hash = hashRefreshToken(rawToken);
  const record = await prisma.refreshToken.findUnique({
    where: { tokenHash: hash },
    include: { user: true },
  });
  if (!record || record.expiresAt <= new Date()) throw new HttpError(401, "توکن تازه‌سازی نامعتبر یا منقضی است", "INVALID_REFRESH");
  if (record.revokedAt) {
    await revokeAll(record.userId);
    throw new HttpError(401, "استفاده مجدد از توکن شناسایی شد؛ همه نشست‌ها لغو شدند", "REFRESH_REUSE");
  }
  if (!record.user.isActive) {
    await revokeAll(record.userId);
    throw new HttpError(401, "حساب کاربری غیرفعال است", "ACCOUNT_DISABLED");
  }

  return prisma.$transaction(async (tx) => {
    const changed = await tx.refreshToken.updateMany({
      where: { tokenHash: hash, revokedAt: null, expiresAt: { gt: new Date() } },
      data: { revokedAt: new Date() },
    });
    if (changed.count !== 1) throw new HttpError(401, "توکن تازه‌سازی قبلاً استفاده شده است", "REFRESH_REUSE");
    const user: TokenUser = record.user;
    return { pair: await createPair(user, tx), user };
  });
}

export async function revokeOne(rawToken: string) {
  await prisma.refreshToken.updateMany({
    where: { tokenHash: hashRefreshToken(rawToken), revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeAll(userId: string) {
  return prisma.$transaction(async (tx) => {
    const user = await tx.user.update({ where: { id: userId }, data: { sessionVersion: { increment: 1 } } });
    await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return user;
  });
}

export const publicUser = (user: TokenUser) => ({
  id: user.id,
  username: user.username,
  fullName: user.fullName,
  role: user.role as UserRole,
  customerId: user.customerId,
  canReviewPayments: user.canReviewPayments,
});
