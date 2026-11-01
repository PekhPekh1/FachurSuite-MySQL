import { Router, type Response } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { audit, requestSecurityMeta } from "../security/audit";
import { asyncRoute, HttpError } from "../security/errors";
import { authenticate, authorize, type AuthRequest } from "../security/middleware";
import {
  computePenalty,
  defaultFinance,
  deriveInstallmentStatus,
  settlementBreakdown,
  toIsoDate,
  todayTehran,
  type FinanceSettings,
} from "../installment/penalty";

export const installmentRouter = Router();
installmentRouter.use(authenticate);

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["ALL", "PENDING", "UPCOMING", "OVERDUE", "PAID", "FORGIVEN", "RESERVED"]).default("ALL"),
  contractId: z.string().uuid().optional(),
  customerId: z.string().uuid().optional(),
});
const dueDateSchema = z
  .object({
    dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "تاریخ نامعتبر است"),
    reason: z.string().trim().min(3, "دلیل تغییر سررسید الزامی است").max(300),
  })
  .strict();
const reasonSchema = z.object({ reason: z.string().trim().min(3, "ذکر دلیل الزامی است").max(300) }).strict();
const settlementSchema = z.object({ waivePenalties: z.coerce.boolean().default(false) }).strict();

async function financeSettings(): Promise<FinanceSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "finance" } });
  return { ...defaultFinance, ...((row?.value as Partial<FinanceSettings>) ?? {}) };
}

/* --------------------------------- Listing -------------------------------- */

installmentRouter.get(
  "/installments",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req, res) => {
    const query = listSchema.parse(req.query);
    const today = todayTehran();
    const finance = await financeSettings();

    const where: Prisma.InstallmentWhereInput = {};
    if (query.contractId) where.contractId = query.contractId;
    if (query.customerId) where.contract = { customerId: query.customerId };
    if (query.status === "PAID" || query.status === "FORGIVEN" || query.status === "RESERVED") where.status = query.status;
    if (query.status === "OVERDUE") {
      where.status = "PENDING";
      where.dueDate = { lt: new Date(`${today}T00:00:00Z`) };
    }
    if (query.status === "UPCOMING" || query.status === "PENDING") {
      where.status = "PENDING";
      if (query.status === "UPCOMING") where.dueDate = { gte: new Date(`${today}T00:00:00Z`) };
    }

    const [rows, total] = await prisma.$transaction([
      prisma.installment.findMany({
        where,
        orderBy: { dueDate: "asc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: { contract: { select: { id: true, contractNo: true, customer: { select: { id: true, fullName: true } } } } },
      }),
      prisma.installment.count({ where }),
    ]);

    const items = rows.map((row) => {
      const dueDate = toIsoDate(row.dueDate);
      const display = deriveInstallmentStatus(row.status, dueDate, today);
      const penalty =
        display === "OVERDUE" ? computePenalty(Number(row.amount), dueDate, today, finance, row.penaltyForgiven) : null;
      return {
        id: row.id,
        seq: row.seq,
        dueDate,
        originalDueDate: row.originalDueDate ? toIsoDate(row.originalDueDate) : null,
        amount: row.amount.toString(),
        status: display,
        storedStatus: row.status,
        penalty: penalty?.penalty ?? 0,
        daysLate: penalty?.daysLate ?? 0,
        penaltyForgiven: row.penaltyForgiven,
        contract: row.contract,
      };
    });

    res.json({ ok: true, items, pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) } });
  }),
);

/* ---------------------------- Due-date management --------------------------- */

installmentRouter.patch(
  "/installments/:id/due-date",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = dueDateSchema.parse(req.body);
    const inst = await prisma.installment.findUnique({ where: { id: req.params.id }, include: { contract: true } });
    if (!inst) throw new HttpError(404, "قسط یافت نشد", "NOT_FOUND");
    if (inst.status === "PAID") throw new HttpError(409, "قسط پرداخت‌شده قابل تغییر نیست", "INSTALLMENT_PAID");
    if (inst.status === "FORGIVEN") throw new HttpError(409, "قسط بخشوده‌شده قابل تغییر نیست", "INSTALLMENT_FORGIVEN");
    if (inst.status === "RESERVED") throw new HttpError(409, "فیش این قسط در حال بررسی است", "INSTALLMENT_RESERVED");
    if (inst.contract.status !== "ACTIVE") throw new HttpError(409, "فقط اقساط قرارداد فعال قابل تغییر هستند", "CONTRACT_NOT_ACTIVE");

    const from = toIsoDate(inst.dueDate);
    if (from === input.dueDate) throw new HttpError(400, "تاریخ جدید با سررسید فعلی یکسان است", "NO_CHANGE");

    await prisma.installment.update({
      where: { id: inst.id },
      data: {
        dueDate: new Date(`${input.dueDate}T00:00:00Z`),
        originalDueDate: inst.originalDueDate ?? inst.dueDate,
        dueDateChangedBy: req.auth!.id,
        dueDateChangedAt: new Date(),
        dueDateChangeReason: input.reason,
      },
    });
    await audit(req.auth!, "installment.due_date_change", "installment", inst.id, {
      ...requestSecurityMeta(req),
      contractId: inst.contractId,
      seq: inst.seq,
      from,
      to: input.dueDate,
      reason: input.reason,
    });
    logger.info({ installmentId: inst.id, from, to: input.dueDate }, "installment due date changed");
    res.json({ ok: true });
  }),
);

/* ------------------------------- Forgiveness ------------------------------- */

installmentRouter.post(
  "/installments/:id/forgive-penalty",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = reasonSchema.parse(req.body);
    const inst = await prisma.installment.findUnique({ where: { id: req.params.id } });
    if (!inst) throw new HttpError(404, "قسط یافت نشد", "NOT_FOUND");
    if (inst.status !== "PENDING") throw new HttpError(409, "فقط قسط پرداخت‌نشده جریمه دارد", "INSTALLMENT_NOT_PENDING");
    if (inst.penaltyForgiven) throw new HttpError(409, "جریمه این قسط قبلاً بخشوده شده است", "ALREADY_FORGIVEN");

    const finance = await financeSettings();
    const { penalty } = computePenalty(Number(inst.amount), toIsoDate(inst.dueDate), todayTehran(), finance, false);
    if (penalty <= 0) throw new HttpError(409, "برای این قسط جریمه‌ای محاسبه نشده است", "NO_PENALTY");

    await prisma.installment.update({
      where: { id: inst.id },
      data: { penaltyForgiven: true, forgivenAmount: penalty, forgivenBy: req.auth!.id, forgivenAt: new Date(), forgivenReason: input.reason },
    });
    await audit(req.auth!, "penalty.forgive", "installment", inst.id, { ...requestSecurityMeta(req), amount: penalty, reason: input.reason });
    res.json({ ok: true, forgivenAmount: penalty });
  }),
);

installmentRouter.post(
  "/installments/:id/forgive",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = reasonSchema.parse(req.body);
    const inst = await prisma.installment.findUnique({ where: { id: req.params.id } });
    if (!inst) throw new HttpError(404, "قسط یافت نشد", "NOT_FOUND");
    if (inst.status !== "PENDING") throw new HttpError(409, "فقط قسط پرداخت‌نشده قابل بخشودگی است", "INSTALLMENT_NOT_PENDING");

    const finance = await financeSettings();
    const { penalty } = computePenalty(Number(inst.amount), toIsoDate(inst.dueDate), todayTehran(), finance, inst.penaltyForgiven);
    const waived = Number(inst.amount) + penalty;

    await prisma.$transaction(async (tx) => {
      const changed = await tx.installment.updateMany({
        where: { id: inst.id, status: "PENDING" },
        data: {
          status: "FORGIVEN",
          penaltyForgiven: true,
          forgivenAmount: waived,
          forgivenBy: req.auth!.id,
          forgivenAt: new Date(),
          forgivenReason: input.reason,
        },
      });
      if (changed.count !== 1) throw new HttpError(409, "وضعیت قسط هم‌اکنون تغییر کرد", "CONFLICT");
      const remaining = await tx.installment.count({ where: { contractId: inst.contractId, status: { in: ["PENDING", "RESERVED"] } } });
      if (remaining === 0) await tx.contract.update({ where: { id: inst.contractId }, data: { status: "SETTLED" } });
    });

    await audit(req.auth!, "installment.forgive", "installment", inst.id, {
      ...requestSecurityMeta(req),
      contractId: inst.contractId,
      principal: Number(inst.amount),
      penalty,
      reason: input.reason,
    });
    res.json({ ok: true, forgivenAmount: waived });
  }),
);

/* ----------------------------- Early settlement ---------------------------- */

installmentRouter.post(
  "/contracts/:id/settlement/quote",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = settlementSchema.parse(req.body ?? {});
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { installments: { where: { status: "PENDING" }, orderBy: { seq: "asc" } }, customer: { select: { id: true, fullName: true } } },
    });
    if (!contract) throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    if (req.auth!.role === "CUSTOMER" && req.auth!.customerId !== contract.customerId) {
      throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    }
    if (contract.installments.length === 0) throw new HttpError(409, "قسط پرداخت‌نشده‌ای برای تسویه وجود ندارد", "NOTHING_TO_SETTLE");

    const today = todayTehran();
    const finance = await financeSettings();
    // Customers may never price a waived settlement for themselves.
    const waive = input.waivePenalties && req.auth!.role !== "CUSTOMER";
    const breakdown = settlementBreakdown(
      contract.installments.map((i) => ({
        id: i.id,
        seq: i.seq,
        dueDate: toIsoDate(i.dueDate),
        amount: Number(i.amount),
        penaltyForgiven: i.penaltyForgiven,
      })),
      today,
      finance,
      waive,
    );

    res.json({
      ok: true,
      contractNo: contract.contractNo,
      customer: contract.customer,
      calculatedAt: today,
      waivePenalties: waive,
      ...breakdown,
    });
  }),
);

/**
 * Process an early settlement inside one transaction: every remaining PENDING
 * installment is paid, the penalty total is recorded on the payment, and the
 * contract is completed. No interest is ever derived.
 */
installmentRouter.post(
  "/contracts/:id/settlement",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const body = z
      .object({
        method: z.enum(["CASH", "CARD_READER", "CARD_TO_CARD"]).default("CASH"),
        waivePenalties: z.coerce.boolean().default(false),
        referenceNo: z.string().trim().max(80).optional().nullable(),
        idempotencyKey: z.string().trim().min(8).max(64),
      })
      .strict()
      .parse(req.body);

    const existing = await prisma.payment.findUnique({ where: { idempotencyKey: body.idempotencyKey }, select: { id: true } });
    if (existing) {
      res.json({ ok: true, payment: existing, duplicate: true });
      return;
    }

    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: { installments: { where: { status: "PENDING" }, orderBy: { seq: "asc" } } },
    });
    if (!contract) throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    if (contract.status !== "ACTIVE") throw new HttpError(409, "فقط قرارداد فعال قابل تسویه است", "CONTRACT_NOT_ACTIVE");
    if (contract.installments.length === 0) throw new HttpError(409, "قسط پرداخت‌نشده‌ای برای تسویه وجود ندارد", "NOTHING_TO_SETTLE");

    const today = todayTehran();
    const finance = await financeSettings();
    const waive = body.waivePenalties;
    if (waive && req.auth!.role !== "ADMIN") throw new HttpError(403, "بخشودگی جریمه فقط توسط مدیر مجاز است", "FORBIDDEN");

    const breakdown = settlementBreakdown(
      contract.installments.map((i) => ({
        id: i.id,
        seq: i.seq,
        dueDate: toIsoDate(i.dueDate),
        amount: Number(i.amount),
        penaltyForgiven: i.penaltyForgiven,
      })),
      today,
      finance,
      waive,
    );

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          idempotencyKey: body.idempotencyKey,
          contractId: contract.id,
          customerId: contract.customerId,
          amount: breakdown.grandTotal,
          penaltyAmount: breakdown.penaltyTotal,
          method: body.method,
          status: "CONFIRMED",
          referenceNo: body.referenceNo || null,
          isSettlement: true,
          settlementMeta: { lines: breakdown.lines, calculatedAt: today, waivePenalties: waive },
          submittedBy: req.auth!.id,
          reviewedBy: req.auth!.id,
          reviewedAt: new Date(),
        },
        select: { id: true },
      });

      const ids = contract.installments.map((i) => i.id);
      // Guarded: only rows still PENDING are settled, so a concurrent payment
      // cannot be overwritten.
      const changed = await tx.installment.updateMany({
        where: { id: { in: ids }, status: "PENDING" },
        data: { status: "PAID", paidAt: new Date(), paymentId: created.id },
      });
      if (changed.count !== ids.length) throw new HttpError(409, "وضعیت اقساط هم‌اکنون تغییر کرد؛ دوباره تلاش کنید", "CONFLICT");

      await tx.paymentInstallment.createMany({ data: ids.map((installmentId) => ({ paymentId: created.id, installmentId })) });

      const remaining = await tx.installment.count({ where: { contractId: contract.id, status: { in: ["PENDING", "RESERVED"] } } });
      if (remaining === 0) await tx.contract.update({ where: { id: contract.id }, data: { status: "SETTLED" } });
      return created;
    });

    await audit(req.auth!, "contract.settlement", "contract", contract.id, {
      ...requestSecurityMeta(req),
      paymentId: payment.id,
      principal: breakdown.principalTotal,
      penalty: breakdown.penaltyTotal,
      forgivenPenalty: breakdown.forgivenPenaltyTotal,
      total: breakdown.grandTotal,
      installments: breakdown.lines.length,
    });
    logger.info({ contractId: contract.id, paymentId: payment.id, total: breakdown.grandTotal }, "contract settled early");
    res.status(201).json({ ok: true, payment, settlement: breakdown });
  }),
);
