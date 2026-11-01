import crypto from "node:crypto";
import path from "node:path";
import { mkdir, unlink, writeFile } from "node:fs/promises";
import { Router, type Response } from "express";
import multer from "multer";
import { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { audit, requestSecurityMeta } from "../security/audit";
import { asyncRoute, HttpError } from "../security/errors";
import { authenticate, authorize, type AuthRequest } from "../security/middleware";
import { recalculateCreditScore } from "../customer/credit";
import {
  blacklistSchema,
  customerCreateSchema,
  customerListSchema,
  customerStateSchema,
  customerUpdateSchema,
  documentCategorySchema,
  guarantorCreateSchema,
  guarantorUpdateSchema,
} from "../customer/schemas";

export const customerRouter = Router();
customerRouter.use(authenticate);

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024, files: 1 } });
const uploadDir = process.env.UPLOAD_DIR ?? path.resolve(__dirname, "../../../../uploads");

const publicCustomer = (customer: Record<string, unknown>) => ({
  ...customer,
  creditLimit: customer.creditLimit?.toString(),
});

function assertOwnCustomer(req: AuthRequest, id: string) {
  if (req.auth?.role === "CUSTOMER" && req.auth.customerId !== id) {
    throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
  }
}

function detectFile(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: ".png" };
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { mime: "application/pdf", ext: ".pdf" };
  return null;
}

/* ----------------------------- Customer listing ---------------------------- */

customerRouter.get(
  "/customers",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req, res) => {
    const query = customerListSchema.parse(req.query);
    const where: Prisma.CustomerWhereInput = {};
    if (query.q) {
      where.OR = [
        { fullName: { contains: query.q, mode: "insensitive" } },
        { nationalCode: { contains: query.q } },
        { mobile: { contains: query.q } },
      ];
    }
    if (query.isActive !== undefined) where.isActive = query.isActive === "true";
    if (query.blacklisted !== undefined) where.isBlacklisted = query.blacklisted === "true";

    const [items, total] = await prisma.\$transaction([
      prisma.customer.findMany({
        where,
        orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          firstName: true,
          lastName: true,
          fullName: true,
          nationalCode: true,
          mobile: true,
          occupation: true,
          tags: true,
          isActive: true,
          isBlacklisted: true,
          creditScore: true,
          createdAt: true,
        },
      }),
      prisma.customer.count({ where }),
    ]);
    res.json({
      ok: true,
      items,
      pagination: { page: query.page, pageSize: query.pageSize, total, pages: Math.ceil(total / query.pageSize) },
    });
  }),
);

customerRouter.post(
  "/customers",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = customerCreateSchema.parse(req.body);
    const fullName = `${input.firstName} ${input.lastName}`;
    const customer = await prisma.$transaction(async (tx) => {
      const created = await tx.customer.create({
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          fullName,
          nationalCode: input.nationalCode,
          mobile: input.mobile,
          phone: input.secondaryPhone || null,
          address: input.address || null,
          occupation: input.occupation || null,
          notes: input.notes || null,
          tags: input.tags,
          creditLimit: input.creditLimit,
          createdBy: req.auth!.id,
        },
      });
      await tx.customerCreditHistory.create({
        data: { customerId: created.id, oldScore: 500, newScore: 500, reason: "INITIAL", details: { ruleVersion: 1 }, computedBy: req.auth!.id },
      });
      return created;
    });
    await audit(req.auth!, "customer.create", "customer", customer.id, { ...requestSecurityMeta(req), fullName });
    res.status(201).json({ ok: true, customer: publicCustomer(customer as unknown as Record<string, unknown>) });
  }),
);

/* -------------------------- Detail + financial summary ------------------------- */

customerRouter.get(
  "/customers/:id",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    assertOwnCustomer(req, req.params.id);
    const customer = await prisma.customer.findUnique({
      where: { id: req.params.id },
      include: {
        guarantors: { where: { isActive: true }, orderBy: { createdAt: "desc" } },
        creditHistory: { orderBy: { createdAt: "desc" }, take: 20 },
      },
    });
    if (!customer) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");

    const [contractGroups, outstanding, paymentGroups, documents] = await Promise.all([
      prisma.contract.groupBy({ by: ["status"], where: { customerId: customer.id }, _count: true }),
      prisma.installment.aggregate({
        where: { contract: { customerId: customer.id }, status: { not: "PAID" } },
        _sum: { amount: true },
        _count: true,
      }),
      prisma.payment.groupBy({ by: ["status"], where: { customerId: customer.id }, _count: true, _sum: { amount: true } }),
      prisma.document.findMany({ where: { ownerType: "customer", ownerId: customer.id }, orderBy: { createdAt: "desc" } }),
    ]);

    res.json({
      ok: true,
      customer: {
        ...publicCustomer(customer as unknown as Record<string, unknown>),
        creditHistory: customer.creditHistory.map((row) => ({ ...row, id: row.id.toString() })),
      },
      summaries: {
        contracts: Object.fromEntries(contractGroups.map((row) => [row.status, row._count])),
        outstanding: { count: outstanding._count, amount: outstanding._sum.amount?.toString() ?? "0" },
        payments: Object.fromEntries(paymentGroups.map((row) => [row.status, { count: row._count, amount: row._sum.amount?.toString() ?? "0" }])),
        documents: documents.length,
      },
    });
  }),
);

customerRouter.patch(
  "/customers/:id",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = customerUpdateSchema.parse(req.body);
    const current = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!current) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
    const firstName = input.firstName ?? current.firstName;
    const lastName = input.lastName ?? current.lastName;
    const customer = await prisma.customer.update({
      where: { id: current.id },
      data: {
        ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
        ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
        ...(input.nationalCode !== undefined ? { nationalCode: input.nationalCode } : {}),
        ...(input.mobile !== undefined ? { mobile: input.mobile } : {}),
        ...(input.secondaryPhone !== undefined ? { phone: input.secondaryPhone || null } : {}),
        ...(input.address !== undefined ? { address: input.address || null } : {}),
        ...(input.occupation !== undefined ? { occupation: input.occupation || null } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.tags !== undefined ? { tags: input.tags } : {}),
        ...(input.creditLimit !== undefined ? { creditLimit: input.creditLimit } : {}),
        fullName: `${firstName} ${lastName}`,
        updatedAt: new Date(),
      },
    });
    await audit(req.auth!, "customer.update", "customer", current.id, {
      ...requestSecurityMeta(req),
      fields: Object.keys(input).filter((key) => key !== "notes"),
    });
    res.json({ ok: true, customer: publicCustomer(customer as unknown as Record<string, unknown>) });
  }),
);

/* --------------------------- Lifecycle / blacklist --------------------------- */

customerRouter.post(
  "/customers/:id/deactivate",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = customerStateSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
    await prisma.$transaction(async (tx) => {
      await tx.customer.update({
        where: { id: customer.id },
        data: { isActive: false, deactivatedAt: new Date(), deactivatedBy: req.auth!.id, deactivationReason: input.reason, updatedAt: new Date() },
      });
      const linked = await tx.user.findMany({ where: { customerId: customer.id }, select: { id: true } });
      if (linked.length) {
        const ids = linked.map((user) => user.id);
        await tx.user.updateMany({ where: { id: { in: ids } }, data: { isActive: false, sessionVersion: { increment: 1 } } });
        await tx.refreshToken.updateMany({ where: { userId: { in: ids }, revokedAt: null }, data: { revokedAt: new Date() } });
      }
    });
    await audit(req.auth!, "customer.deactivate", "customer", customer.id, { ...requestSecurityMeta(req), reason: input.reason });
    res.json({ ok: true });
  }),
);

customerRouter.post(
  "/customers/:id/activate",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const customer = await prisma.customer.update({
      where: { id: req.params.id },
      data: { isActive: true, deactivatedAt: null, deactivatedBy: null, deactivationReason: null, updatedAt: new Date() },
    });
    await audit(req.auth!, "customer.activate", "customer", customer.id, requestSecurityMeta(req));
    res.json({ ok: true });
  }),
);

customerRouter.post(
  "/customers/:id/blacklist",
  authorize("ADMIN"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = blacklistSchema.parse(req.body);
    const customer = await prisma.customer.findUnique({ where: { id: req.params.id } });
    if (!customer) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
    await prisma.customer.update({
      where: { id: customer.id },
      data: {
        isBlacklisted: input.blacklisted,
        blacklistReason: input.blacklisted ? input.reason : null,
        blacklistedAt: input.blacklisted ? new Date() : null,
        blacklistedBy: input.blacklisted ? req.auth!.id : null,
        ...(input.blacklisted ? { creditScore: 0, creditScoreUpdatedAt: new Date() } : {}),
        updatedAt: new Date(),
      },
    });
    if (input.blacklisted) {
      await prisma.customerCreditHistory.create({
        data: { customerId: customer.id, oldScore: customer.creditScore, newScore: 0, reason: "BLACKLISTED", details: { reason: input.reason }, computedBy: req.auth!.id },
      });
    } else {
      await recalculateCreditScore(customer.id, req.auth!.id, "BLACKLIST_REMOVED");
    }
    await audit(req.auth!, input.blacklisted ? "customer.blacklist" : "customer.unblacklist", "customer", customer.id, {
      ...requestSecurityMeta(req),
      reason: input.reason,
    });
    res.json({ ok: true });
  }),
);

customerRouter.post(
  "/customers/:id/credit/recalculate",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const result = await recalculateCreditScore(req.params.id, req.auth!.id);
    await audit(req.auth!, "customer.credit_recalculated", "customer", req.params.id, {
      ...requestSecurityMeta(req),
      score: result.score,
      ruleVersion: result.ruleVersion,
    });
    res.json({ ok: true, credit: result });
  }),
);

/* ------------------------------- Guarantors ------------------------------- */

customerRouter.get(
  "/customers/:id/guarantors",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    assertOwnCustomer(req, req.params.id);
    const items = await prisma.guarantor.findMany({ where: { customerId: req.params.id, isActive: true }, orderBy: { createdAt: "desc" } });
    res.json({ ok: true, items });
  }),
);

customerRouter.post(
  "/customers/:id/guarantors",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = guarantorCreateSchema.parse(req.body);
    const owner = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!owner) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
    const guarantor = await prisma.guarantor.create({
      data: {
        customerId: owner.id,
        fullName: input.fullName,
        nationalCode: input.nationalCode || null,
        mobile: input.mobile || null,
        relation: input.relation || null,
        address: input.address || null,
        notes: input.notes || null,
      },
    });
    await audit(req.auth!, "guarantor.create", "guarantor", guarantor.id, { ...requestSecurityMeta(req), customerId: owner.id });
    res.status(201).json({ ok: true, guarantor });
  }),
);

customerRouter.patch(
  "/guarantors/:id",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const input = guarantorUpdateSchema.parse(req.body);
    const guarantor = await prisma.guarantor.update({ where: { id: req.params.id }, data: { ...input, updatedAt: new Date() } });
    await audit(req.auth!, "guarantor.update", "guarantor", guarantor.id, { ...requestSecurityMeta(req), customerId: guarantor.customerId });
    res.json({ ok: true, guarantor });
  }),
);

customerRouter.delete(
  "/guarantors/:id",
  authorize("ADMIN", "OPERATOR"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const guarantor = await prisma.guarantor.update({ where: { id: req.params.id }, data: { isActive: false, updatedAt: new Date() } });
    await audit(req.auth!, "guarantor.deactivate", "guarantor", guarantor.id, { ...requestSecurityMeta(req), customerId: guarantor.customerId });
    res.json({ ok: true });
  }),
);

/* -------------------------------- Documents -------------------------------- */

customerRouter.get(
  "/customers/:id/documents",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    assertOwnCustomer(req, req.params.id);
    const items = await prisma.document.findMany({
      where: { ownerType: "customer", ownerId: req.params.id },
      select: { id: true, category: true, fileName: true, mimeType: true, size: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    });
    res.json({ ok: true, items });
  }),
);

customerRouter.post(
  "/customers/:id/documents",
  upload.single("file"),
  asyncRoute(async (req: AuthRequest, res: Response) => {
    assertOwnCustomer(req, req.params.id);
    const owner = await prisma.customer.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!owner) throw new HttpError(404, "مشتری یافت نشد", "NOT_FOUND");
    if (!req.file) throw new HttpError(400, "فایل ارسال نشده است", "FILE_REQUIRED");
    const category = documentCategorySchema.parse(req.body.category ?? "OTHER");
    const detected = detectFile(req.file.buffer);
    if (!detected) throw new HttpError(400, "محتوای فایل معتبر نیست؛ فقط JPG، PNG و PDF مجاز است", "INVALID_FILE");
    if (req.file.mimetype && req.file.mimetype !== detected.mime) throw new HttpError(400, "نوع فایل با محتوای آن مطابقت ندارد", "FILE_TYPE_MISMATCH");

    await mkdir(uploadDir, { recursive: true });
    const storedName = `${crypto.randomUUID()}${detected.ext}`;
    const target = path.join(uploadDir, storedName);
    const checksumSha256 = crypto.createHash("sha256").update(req.file.buffer).digest("hex");
    await writeFile(target, req.file.buffer, { flag: "wx" });
    try {
      const document = await prisma.document.create({
        data: {
          ownerType: "customer",
          ownerId: owner.id,
          category,
          fileName: path.basename(req.file.originalname).replace(/[\u0000-\u001f]/g, "").slice(0, 200) || `document${detected.ext}`,
          storedName,
          mimeType: detected.mime,
          checksumSha256,
          size: req.file.size,
          uploadedBy: req.auth!.id,
        },
      });
      await audit(req.auth!, "document.upload", "document", document.id, {
        ...requestSecurityMeta(req),
        customerId: owner.id,
        category,
        size: document.size,
        checksumSha256,
      });
      res.status(201).json({ ok: true, document: { id: document.id, category, fileName: document.fileName, mimeType: document.mimeType, size: document.size } });
    } catch (error) {
      await unlink(target).catch(() => undefined);
      throw error;
    }
  }),
);

customerRouter.get(
  "/documents/:id",
  asyncRoute(async (req: AuthRequest, res: Response) => {
    const document = await prisma.document.findUnique({ where: { id: req.params.id } });
    if (!document || document.ownerType !== "customer") throw new HttpError(404, "سند یافت نشد", "NOT_FOUND");
    assertOwnCustomer(req, document.ownerId);
    res.setHeader("Content-Type", document.mimeType);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(document.fileName)}`);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(path.join(uploadDir, document.storedName));
  }),
);
