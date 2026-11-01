"use server";

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { contracts, customers, installments, payments, paymentInstallments } from "@/db/schema";
import { canReviewPayments, requireActionUser, type SessionUser } from "@/lib/auth";
import { forgivePenaltySchema, paymentCreateSchema, reviewSchema } from "@/lib/validators";
import { computePenalty, settlementBreakdown, type FinanceSettings } from "@/lib/finance";
import { getFinanceSettings } from "@/lib/settings-server";
import { formatJalali, todayGreg } from "@/lib/jalali";
import { logAction } from "@/lib/audit";
import { sendTemplateSms } from "@/lib/sms";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "خطای غیرمنتظره رخ داد" });
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";

interface Coverage {
  ids: string[];
  principal: number;
  penalty: number;
  total: number;
  lines: { installmentId: string; seq: number; dueDate: string; amount: number; daysLate: number; penalty: number; forgiven: boolean }[];
}

/**
 * Resolves which installments a payment covers and what it must cost.
 * Rules: installments are paid strictly in order (oldest first), each one fully
 * (no partial payments) and accrued penalties are collected unless forgiven
 * or explicitly waived by staff.
 */
async function buildCoverage(opts: {
  contractId: string;
  installmentIds: string[];
  settle: boolean;
  waivePenalties: boolean;
  today: string;
  finance: FinanceSettings;
}): Promise<Coverage> {
  const all = await db
    .select()
    .from(installments)
    .where(eq(installments.contractId, opts.contractId))
    .orderBy(asc(installments.seq));

  // Only PENDING installments are payable: PAID is settled and RESERVED is
  // already covered by a receipt awaiting review (double-submission guard).
  const unpaid = all.filter((i) => !i.paidAt && i.status === "PENDING");
  const anyUnpaid = all.some((i) => !i.paidAt);
  if (!anyUnpaid) throw new Error("قسط پرداخت‌نشده‌ای برای این قرارداد وجود ندارد");
  if (unpaid.length === 0) throw new Error("اقساط باقی‌مانده این قرارداد در حال بررسی فیش هستند");

  let wanted = unpaid;
  if (!opts.settle) {
    const set = new Set(opts.installmentIds);
    const picked = unpaid.filter((i) => set.has(i.id));
    if (picked.length !== opts.installmentIds.length) {
      throw new Error("اقساط انتخاب‌شده معتبر نیستند (پرداخت‌شده یا متعلق به قرارداد دیگری هستند)");
    }
    const firstN = unpaid.slice(0, picked.length);
    if (!firstN.every((f, idx) => f.id === picked[idx].id)) {
      throw new Error("اقساط باید به ترتیب و متوالی پرداخت شوند؛ ابتدا اقساط قدیمی‌تر را بپردازید");
    }
    wanted = picked;
  }

  const breakdown = settlementBreakdown(
    wanted.map((i) => ({ id: i.id, seq: i.seq, dueDate: i.dueDate, amount: i.amount, penaltyForgiven: i.penaltyForgiven })),
    opts.today,
    opts.finance,
    opts.waivePenalties,
  );

  return {
    ids: wanted.map((i) => i.id),
    principal: breakdown.principalTotal,
    penalty: breakdown.penaltyTotal,
    total: breakdown.grandTotal,
    lines: breakdown.lines,
  };
}

/**
 * A contract is complete when nothing payable remains. PAID and FORGIVEN are
 * both terminal, so only PENDING/RESERVED rows block settlement.
 */
async function settleIfComplete(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], contractId: string) {
  const remaining = await tx
    .select({ id: installments.id })
    .from(installments)
    .where(and(eq(installments.contractId, contractId), inArray(installments.status, ["PENDING", "RESERVED"])))
    .limit(1);
  if (remaining.length === 0) {
    await tx.update(contracts).set({ status: "SETTLED" }).where(eq(contracts.id, contractId));
  }
}

function revalidatePaymentPaths(contractId: string, customerId: string) {
  revalidatePath("/payments");
  revalidatePath("/contracts");
  revalidatePath(`/contracts/${contractId}`);
  revalidatePath(`/customers/${customerId}`);
  revalidatePath("/portal");
  revalidatePath("/");
}

export async function createPayment(raw: unknown): Promise<Result<{ id: string }>> {
  try {
    const u = await requireActionUser();
    const v = paymentCreateSchema.parse(raw);

    const [contract] = await db.select().from(contracts).where(eq(contracts.id, v.contractId)).limit(1);
    if (!contract) throw new Error("قرارداد یافت نشد");
    if (contract.status !== "ACTIVE") throw new Error("این قرارداد فعال نیست؛ امکان ثبت پرداخت وجود ندارد");

    if (u.role === "CUSTOMER") {
      if (contract.customerId !== u.customerId) throw new Error("دسترسی به این قرارداد برای شما مجاز نیست");
      if (v.method !== "CARD_TO_CARD") throw new Error("مشتری فقط می‌تواند فیش کارت‌به‌کارت ثبت کند");
      if (v.waivePenalties) throw new Error("بخشودگی جریمه فقط توسط کارکنان مجاز است");
      if (v.settle) throw new Error("تسویه کامل فقط توسط کارکنان ثبت می‌شود");
    }

    // Resubmission may only replace a rejected receipt for the same contract.
    if (v.resubmissionOf) {
      const [prior] = await db.select().from(payments).where(eq(payments.id, v.resubmissionOf)).limit(1);
      if (!prior) throw new Error("پرداخت پیشین یافت نشد");
      if (prior.status !== "REJECTED") throw new Error("فقط فیش ردشده قابل ارسال مجدد است");
      if (prior.contractId !== contract.id) throw new Error("فیش پیشین متعلق به این قرارداد نیست");
    }

    const autoConfirm = v.method !== "CARD_TO_CARD"; // card-to-card always requires verification
    const today = todayGreg();
    const finance = await getFinanceSettings();
    const coverage = await buildCoverage({
      contractId: contract.id,
      installmentIds: v.installmentIds,
      settle: v.settle,
      waivePenalties: v.waivePenalties && u.role !== "CUSTOMER",
      today,
      finance,
    });

    if (coverage.total !== v.amount) {
      throw new Error(
        `مبلغ واردشده با جمع اقساط و جریمه‌ها مطابقت ندارد. مبلغ صحیح: ${coverage.total.toLocaleString("en-US")} تومان`,
      );
    }

    // Idempotent retry: same key → return the already-created payment.
    const dup = await db.select({ id: payments.id }).from(payments).where(eq(payments.idempotencyKey, v.idempotencyKey)).limit(1);
    if (dup[0]) return { ok: true, data: { id: dup[0].id } };

    const paymentId = await db.transaction(async (tx) => {
      const pId = randomUUID();
      await tx.insert(payments).values({ ...{
          idempotencyKey: v.idempotencyKey,
          contractId: contract.id,
          customerId: contract.customerId,
          amount: v.amount,
          penaltyAmount: coverage.penalty,
          method: v.method,
          status: autoConfirm ? "CONFIRMED" : "PENDING_VERIFICATION",
          sourceCardNumber: v.sourceCardNumber || null,
          referenceNo: v.referenceNo || null,
          note: v.note || null,
          paidAt: v.paidAt ? new Date(v.paidAt) : autoConfirm ? new Date() : null,
          receiptDocumentId: v.receiptDocumentId ?? null,
          isSettlement: v.settle,
          settlementMeta: v.settle ? { lines: coverage.lines, calculatedAt: today } : null,
          resubmissionOf: v.resubmissionOf ?? null,
          isResubmittable: false,
          submittedBy: u.id,
          // Only a verified/confirmed payment sets verification attribution.
          reviewedBy: autoConfirm ? u.id : null,
          reviewedAt: autoConfirm ? new Date() : null,
        }, id: pId });
      const p = { id: pId };

      // A unique index on payment_installments.installmentId guarantees an
      // installment can never be covered by two payments — even concurrently.
      await tx.insert(paymentInstallments).values(coverage.ids.map((id) => ({ paymentId: p.id, installmentId: id })));

      if (autoConfirm) {
        await tx
          .update(installments)
          .set({ paidAt: new Date(), paymentId: p.id, status: "PAID" })
          .where(inArray(installments.id, coverage.ids));
        await settleIfComplete(tx, contract.id);
      } else {
        // Reserve the covered installments until the receipt is reviewed.
        await tx
          .update(installments)
          .set({ status: "RESERVED" })
          .where(and(inArray(installments.id, coverage.ids), eq(installments.status, "PENDING")));
      }

      await logAction(u, autoConfirm ? "payment.record" : "payment.submit_receipt", "payment", p.id, {
        contractId: contract.id,
        amount: v.amount,
        method: v.method,
        installments: coverage.lines.length,
        settle: v.settle,
      }, tx);
      return p.id;
    });

    const [customer] = await db.select().from(customers).where(eq(customers.id, contract.customerId)).limit(1);
    if (customer) {
      const smsVars = { customer: customer.fullName, amount: v.amount.toLocaleString("en-US"), contractNo: contract.contractNo };
      await sendTemplateSms({
        key: autoConfirm ? "payment_recorded" : "receipt_submitted",
        vars: smsVars,
        customerId: customer.id,
        phone: customer.mobile,
        fallback: autoConfirm
          ? `${smsVars.customer} گرامی، پرداخت ${smsVars.amount} تومانی شما برای قرارداد ${contract.contractNo} با موفقیت ثبت شد.`
          : `${smsVars.customer} گرامی، فیش پرداخت شما برای قرارداد ${contract.contractNo} دریافت و در صف بررسی قرار گرفت.`,
      });
    }

    revalidatePaymentPaths(contract.id, contract.customerId);
    return { ok: true, data: { id: paymentId } };
  } catch (e) {
    if (isUnique(e)) {
      return {
        ok: false,
        error:
          "تداخل در ثبت پرداخت: یکی از اقساط هم‌اکنون توسط پرداخت دیگری پوشش داده شده است. صفحه را تازه‌سازی کنید.",
      };
    }
    return fail(e);
  }
}

export async function reviewPayment(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN", "OPERATOR"]);
    if (!canReviewPayments(u as SessionUser)) throw new Error("مجوز بررسی و تأیید پرداخت برای شما فعال نیست");
    const v = reviewSchema.parse(raw);
    if (!v.approve && (!v.reviewNote || v.reviewNote.trim().length < 3)) {
      throw new Error("برای رد پرداخت، ذکر دلیل الزامی است");
    }

    const [p] = await db.select().from(payments).where(eq(payments.id, v.paymentId)).limit(1);
    if (!p) throw new Error("پرداخت یافت نشد");
    if (p.status !== "PENDING_VERIFICATION") throw new Error("این پرداخت قبلاً بررسی شده است");

    await db.transaction(async (tx) => {
      const updated = await tx
        .update(payments)
        .set({
          status: v.approve ? "CONFIRMED" : "REJECTED",
          reviewedBy: u.id,
          reviewedAt: new Date(),
          reviewNote: v.reviewNote || null,
          // Approval fixes the effective payment date if the submitter omitted it.
          ...(v.approve && !p.paidAt ? { paidAt: new Date() } : {}),
          // A rejection can be resubmitted by the customer.
          isResubmittable: !v.approve,
        })
        .where(and(eq(payments.id, p.id), eq(payments.status, "PENDING_VERIFICATION")));
      if (updated[0].affectedRows === 0) throw new Error("این پرداخت هم‌اکنون توسط کاربر دیگری بررسی شد");

      if (v.approve) {
        const links = await tx.select().from(paymentInstallments).where(eq(paymentInstallments.paymentId, p.id));
        if (links.length > 0) {
          await tx
            .update(installments)
            .set({ paidAt: new Date(), paymentId: p.id, status: "PAID" })
            .where(and(inArray(installments.id, links.map((l) => l.installmentId)), isNull(installments.paidAt)));
        }
        await settleIfComplete(tx, p.contractId);
      } else {
        // Rejection releases the reserved installments so they can be paid again.
        const links = await tx.select({ installmentId: paymentInstallments.installmentId }).from(paymentInstallments).where(eq(paymentInstallments.paymentId, p.id));
        if (links.length > 0) {
          await tx
            .update(installments)
            .set({ status: "PENDING" })
            .where(and(inArray(installments.id, links.map((l) => l.installmentId)), eq(installments.status, "RESERVED")));
        }
        await tx.delete(paymentInstallments).where(eq(paymentInstallments.paymentId, p.id));
      }

      await logAction(u, v.approve ? "payment.approve" : "payment.reject", "payment", p.id, { reviewNote: v.reviewNote }, tx);
    });

    const [customer] = await db.select().from(customers).where(eq(customers.id, p.customerId)).limit(1);
    const [contract] = await db.select().from(contracts).where(eq(contracts.id, p.contractId)).limit(1);
    if (customer && contract) {
      const smsVars = {
        customer: customer.fullName,
        amount: p.amount.toLocaleString("en-US"),
        contractNo: contract.contractNo,
        reason: v.reviewNote ?? "",
      };
      await sendTemplateSms({
        key: v.approve ? "receipt_approved" : "receipt_rejected",
        vars: smsVars,
        customerId: customer.id,
        phone: customer.mobile,
        fallback: v.approve
          ? `${smsVars.customer} گرامی، پرداخت ${smsVars.amount} تومانی شما برای قرارداد ${contract.contractNo} تأیید شد.`
          : `${smsVars.customer} گرامی، فیش پرداخت شما برای قرارداد ${contract.contractNo} تأیید نشد. دلیل: ${v.reviewNote}`,
      });
    }

    revalidatePaymentPaths(p.contractId, p.customerId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Rejected card-to-card receipts the requester may resubmit. */
export async function listResubmittable(contractId?: string): Promise<Result<{ id: string; referenceNo: string | null; reviewNote: string | null; amount: number }[]>> {
  try {
    const u = await requireActionUser();
    const conds = [eq(payments.method, "CARD_TO_CARD"), eq(payments.status, "REJECTED"), eq(payments.isResubmittable, true)];
    if (u.role === "CUSTOMER") {
      if (!u.customerId) return { ok: true, data: [] };
      conds.push(eq(payments.customerId, u.customerId));
    }
    if (contractId) conds.push(eq(payments.contractId, contractId));
    const rows = await db
      .select({ id: payments.id, referenceNo: payments.referenceNo, reviewNote: payments.reviewNote, amount: payments.amount })
      .from(payments)
      .where(and(...conds))
      .orderBy(payments.reviewedAt);
    return { ok: true, data: rows };
  } catch (e) {
    return fail(e);
  }
}

export async function forgivePenalty(raw: unknown): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN"]);
    const v = forgivePenaltySchema.parse(raw);

    const [inst] = await db.select().from(installments).where(eq(installments.id, v.installmentId)).limit(1);
    if (!inst) throw new Error("قسط یافت نشد");
    if (inst.paidAt) throw new Error("قسط پرداخت‌شده جریمه‌ای ندارد");
    if (inst.status === "RESERVED") throw new Error("فیش این قسط در حال بررسی است؛ بخشودگی پس از نتیجه بررسی انجام می‌شود");
    if (inst.penaltyForgiven) throw new Error("جریمه این قسط قبلاً بخشوده شده است");

    const finance = await getFinanceSettings();
    const { penalty } = computePenalty(inst.amount, inst.dueDate, todayGreg(), finance, false);
    if (penalty <= 0) throw new Error("برای این قسط جریمه‌ای محاسبه نشده است");

    await db.transaction(async (tx) => {
      await tx
        .update(installments)
        .set({
          penaltyForgiven: true,
          forgivenAmount: penalty,
          forgivenBy: u.id,
          forgivenAt: new Date(),
          forgivenReason: v.reason,
        })
        .where(eq(installments.id, inst.id));
      await logAction(u, "penalty.forgive", "installment", inst.id, { amount: penalty, reason: v.reason }, tx);
    });

    revalidatePath(`/contracts/${inst.contractId}`);
    revalidatePath("/");
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function sendReminder(installmentId: string): Promise<Result> {
  try {
    const u = await requireActionUser(["ADMIN", "OPERATOR"]);
    const rows = await db
      .select({ inst: installments, contract: contracts, customer: customers })
      .from(installments)
      .innerJoin(contracts, eq(contracts.id, installments.contractId))
      .innerJoin(customers, eq(customers.id, contracts.customerId))
      .where(eq(installments.id, installmentId))
      .limit(1);
    const r = rows[0];
    if (!r) throw new Error("قسط یافت نشد");
    if (r.inst.paidAt) throw new Error("این قسط پرداخت شده است");
    if (r.inst.status === "RESERVED") throw new Error("فیش این قسط در حال بررسی است؛ یادآوری لازم نیست");

    const status = await sendTemplateSms({
      key: "overdue_reminder",
      vars: {
        customer: r.customer.fullName,
        seq: r.inst.seq,
        contractNo: r.contract.contractNo,
        amount: r.inst.amount.toLocaleString("en-US"),
        dueDate: formatJalali(r.inst.dueDate),
      },
      customerId: r.customer.id,
      phone: r.customer.mobile,
      fallback: `${r.customer.fullName} گرامی، قسط شماره ${r.inst.seq} قرارداد ${r.contract.contractNo} به مبلغ ${r.inst.amount.toLocaleString("en-US")} تومان در تاریخ ${formatJalali(r.inst.dueDate)} سررسیده است. لطفاً جهت پرداخت اقدام فرمایید.`,
    });
    await logAction(u, "sms.reminder", "installment", installmentId, { status });
    return { ok: true, data: undefined };
  } catch (e) {
    return fail(e);
  }
}
