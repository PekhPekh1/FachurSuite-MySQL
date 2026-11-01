import type { NextFunction, Request, Response } from "express";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import multer from "multer";
import { logger } from "../logger";

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly code = "REQUEST_FAILED",
  ) {
    super(message);
  }
}

export const asyncRoute =
  (handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => {
    void handler(req, res, next).catch(next);
  };

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ ok: false, error: "مسیر درخواستی یافت نشد", code: "NOT_FOUND" });
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    res.status(400).json({ ok: false, error: err.issues[0]?.message ?? "ورودی نامعتبر است", code: "VALIDATION_ERROR" });
    return;
  }
  if (err instanceof multer.MulterError) {
    res.status(400).json({
      ok: false,
      error: err.code === "LIMIT_FILE_SIZE" ? "حجم فایل نباید بیش از ۵ مگابایت باشد" : "فایل ارسالی معتبر نیست",
      code: "UPLOAD_ERROR",
    });
    return;
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === "P2002") {
      res.status(409).json({ ok: false, error: "رکوردی با این اطلاعات یکتا قبلاً ثبت شده است", code: "DUPLICATE_RECORD" });
      return;
    }
    if (err.code === "P2025") {
      res.status(404).json({ ok: false, error: "رکورد یافت نشد", code: "NOT_FOUND" });
      return;
    }
  }
  const known = err instanceof HttpError;
  const status = known ? err.status : 500;
  if (status >= 500) logger.error({ err, method: req.method, path: req.path }, "unhandled request error");
  res.status(status).json({
    ok: false,
    error: status >= 500 ? "خطای داخلی سرور" : (err as Error).message,
    code: known ? err.code : "INTERNAL_ERROR",
  });
}
