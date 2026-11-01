"use server";

import { and, asc, eq, inArray } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contracts, customers, installments } from "@/db/schema";
import { requireActionUser } from "@/lib/auth";
import { changeDueDateSchema, forgiveInstallmentSchema, settlementQuoteSchema } from "@/lib/validators";
import { computePenalty, deriveInstallmentStatus, settlementBreakdown } from "@/lib/finance";
import { getFinanceSettings } from "@/lib/settings-server";
import { todayGreg } from "@/lib/jalali";
import { logAction } from "@/lib/audit";
import { logger } from "@/lib/logger";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "خطای غیرمنتظره رخ داد" });

/**
 * Authorized due-date change (ADMIN only).
 * Only an unpaid, unreserved installment can move; the original date is kept so
 * the penalty history remains auditable. Penalties are derived from the stored
 * due date, so moving the date forward naturally stops further accrual.
 */
export async function changeInstallmentDueDate(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const v = changeDueDateSchema.parse(raw);

    const [inst] = await db.select().from(installments).where(eq(installments.id, v.installmentId)).limit(1);
    if (!inst) throw new Error("قسط یافت نشد");
    if (inst.status === "PAID" || inst.paidAt) throw new Error("قسط پرداخت‌شده قابل تغییر نیست");
    if (inst.status === "FORGIVEN") throw new Error("قسط بخشوده‌شده قابل تغییر نیست");
    if (inst.status === "RESERVED") throw new Error("فیش این قسط در حال بررسی است؛ ابتدا نتیجه بررسی مشخص شود");
    if (inst.dueDate === v.dueDate) throw new Error("تاریخ جدید با سررسید فعلی یکسان است");

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, inst.contractId)).limit(1);
    if (!contract) throw new Error("قرارداد یافت نشد");
    if (contract.status !== "ACTIVE") throw new Error("فقط اقساط قرارداد فعال قابل تغییر هستند");

    await db.transaction(async (tx) => {
      await tx
        .update(installments)
        .set({
          dueDate: v.dueDate,
          // Preserve the first original date across repeated changes.
          originalDueDate: inst.originalDueDate ?? inst.dueDate,
          dueDateChangedBy: actor.id,
          dueDateChangedAt: new Date(),
          dueDateChangeReason: v.reason,
        })
        .where(eq(installments.id, inst.id));
      await logAction(
        actor,
        "installment.due_date_change",
        "installment",
        inst.id,
        { contractId: inst.contractId, seq: inst.seq, from: inst.dueDate, to: v.dueDate, reason: v.reason },
        tx,
      );
    });

    logger.info("installment due date changed", { installmentId: inst.id, from: inst.dueDate, to: v.dueDate });
    revalidatePath(`/contracts/${inst.contractId}`);
    revalidatePath("/installments");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/**
 * Waive an entire installment obligation (status → FORGIVEN, ADMIN only).
 * Terminal like PAID: it never becomes overdue again and stops penalty accrual.
 * The contract auto-settles when no payable installment remains.
 */
export async function forgiveInstallment(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const v = forgiveInstallmentSchema.parse(raw);

    const [inst] = await db.select().from(installments).where(eq(installments.id, v.installmentId)).limit(1);
    if (!inst) throw new Error("قسط یافت نشد");
    if (inst.status === "PAID" || inst.paidAt) throw new Error("قسط پرداخت‌شده قابل بخشودگی نیست");
    if (inst.status === "FORGIVEN") throw new Error("این قسط قبلاً بخشوده شده است");
    if (inst.status === "RESERVED") throw new Error("فیش این قسط در حال بررسی است؛ ابتدا نتیجه بررسی مشخص شود");

    const finance = await getFinanceSettings();
    const penalty = computePenalty(inst.amount, inst.dueDate, todayGreg(), finance, inst.penaltyForgiven).penalty;

    await db.transaction(async (tx) => {
      await tx
        .update(installments)
        .set({
          status: "FORGIVEN",
          penaltyForgiven: true,
          // Records the full waived obligation: principal + any accrued penalty.
          forgivenAmount: inst.amount + penalty,
          forgivenBy: actor.id,
          forgivenAt: new Date(),
          forgivenReason: v.reason,
        })
        .where(and(eq(installments.id, inst.id), eq(installments.status, "PENDING")));

      const remaining = await tx
        .select({ id: installments.id })
        .from(installments)
        .where(and(eq(installments.contractId, inst.contractId), inArray(installments.status, ["PENDING", "RESERVED"])))
        .limit(1);
      if (remaining.length === 0) {
        await tx.update(contracts).set({ status: "SETTLED" }).where(eq(contracts.id, inst.contractId));
      }

      await logAction(
        actor,
        "installment.forgive",
        "installment",
        inst.id,
        { contractId: inst.contractId, seq: inst.seq, principal: inst.amount, penalty, reason: v.reason },
        tx,
      );
    });

    revalidatePath(`/contracts/${inst.contractId}`);
    revalidatePath("/installments");
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export interface SettlementQuote {
  contractNo: string;
  customerName: string;
  lines: { seq: number; dueDate: string; amount: number; daysLate: number; penalty: number; forgiven: boolean }[];
  principalTotal: number;
  penaltyTotal: number;
  forgivenPenaltyTotal: number;
  grandTotal: number;
  calculatedAt: string;
}

/** Read-only early-settlement quote. Performs no writes. */
export async function getSettlementQuote(raw: unknown): Promise<Result<SettlementQuote>> {
  try {
    const actor = await requireActionUser();
    const v = settlementQuoteSchema.parse(raw);

    const rows = await db
      .select({ contract: contracts, customer: customers })
      .from(contracts)
      .innerJoin(customers, eq(customers.id, contracts.customerId))
      .where(eq(contracts.id, v.contractId))
      .limit(1);
    const row = rows[0];
    if (!row) throw new Error("قرارداد یافت نشد");
    if (actor.role === "CUSTOMER" && row.contract.customerId !== actor.customerId) throw new Error("قرارداد یافت نشد");
    // Only staff may price a settlement with penalties waived.
    const waive = v.waivePenalties && actor.role !== "CUSTOMER";

    const payable = await db
      .select()
      .from(installments)
      .where(and(eq(installments.contractId, v.contractId), eq(installments.status, "PENDING")))
      .orderBy(asc(installments.seq));
    if (payable.length === 0) throw new Error("قسط پرداخت‌نشده‌ای برای تسویه وجود ندارد");

    const today = todayGreg();
    const finance = await getFinanceSettings();
    const breakdown = settlementBreakdown(
      payable.map((i) => ({ id: i.id, seq: i.seq, dueDate: i.dueDate, amount: i.amount, penaltyForgiven: i.penaltyForgiven })),
      today,
      finance,
      waive,
    );

    return {
      ok: true,
      data: {
        contractNo: row.contract.contractNo,
        customerName: row.customer.fullName,
        lines: breakdown.lines.map(({ seq, dueDate, amount, daysLate, penalty, forgiven }) => ({ seq, dueDate, amount, daysLate, penalty, forgiven })),
        principalTotal: breakdown.principalTotal,
        penaltyTotal: breakdown.penaltyTotal,
        forgivenPenaltyTotal: breakdown.forgivenPenaltyTotal,
        grandTotal: breakdown.grandTotal,
        calculatedAt: today,
      },
    };
  } catch (e) {
    return fail(e);
  }
}

export interface InstallmentRow {
  id: string;
  seq: number;
  dueDate: string;
  amount: number;
  status: string;
  penalty: number;
  daysLate: number;
  contractId: string;
  contractNo: string;
  customerId: string;
  customerName: string;
  dueDateChanged: boolean;
}

/** Installment list used by the installments screen (staff only). */
export async function listInstallments(filter: {
  status?: "ALL" | "PENDING" | "OVERDUE" | "PAID" | "FORGIVEN" | "RESERVED" | "UPCOMING";
  contractId?: string;
  limit?: number;
}): Promise<Result<InstallmentRow[]>> {
  try {
    await requireActionUser(["ADMIN", "OPERATOR"]);
    const today = todayGreg();
    const finance = await getFinanceSettings();

    const rows = await db
      .select({
        inst: installments,
        contractNo: contracts.contractNo,
        contractId: contracts.id,
        customerId: customers.id,
        customerName: customers.fullName,
      })
      .from(installments)
      .innerJoin(contracts, eq(contracts.id, installments.contractId))
      .innerJoin(customers, eq(customers.id, contracts.customerId))
      .where(filter.contractId ? eq(installments.contractId, filter.contractId) : undefined)
      .orderBy(asc(installments.dueDate))
      .limit(Math.min(filter.limit ?? 300, 500));

    const mapped = rows.map((r) => {
      const display = deriveInstallmentStatus(r.inst.status, r.inst.dueDate, today);
      const p =
        display === "OVERDUE" ? computePenalty(r.inst.amount, r.inst.dueDate, today, finance, r.inst.penaltyForgiven) : null;
      return {
        id: r.inst.id,
        seq: r.inst.seq,
        dueDate: r.inst.dueDate,
        amount: r.inst.amount,
        status: display,
        penalty: p?.penalty ?? 0,
        daysLate: p?.daysLate ?? 0,
        contractId: r.contractId,
        contractNo: r.contractNo,
        customerId: r.customerId,
        customerName: r.customerName,
        dueDateChanged: Boolean(r.inst.originalDueDate),
      };
    });

    const filtered =
      !filter.status || filter.status === "ALL"
        ? mapped
        : filter.status === "UPCOMING"
          ? mapped.filter((m) => m.status === "PENDING" && m.dueDate >= today)
          : mapped.filter((m) => m.status === filter.status);

    return { ok: true, data: filtered };
  } catch (e) {
    return fail(e);
  }
}
