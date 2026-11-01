import { Router, type Response } from "express";
import { z } from "zod";
import { prisma } from "../db";
import { logger } from "../logger";
import { audit, requestSecurityMeta } from "../security/audit";
import { asyncRoute, HttpError } from "../security/errors";
import { authenticate, authorize, type AuthRequest } from "../security/middleware";
import { computePenalty, defaultFinance, settlementBreakdown, toIsoDate, todayTehran, type FinanceSettings } from "../installment/penalty";

export const paymentRouter = Router();
paymentRouter.use(authenticate);

const FA = "۰۱۲۳۴۵۶۷۸۹";
const digits = (v: string) => v.replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)));
const money = z.coerce.number().int().min(1, "مبلغ باید بزرگ‌تر از صفر باشد").max(900_000_000_000_000);

export const paymentCreateSchema = z
  .object({
    contractId: z.string().uuid(),
    installmentIds: z.array(z.string().uuid()).min(1, "حداقل یک قسط انتخاب کنید"),
    method: z.enum(["CASH", "CARD_READER", "CARD_TO_CARD"]),
    amount: money,
    paidAt: z.string().datetime({ offset: true }).optional().nullable(),
    sourceCardNumber: z
      .string()
      .transform(digits)
      .refine((v) => !v || /^[0-9]{16}$/.test(v), "شماره کارت مبدأ باید ۱۶ رقم باشد")
      .optional()
      .nullable(),
    referenceNo: z.string().trim().max(80).optional().nullable(),
    note: z.string().trim().max(300).optional().nullable(),
    receiptDocumentId: z.string().uuid().optional().nullable(),
    idempotencyKey: z.string().trim().min(8).max(64),
    settle: z.coerce.boolean().default(false),
    waivePenalties: z.coerce.boolean().default(false),
    resubmissionOf: z.string().uuid().optional().nullable(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.method === "CARD_TO_CARD") {
      if (!v.referenceNo || v.referenceNo.trim().length < 3) {
        ctx.addIssue({ code: "custom", path: ["referenceNo"], message: "شماره پیگیری فیش الزامی است" });
      }
      if (!v.sourceCardNumber) {
        ctx.addIssue({ code: "custom", path: ["sourceCardNumber"], message: "شماره کارت مبدأ الزامی است" });
      }
    }
  });

const reviewSchema = z
  .object({ approve: z.boolean(), reviewNote: z.string().trim().max(300).optional().nullable() })
  .strict()
  .superRefine((v, ctx) => {
    if (!v.approve && (!v.reviewNote || v.reviewNote.trim().length < 3)) {
      ctx.addIssue({ code: "custom", path: ["reviewNote"], message: "برای رد فیش، ذکر دلیل الزامی است" });
    }
  });

const listSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(["PENDING_VERIFICATION", "CONFIRMED", "REJECTED"]).optional(),
  method: z.enum(["CASH", "CARD_READER", "CARD_TO_CARD"]).optional(),
  contractId: z.string().uuid().optional(),
});

async function finance(): Promise<FinanceSettings> {
  const row = await prisma.setting.findUnique({ where: { key: "finance" } });
  return { ...defaultFinance, ...((row?.value as Partial<FinanceSettings>) ?? {}) };
}

async function settleIfComplete(tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0], contractId: string) {
  const remaining = await tx.installment.count({ where: { contractId, status: { in: ["PENDING", "RESERVED"] } } });
  if (remaining === 0) await tx.contract.update({ where: { id: contractId }, data: { status: "SETTLED" } });
}

const serializePayment = <T extends Record<string, unknown>>(p: T) =>
  Object.fromEntries(Object.entries(p).map(([k, v]) => [k, typeof v === "bigint" ? v.toString() : v]));

/* ---------------------------------- Create --------------------------------- */

paymentRouter.post(
  "/payments",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = paymentCreateSchema.parse(req.body);
    const actor = req.auth!;

    if (actor.role === "CUSTOMER" && input.method !== "CARD_TO_CARD") {
      throw new HttpError(403, "مشتری فقط می‌تواند فیش کارت‌به‌کارت ثبت کند", "FORBIDDEN");
    }
    if (actor.role === "CUSTOMER" && (input.waivePenalties || input.settle)) {
      throw new HttpError(403, "این عملیات فقط توسط کارکنان مجاز است", "FORBIDDEN");
    }

    const existing = await prisma.payment.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    if (existing) {
      res.json({ ok: true, payment: existing, duplicate: true });
      return;
    }

    const contract = await prisma.contract.findUnique({ where: { id: input.contractId }, include: { installments: { orderBy: { seq: "asc" } } } });
    if (!contract) throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    if (actor.role === "CUSTOMER" && contract.customerId !== actor.customerId) {
      throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    }
    if (contract.status !== "ACTIVE") throw new HttpError(409, "این قرارداد فعال نیست", "CONTRACT_NOT_ACTIVE");

    if (input.resubmissionOf) {
      const prior = await prisma.payment.findUnique({ where: { id: input.resubmissionOf } });
      if (!prior || prior.status !== "REJECTED" || prior.contractId !== contract.id) {
        throw new HttpError(409, "فقط فیش ردشده همان قرارداد قابل ارسال مجدد است", "INVALID_RESUBMISSION");
      }
    }

    // Only PENDING installments are eligible, and they must be consecutive from the oldest.
    const payable = contract.installments.filter((i) => i.status === "PENDING");
    if (payable.length === 0) throw new HttpError(409, "قسط پرداخت‌نشده‌ای وجود ندارد", "NOTHING_PAYABLE");

    let wanted = payable;
    if (!input.settle) {
      const set = new Set(input.installmentIds);
      const picked = payable.filter((i) => set.has(i.id));
      if (picked.length !== input.installmentIds.length) {
        throw new HttpError(400, "اقساط انتخاب‌شده معتبر نیستند", "INVALID_INSTALLMENTS");
      }
      const firstN = payable.slice(0, picked.length);
      if (!firstN.every((f, idx) => f.id === picked[idx].id)) {
        throw new HttpError(400, "اقساط باید به ترتیب و متوالی پرداخت شوند", "NON_CONSECUTIVE");
      }
      wanted = picked;
    }

    const today = todayTehran();
    const settings = await finance();
    const breakdown = settlementBreakdown(
      wanted.map((i) => ({ id: i.id, seq: i.seq, dueDate: toIsoDate(i.dueDate), amount: Number(i.amount), penaltyForgiven: i.penaltyForgiven })),
      today,
      settings,
      input.waivePenalties,
    );

    // Backend amount validation: the payment must exactly equal the obligation.
    if (breakdown.grandTotal !== input.amount) {
      throw new HttpError(
        422,
        `مبلغ واردشده با جمع اقساط و جریمه‌ها مطابقت ندارد. مبلغ صحیح: ${breakdown.grandTotal.toLocaleString("en-US")} تومان`,
        "AMOUNT_MISMATCH",
      );
    }

    const requiresVerification = input.method === "CARD_TO_CARD";
    const paidAt = input.paidAt ? new Date(input.paidAt) : requiresVerification ? null : new Date();

    const payment = await prisma.$transaction(async (tx) => {
      const created = await tx.payment.create({
        data: {
          idempotencyKey: input.idempotencyKey,
          contractId: contract.id,
          customerId: contract.customerId,
          amount: input.amount,
          penaltyAmount: breakdown.penaltyTotal,
          method: input.method,
          status: requiresVerification ? "PENDING_VERIFICATION" : "CONFIRMED",
          sourceCardNumber: input.sourceCardNumber || null,
          referenceNo: input.referenceNo || null,
          note: input.note || null,
          paidAt,
          receiptDocumentId: input.receiptDocumentId ?? null,
          isSettlement: input.settle,
          settlementMeta: input.settle ? { lines: breakdown.lines, calculatedAt: today } : undefined,
          resubmissionOf: input.resubmissionOf ?? null,
          submittedBy: actor.id,
          reviewedBy: requiresVerification ? null : actor.id,
          reviewedAt: requiresVerification ? null : new Date(),
        },
        select: { id: true },
      });

      // Unique installment_id prevents a double payment even under concurrency.
      await tx.paymentInstallment.createMany({ data: wanted.map((i) => ({ paymentId: created.id, installmentId: i.id })) });

      if (requiresVerification) {
        // A submitted receipt never marks an installment as paid — only RESERVED.
        await tx.installment.updateMany({ where: { id: { in: wanted.map((i) => i.id) }, status: "PENDING" }, data: { status: "RESERVED" } });
      } else {
        await tx.installment.updateMany({ where: { id: { in: wanted.map((i) => i.id) }, status: "PENDING" }, data: { status: "PAID", paidAt: new Date(), paymentId: created.id } });
        await settleIfComplete(tx, contract.id);
      }
      return created;
    });

    await audit(actor, requiresVerification ? "payment.submit_receipt" : "payment.record", "payment", payment.id, {
      ...requestSecurityMeta(req),
      contractId: contract.id,
      method: input.method,
      amount: input.amount,
      installments: wanted.length,
      settle: input.settle,
    });
    logger.info({ paymentId: payment.id, method: input.method }, "payment recorded");
    res.status(requiresVerification ? 202 : 201).json({
      ok: true,
      payment,
      status: requiresVerification ? "PENDING_VERIFICATION" : "CONFIRMED",
    });
  }),
);

/* ---------------------------------- Listing -------------------------------- */

paymentRouter.get(
  "/payments",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req, res) => {
    const query = listSchema.parse(req.query);
    const where: Record<string, unknown> = {};
    if (query.status) where.status = query.status;
    if (query.method) where.method = query.method;
    if (query.contractId) where.contractId = query.contractId;

    const [items, total] = await prisma.$transaction([
      prisma.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          contract: { select: { contractNo: true } },
          customer: { select: { fullName: true, nationalCode: true } },
          reviewer: { select: { fullName: true } },
        },
      }),
      prisma.payment.count({ where }),
    ]);
    res.json({
      ok: true,
      items: items.map((i) => serializePayment(i as unknown as Record<string, unknown>)),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

/* ------------------------------- Verification ------------------------------ */

paymentRouter.post(
  "/payments/:id/verify",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const actor = req.auth!;
    if (actor.role === "OPERATOR" && !actor.canReviewPayments) {
      throw new HttpError(403, "مجوز بررسی پرداخت برای شما فعال نیست", "FORBIDDEN");
    }
    const input = reviewSchema.parse(req.body ?? {});
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: { installmentLinks: { select: { installmentId: true } } },
    });
    if (!payment) throw new HttpError(404, "پرداخت یافت نشد", "NOT_FOUND");
    if (payment.status !== "PENDING_VERIFICATION") throw new HttpError(409, "این پرداخت قبلاً بررسی شده است", "ALREADY_REVIEWED");

    const ids = payment.installmentLinks.map((l) => l.installmentId);
    await prisma.$transaction(async (tx) => {
      // Guarded update — a concurrent review cannot decide twice.
      const changed = await tx.payment.updateMany({
        where: { id: payment.id, status: "PENDING_VERIFICATION" },
        data: {
          status: input.approve ? "CONFIRMED" : "REJECTED",
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: input.reviewNote || null,
          isResubmittable: !input.approve,
          ...(input.approve && !payment.paidAt ? { paidAt: new Date() } : {}),
        },
      });
      if (changed.count !== 1) throw new HttpError(409, "این پرداخت هم‌اکنون بررسی شد", "ALREADY_REVIEWED");

      if (input.approve) {
        await tx.installment.updateMany({ where: { id: { in: ids }, paidAt: null }, data: { status: "PAID", paidAt: new Date(), paymentId: payment.id } });
        await settleIfComplete(tx, payment.contractId);
      } else {
        // Rejection releases the reservation so the installment becomes payable again.
        await tx.installment.updateMany({ where: { id: { in: ids }, status: "RESERVED" }, data: { status: "PENDING" } });
        await tx.paymentInstallment.deleteMany({ where: { paymentId: payment.id } });
      }
    });

    await audit(actor, input.approve ? "payment.approve" : "payment.reject", "payment", payment.id, {
      ...requestSecurityMeta(req),
      reviewNote: input.reviewNote,
    });
    logger.info({ paymentId: payment.id, approved: input.approve }, "payment verified");
    res.json({ ok: true, status: input.approve ? "CONFIRMED" : "REJECTED" });
  }),
);

/* --------------------------------- Receipt -------------------------------- */

paymentRouter.get(
  "/payments/:id/receipt",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const payment = await prisma.payment.findUnique({
      where: { id: req.params.id },
      include: {
        contract: { select: { contractNo: true, itemDescription: true } },
        customer: { select: { fullName: true, nationalCode: true, mobile: true } },
        reviewer: { select: { fullName: true } },
        installmentLinks: { include: { installment: { select: { seq: true, dueDate: true, amount: true } } } },
      },
    });
    if (!payment) throw new HttpError(404, "پرداخت یافت نشد", "NOT_FOUND");
    if (req.auth!.role === "CUSTOMER" && req.auth!.customerId !== payment.customerId) {
      throw new HttpError(404, "پرداخت یافت نشد", "NOT_FOUND");
    }
    if (payment.status !== "CONFIRMED") throw new HttpError(409, "رسید فقط برای پرداخت تأییدشده صادر می‌شود", "NOT_CONFIRMED");

    res.json({
      ok: true,
      receipt: {
        receiptNo: payment.id.slice(0, 8).toUpperCase(),
        contractNo: payment.contract.contractNo,
        customer: payment.customer,
        itemDescription: payment.contract.itemDescription,
        amount: payment.amount.toString(),
        penaltyAmount: payment.penaltyAmount.toString(),
        method: payment.method,
        referenceNo: payment.referenceNo,
        sourceCardNumber: payment.sourceCardNumber
          ? `${payment.sourceCardNumber.slice(0, 4)}-****-****-${payment.sourceCardNumber.slice(12)}`
          : null,
        paidAt: payment.paidAt,
        isSettlement: payment.isSettlement,
        verifiedBy: payment.reviewer?.fullName ?? null,
        verifiedAt: payment.reviewedAt,
        installments: payment.installmentLinks.map((l) => ({
          seq: l.installment.seq,
          dueDate: toIsoDate(l.installment.dueDate),
          amount: l.installment.amount.toString(),
        })),
      },
    });
  }),
);
