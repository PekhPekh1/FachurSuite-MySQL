import { Router } from "express";
import { authenticate, authorize } from "../security/middleware";

export const protectedRouter = Router();

protectedRouter.get(
  "/admin/ping",
  authenticate,
  authorize("ADMIN"),
  (_req, res) => res.json({ ok: true, scope: "ADMIN" }),
);

protectedRouter.get(
  "/operator/ping",
  authenticate,
  authorize("ADMIN", "OPERATOR"),
  (_req, res) => res.json({ ok: true, scope: "OPERATOR" }),
);
