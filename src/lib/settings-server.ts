import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { defaultFinance, type FinanceSettings } from "@/lib/finance";

/** SERVER-ONLY: key-value settings backed by the database. */
export async function getSetting<T>(key: string, fallback: T): Promise<T> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  if (!rows[0]) return fallback;
  return { ...fallback, ...(rows[0].value as Partial<T>) };
}

export const getFinanceSettings = () => getSetting<FinanceSettings>("finance", defaultFinance);
