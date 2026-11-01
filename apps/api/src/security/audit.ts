import type { Prisma, UserRole } from "@prisma/client";
import type { Request } from "express";
import { prisma } from "../db";
import { logger } from "../logger";

export interface AuditActor {
  id: string;
  fullName: string;
  role: UserRole;
}

export const requestSecurityMeta = (req: Request) => ({
  ip: (req.ip ?? "unknown").slice(0, 64),
  userAgent: (req.get("user-agent") ?? "unknown").slice(0, 180),
});

export async function audit(
  actor: AuditActor | null,
  action: string,
  entity: string,
  entityId: string | null,
  meta?: Prisma.InputJsonValue,
) {
  try {
    await prisma.auditLog.create({
      data: {
        userId: actor?.id ?? null,
        userName: actor?.fullName ?? null,
        userRole: actor?.role ?? null,
        action,
        entity,
        entityId,
        meta,
      },
    });
  } catch (err) {
    logger.error({ err, action, entity }, "audit write failed");
  }
}
