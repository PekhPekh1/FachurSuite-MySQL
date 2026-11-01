import { Router, type Response } from "express";
import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { logger } from "../logger";
import { audit, requestSecurityMeta } from "../security/audit";
import { asyncRoute, HttpError } from "../security/errors";
import { authenticate, authorize, type AuthRequest } from "../security/middleware";
import { contractCancelSchema, contractCreateSchema, contractListSchema, contractNotesSchema } from "../contract/schemas";
import { buildInstallmentSchedule, checkContractFinancials, gregToJalali, jalaliYear, todayTehran } from "../contract/schedule";

export const contractRouter = Router();
contractRouter.use(authenticate);

const pad5 = (n: number) => String(n).padStart(5, "0");
const toman = (n: number) => n.toLocaleString("en-US");
const serialize = <T extends Record<string, unknown>>(row: T) =>
  Object.fromEntries(Object.entries(row).map(([k, v]) => [k, typeof v === "object" && v !== null && "toString" in v && v.constructor?.name === "Decimal" ? v.toString() : v]));

function assertOwnContract(req: AuthRequest, customerId: string) {
  if (req.auth?.role === "CUSTOMER" && req.auth.customerId !== customerId) {
    throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
  }
}

/* --------------------------------- Preview -------------------------------- */

contractRouter.post(
  "/contracts/preview",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req, res) => {
    const input = contractCreateSchema.parse(req.body);
    if (input.type === "CASH") {
      res.json({ ok: true, rows: [{ seq: 1, dueDate: todayTehran(), amount: input.cashPrice, clamped: false }], financials: { expectedTotal: input.cashPrice, discrepancy: 0, balanced: true } });
      return;
    }
    const financials = checkContractFinancials(input);
    const rows = buildInstallmentSchedule({
      firstDueDate: input.firstDueDate!,
      paymentDay: input.paymentDay ?? gregToJalali(input.firstDueDate!).jd,
      installmentCount: input.installmentCount,
      installmentAmount: input.installmentAmount,
      lastInstallmentAdjustment: input.overrideDiscrepancy ? financials.discrepancy : 0,
    });
    res.json({ ok: true, rows, financials });
  }),
);

/* ------------------------------- List / search ------------------------------ */

contractRouter.get(
  "/contracts",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req, res) => {
    const query = contractListSchema.parse(req.query);
    const where: Prisma.ContractWhereInput = {};
    if (query.status) where.status = query.status;
    if (query.type) where.type = query.type;
    if (query.customerId) where.customerId = query.customerId;
    if (query.from || query.to) {
      where.createdAt = {
        ...(query.from ? { gte: new Date(`${query.from}T00:00:00+03:30`) } : {}),
        ...(query.to ? { lte: new Date(`${query.to}T23:59:59+03:30`) } : {}),
      };
    }
    if (query.q) {
      where.OR = [
        { contractNo: { contains: query.q, mode: "insensitive" } },
        { itemDescription: { contains: query.q, mode: "insensitive" } },
        { itemSerialNumber: { contains: query.q, mode: "insensitive" } },
        { customer: { fullName: { contains: query.q, mode: "insensitive" } } },
        { customer: { nationalCode: { contains: query.q } } },
      ];
    }

    const [items, total] = await prisma.$transaction([
      prisma.contract.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          contractNo: true,
          type: true,
          status: true,
          totalPrice: true,
          installmentCount: true,
          itemDescription: true,
          itemSerialNumber: true,
          createdAt: true,
          customer: { select: { id: true, fullName: true, nationalCode: true } },
        },
      }),
      prisma.contract.count({ where }),
    ]);

    res.json({
      ok: true,
      items: items.map((item) => ({ ...item, totalPrice: item.totalPrice.toString() })),
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

/* --------------------------------- Detail --------------------------------- */

contractRouter.get(
  "/contracts/:id",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const contract = await prisma.contract.findUnique({
      where: { id: req.params.id },
      include: {
        customer: { select: { id: true, fullName: true, nationalCode: true, mobile: true } },
        guarantor: { select: { id: true, fullName: true, mobile: true } },
        installments: { orderBy: { seq: "asc" } },
      },
    });
    if (!contract) throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    assertOwnContract(req, contract.customerId);

    const confirmed = await prisma.payment.aggregate({
      where: { contractId: contract.id, status: "CONFIRMED" },
      _sum: { amount: true },
      _count: true,
    });
    const paidInstallments = contract.installments.filter((i) => i.status === "PAID").length;

    res.json({
      ok: true,
      contract: {
        ...serialize(contract as unknown as Record<string, unknown>),
        installments: contract.installments.map((i) => ({ ...i, amount: i.amount.toString(), forgivenAmount: i.forgivenAmount.toString() })),
      },
      payment: {
        confirmedCount: confirmed._count,
        confirmedAmount: confirmed._sum.amount?.toString() ?? "0",
        paidInstallments,
        totalInstallments: contract.installments.length,
        // A cash contract counts as paid only when its installment is settled.
        isFullyPaid: contract.installments.length > 0 && paidInstallments === contract.installments.length,
      },
    });
  }),
);

/* --------------------------------- Create --------------------------------- */

contractRouter.post(
  "/contracts",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = contractCreateSchema.parse(req.body);
    const actor = req.auth!;

    if (input.idempotencyKey) {
      const existing = await prisma.contract.findUnique({
        where: { idempotencyKey: input.idempotencyKey },
        select: { id: true, contractNo: true },
      });
      if (existing) {
        res.status(200).json({ ok: true, contract: existing, duplicate: true });
        return;
      }
    }

    const customer = await prisma.customer.findUnique({ where: { id: input.customerId } });
    if (!customer) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
    if (!customer.isActive) throw new HttpError(400, "پرونده این مشتری غیرفعال است", "CUSTOMER_INACTIVE");
    if (customer.isBlacklisted) throw new HttpError(400, "این مشتری در فهرست سیاه است", "CUSTOMER_BLACKLISTED");

    if (input.guarantorId) {
      const guarantor = await prisma.guarantor.findUnique({ where: { id: input.guarantorId } });
      if (!guarantor || guarantor.customerId !== customer.id) throw new HttpError(400, "ضامن متعلق به این مشتری نیست", "GUARANTOR_MISMATCH");
      if (!guarantor.isActive) throw new HttpError(400, "ضامن انتخاب‌شده غیرفعال است", "GUARANTOR_INACTIVE");
    }

    const today = todayTehran();
    let discrepancy = 0;
    let paymentDay: number | null = null;
    let schedule = [{ seq: 1, dueDate: today, amount: input.cashPrice, clamped: false }];
    let firstDue = today;

    if (input.type === "INSTALLMENT") {
      firstDue = input.firstDueDate!;
      paymentDay = input.paymentDay ?? gregToJalali(firstDue).jd;
      const financials = checkContractFinancials(input);
      discrepancy = financials.discrepancy;
      if (!financials.balanced && !input.overrideDiscrepancy) {
        throw new HttpError(
          422,
          `مغایرت مالی: پیش‌پرداخت + مجموع اقساط ${toman(financials.expectedTotal)} تومان است و با مبلغ کل ${toman(input.totalPrice)} تومان ${toman(Math.abs(discrepancy))} تومان اختلاف دارد.`,
          "FINANCIAL_DISCREPANCY",
        );
      }
      schedule = buildInstallmentSchedule({
        firstDueDate: firstDue,
        paymentDay,
        installmentCount: input.installmentCount,
        installmentAmount: input.installmentAmount,
        lastInstallmentAdjustment: input.overrideDiscrepancy ? discrepancy : 0,
      });
      if (schedule[schedule.length - 1].amount <= 0) throw new HttpError(422, "مبلغ قسط آخر صفر یا منفی می‌شود", "INVALID_LAST_INSTALLMENT");
    }

    const overrideApplied = input.type === "INSTALLMENT" && input.overrideDiscrepancy && discrepancy !== 0;
    const created = await prisma.$transaction(async (tx) => {
      // Atomic allocation: concurrent requests serialize on this counter row.
      const counter = await tx.counter.upsert({
        where: { key: "contract" },
        create: { key: "contract", value: 1 },
        update: { value: { increment: 1 } },
      });
      const contractNo = `${input.type === "CASH" ? "CSH" : "INS"}-${jalaliYear(today)}-${pad5(Number(counter.value))}`;
      const contract = await tx.contract.create({
        data: {
          contractNo,
          type: input.type,
          customerId: customer.id,
          guarantorId: input.guarantorId ?? null,
          itemDescription: input.itemDescription,
          itemSerialNumber: input.itemSerialNumber || null,
          notes: input.notes || null,
          cashPrice: input.cashPrice,
          totalPrice: input.totalPrice,
          downPayment: input.type === "CASH" ? 0 : input.downPayment,
          installmentCount: input.type === "CASH" ? 1 : input.installmentCount,
          installmentAmount: input.type === "CASH" ? input.cashPrice : input.installmentAmount,
          discrepancy,
          discrepancyOverride: overrideApplied,
          discrepancyOverrideBy: overrideApplied ? actor.id : null,
          discrepancyOverrideReason: overrideApplied ? input.overrideReason || null : null,
          firstDueDate: new Date(`${firstDue}T00:00:00Z`),
          paymentDay,
          idempotencyKey: input.idempotencyKey || null,
          createdBy: actor.id,
          installments: {
            create: schedule.map((row) => ({ seq: row.seq, dueDate: new Date(`${row.dueDate}T00:00:00Z`), amount: row.amount })),
          },
        },
        select: { id: true, contractNo: true },
      });
      return contract;
    });

    await audit(actor, "contract.create", "contract", created.id, {
      ...requestSecurityMeta(req),
      contractNo: created.contractNo,
      type: input.type,
      installmentCount: schedule.length,
      paymentDay,
      discrepancy,
    });
    if (overrideApplied) {
      await audit(actor, "contract.discrepancy_override", "contract", created.id, {
        ...requestSecurityMeta(req),
        discrepancy,
        reason: input.overrideReason,
        appliedTo: `installment#${schedule.length}`,
      });
    }
    logger.info({ contractId: created.id, contractNo: created.contractNo }, "contract created");
    res.status(201).json({ ok: true, contract: created });
  }),
);

/* ------------------------------ Notes / cancel ----------------------------- */

contractRouter.patch(
  "/contracts/:id/notes",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = contractNotesSchema.parse(req.body);
    const contract = await prisma.contract.update({
      where: { id: req.params.id },
      data: { notes: input.notes || null },
      select: { id: true },
    });
    await audit(req.auth!, "contract.notes_update", "contract", contract.id, requestSecurityMeta(req));
    res.json({ ok: true });
  }),
);

contractRouter.post(
  "/contracts/:id/cancel",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = contractCancelSchema.parse(req.body);
    const contract = await prisma.contract.findUnique({ where: { id: req.params.id } });
    if (!contract) throw new HttpError(404, "قرارداد یافت نشد", "NOT_FOUND");
    if (contract.status !== "ACTIVE") throw new HttpError(409, "فقط قرارداد فعال قابل لغو است", "CONTRACT_NOT_ACTIVE");

    const confirmed = await prisma.payment.count({ where: { contractId: contract.id, status: "CONFIRMED" } });
    if (confirmed > 0) throw new HttpError(409, "برای این قرارداد پرداخت تأییدشده ثبت شده و قابل لغو نیست", "CONTRACT_HAS_PAYMENTS");

    // Guarded update: a concurrent cancel cannot apply twice.
    const result = await prisma.contract.updateMany({
      where: { id: contract.id, status: "ACTIVE" },
      data: { status: "CANCELED", cancelReason: input.reason, canceledAt: new Date(), canceledBy: req.auth!.id },
    });
    if (result.count !== 1) throw new HttpError(409, "این قرارداد هم‌اکنون لغو شد", "CONTRACT_NOT_ACTIVE");

    await audit(req.auth!, "contract.cancel", "contract", contract.id, {
      ...requestSecurityMeta(req),
      reason: input.reason,
      contractNo: contract.contractNo,
    });
    res.json({ ok: true });
  }),
);
