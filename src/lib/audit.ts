import { db } from "@/db";
import { auditLogs } from "@/db/schema";
import { logger } from "@/lib/logger";

export interface Actor {
  id: string;
  fullName: string;
  role: string;
}

/** Append-only audit trail. Never throws — audit failures must not break business ops. */
export async function logAction(
  actor: Actor | null,
  action: string,
  entity: string,
  entityId?: string | null,
  meta?: unknown,
  tx?: unknown,
) {
  const d = (tx ?? db) as typeof db;
  try {
    await d.insert(auditLogs).values({
      userId: actor?.id ?? null,
      userName: actor?.fullName ?? null,
      userRole: actor?.role ?? null,
      action,
      entity,
      entityId: entityId ?? null,
      meta: meta === undefined ? null : (meta as Record<string, unknown>),
    });
  } catch (e) {
    logger.error("audit log failed", { error: String(e), action, entity });
  }
}
