"use server";

import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contracts, counters, customers, guarantors, installments, payments } from "@/db/schema";
import { requireActionUser } from "@/lib/auth";
import { cancelContractSchema, contractSchema } from "@/lib/validators";
import { buildInstallmentSchedule, checkContractFinancials } from "@/lib/contracts";
import { gregToJalali, jalaliYear, todayGreg } from "@/lib/jalali";
import { logAction } from "@/lib/audit";
import { sendTemplateSms } from "@/lib/sms";
import { logger } from "@/lib/logger";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "خطای غیرمنتظره رخ داد" });
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
const pad5 = (n: number) => String(n).padStart(5, "0");
const toman = (n: number) => n.toLocaleString("en-US");

/** Schedule preview — pure, performs no writes. Used by the contract form. */
export async function previewSchedule(raw: unknown): Promise<
  Result<{ rows: { seq: number; dueDate: string; amount: number; clamped: boolean }[]; discrepancy: number; expectedTotal: number }>
> {
  try {
    await requireActionUser(["ADMIN", "OPERATOR"]);
    const v = contractSchema.parse(raw);
    if (v.type === "CASH") {
      return { ok: true, data: { rows: [{ seq: 1, dueDate: todayGreg(), amount: v.cashPrice, clamped: false }], discrepancy: 0, expectedTotal: v.cashPrice } };
    }
    const check = checkContractFinancials({
      totalPrice: v.totalPrice,
      downPayment: v.downPayment,
      installmentCount: v.installmentCount,
      installmentAmount: v.installmentAmount,
    });
    const rows = buildInstallmentSchedule({
      firstDueDate: v.firstDueDate!,
      paymentDay: v.paymentDay ?? gregToJalali(v.firstDueDate!).jd,
      installmentCount: v.installmentCount,
      installmentAmount: v.installmentAmount,
      lastInstallmentAdjustment: v.overrideDiscrepancy ? check.discrepancy : 0,
    });
    return { ok: true, data: { rows, discrepancy: check.discrepancy, expectedTotal: check.expectedTotal } };
  } catch (e) {
    return fail(e);
  }
}

export async function createContract(raw: unknown): Promise<Result<{ id: string; contractNo: string; duplicate?: boolean }>> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    const v = contractSchema.parse(raw);

    // Duplicate-submit guard: return the original contract instead of a second one.
    if (v.idempotencyKey) {
      const [existing] = await db
        .select({ id: contracts.id, contractNo: contracts.contractNo })
        .from(contracts)
        .where(eq(contracts.idempotencyKey, v.idempotencyKey))
        .limit(1);
      if (existing) return { ok: true, data: { ...existing, duplicate: true } };
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, v.customerId)).limit(1);
    if (!customer) throw new Error("مشتری یافت نشد");
    if (!customer.isActive) throw new Error("پرونده این مشتری غیرفعال است؛ ابتدا آن را فعال کنید");
    if (customer.isBlacklisted) throw new Error("این مشتری در فهرست سیاه است؛ ثبت قرارداد مجاز نیست");

    if (v.guarantorId) {
      const [g] = await db.select().from(guarantors).where(eq(guarantors.id, v.guarantorId)).limit(1);
      if (!g || g.customerId !== v.customerId) throw new Error("ضامن انتخاب‌شده متعلق به این مشتری نیست");
      if (!g.isActive) throw new Error("ضامن انتخاب‌شده غیرفعال است");
    }

    const today = todayGreg();
    let discrepancy = 0;
    let schedule: { seq: number; dueDate: string; amount: number }[];
    let count = 1;
    let perAmount = v.cashPrice;
    let firstDue = today;
    let downPayment = 0;
    let paymentDay: number | null = null;

    if (v.type === "CASH") {
      // A cash contract starts UNPAID: one pending installment, settled only by a confirmed payment.
      schedule = [{ seq: 1, dueDate: today, amount: v.cashPrice }];
    } else {
      count = v.installmentCount;
      perAmount = v.installmentAmount;
      firstDue = v.firstDueDate!;
      downPayment = v.downPayment;
      paymentDay = v.paymentDay ?? gregToJalali(firstDue).jd;

      const check = checkContractFinancials({ totalPrice: v.totalPrice, downPayment, installmentCount: count, installmentAmount: perAmount });
      discrepancy = check.discrepancy;
      if (!check.balanced && !v.overrideDiscrepancy) {
        throw new Error(
          `مغایرت مالی: پیش‌پرداخت + مجموع اقساط برابر ${toman(check.expectedTotal)} تومان است و با مبلغ کل ${toman(v.totalPrice)} تومان ` +
            `${toman(Math.abs(check.discrepancy))} تومان اختلاف دارد. اعداد را اصلاح کنید یا با ثبت دلیل، اعمال مغایرت روی قسط آخر را تأیید کنید.`,
        );
      }

      schedule = buildInstallmentSchedule({
        firstDueDate: firstDue,
        paymentDay,
        installmentCount: count,
        installmentAmount: perAmount,
        lastInstallmentAdjustment: v.overrideDiscrepancy ? discrepancy : 0,
      });
      const last = schedule[schedule.length - 1];
      if (last.amount <= 0) throw new Error("با این مغایرت، مبلغ قسط آخر صفر یا منفی می‌شود؛ اعداد را بازبینی کنید");
    }

    // Everything below is a single transaction: number allocation, contract row,
    // the full schedule, and the audit entry succeed or fail together.
    const created = await db.transaction(async (tx) => {
      const counter = await tx
          .insert(counters)
          .values({ key: "contract", value: 1 })
          .onDuplicateKeyUpdate({ set: { value: sql`${counters.value} + 1` } });
      // MySQL has no RETURNING; read the counter back inside the same transaction.
      const [counterRow] = await tx
          .select({ value: counters.value })
          .from(counters)
          .where(eq(counters.key, "contract"))
          .limit(1);
      const nextCounterValue = Number(counterRow?.value ?? 1);

      const contractNo = `${v.type === "CASH" ? "CSH" : "INS"}-${jalaliYear(today)}-${pad5(nextCounterValue)}`;
      const contractId = randomUUID();
        await tx.insert(contracts).values({ ...{
          contractNo,
          type: v.type,
          customerId: v.customerId,
          guarantorId: v.guarantorId ?? null,
          itemDescription: v.itemDescription,
          itemSerialNumber: v.itemSerialNumber || null,
          notes: v.notes || null,
          cashPrice: v.cashPrice,
          totalPrice: v.totalPrice,
          downPayment,
          installmentCount: count,
          installmentAmount: perAmount,
          discrepancy,
          discrepancyOverride: v.type === "INSTALLMENT" && v.overrideDiscrepancy && discrepancy !== 0,
          discrepancyOverrideBy: v.overrideDiscrepancy && discrepancy !== 0 ? actor.id : null,
          discrepancyOverrideReason: v.overrideDiscrepancy && discrepancy !== 0 ? v.overrideReason || null : null,
          firstDueDate: firstDue,
          paymentDay,
          idempotencyKey: v.idempotencyKey || null,
          createdBy: actor.id,
        }, id: contractId });
        const contract = { id: contractId, contractNo: contractNo };

      await tx.insert(installments).values(
        schedule.map((row) => ({ contractId: contract.id, seq: row.seq, dueDate: row.dueDate, amount: row.amount })),
      );

      await logAction(
        actor,
        "contract.create",
        "contract",
        contract.id,
        { contractNo, type: v.type, totalPrice: v.totalPrice, installmentCount: count, paymentDay, discrepancy },
        tx,
      );
      if (discrepancy !== 0 && v.overrideDiscrepancy) {
        await logAction(
          actor,
          "contract.discrepancy_override",
          "contract",
          contract.id,
          { contractNo, discrepancy, reason: v.overrideReason, appliedTo: `installment#${count}` },
          tx,
        );
      }
      return contract;
    });

    logger.info("contract created", { contractId: created.id, contractNo: created.contractNo, type: v.type, discrepancy });

    await sendTemplateSms({
      key: "contract_created",
      vars: { customer: customer.fullName, contractNo: created.contractNo, amount: toman(v.totalPrice) },
      customerId: customer.id,
      phone: customer.mobile,
      fallback: `${customer.fullName} گرامی، قرارداد شما با شماره ${created.contractNo} به مبلغ ${toman(v.totalPrice)} تومان ثبت شد. از اعتماد شما سپاسگزاریم.`,
    });

    revalidatePath("/contracts");
    revalidatePath(`/customers/${v.customerId}`);
    revalidatePath("/");
    return { ok: true, data: created };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: "این قرارداد قبلاً ثبت شده است؛ صفحه را تازه‌سازی کنید" };
    return fail(e);
  }
}

export async function updateContractNotes(contractId: string, notes: string): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    if (notes.length > 1000) throw new Error("یادداشت حداکثر ۱۰۰۰ نویسه است");
    const updated = await db
      .update(contracts)
      .set({ notes: notes.trim() || null })
      .where(eq(contracts.id, contractId));
    if (updated[0].affectedRows === 0) throw new Error("قرارداد یافت نشد");
    await logAction(actor, "contract.notes_update", "contract", contractId);
    revalidatePath(`/contracts/${contractId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelContract(raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    const v = cancelContractSchema.parse(raw);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, v.contractId)).limit(1);
    if (!contract) throw new Error("قرارداد یافت نشد");
    if (contract.status !== "ACTIVE") throw new Error("فقط قرارداد فعال قابل لغو است");

    const confirmed = await db
      .select({ id: payments.id })
      .from(payments)
      .where(and(eq(payments.contractId, v.contractId), eq(payments.status, "CONFIRMED")))
      .limit(1);
    if (confirmed[0]) throw new Error("برای این قرارداد پرداخت تأییدشده ثبت شده و قابل لغو نیست؛ ابتدا با مدیر مالی هماهنگ کنید");

    // Guarded UPDATE: a concurrent cancellation cannot double-apply.
    const canceled = await db.transaction(async (tx) => {
      const rows = await tx
        .update(contracts)
        .set({ status: "CANCELED", cancelReason: v.reason, canceledAt: new Date(), canceledBy: actor.id })
        .where(and(eq(contracts.id, v.contractId), eq(contracts.status, "ACTIVE")));
      if (rows[0].affectedRows === 0) return false;
      await logAction(actor, "contract.cancel", "contract", v.contractId, { reason: v.reason, contractNo: contract.contractNo }, tx);
      return true;
    });
    if (!canceled) throw new Error("این قرارداد هم‌اکنون توسط کاربر دیگری لغو شد");

    const [customer] = await db.select().from(customers).where(eq(customers.id, contract.customerId)).limit(1);
    if (customer) {
      await sendTemplateSms({
        key: "contract_canceled",
        vars: { customer: customer.fullName, contractNo: contract.contractNo },
        customerId: customer.id,
        phone: customer.mobile,
        fallback: `${customer.fullName} گرامی، قرارداد ${contract.contractNo} طبق درخواست ثبت‌شده لغو گردید. برای کسب اطلاعات بیشتر با فروشگاه تماس بگیرید.`,
      });
    }

    revalidatePath("/contracts");
    revalidatePath(`/contracts/${v.contractId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
