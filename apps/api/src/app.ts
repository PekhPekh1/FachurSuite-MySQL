import express from "express";
import helmet from "helmet";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { prisma } from "./db";
import { logger } from "./logger";
import { authRouter } from "./routes/auth";
import { protectedRouter } from "./routes/protected";
import { customerRouter } from "./routes/customers";
import { contractRouter } from "./routes/contracts";
import { installmentRouter } from "./routes/installments";
import { paymentRouter } from "./routes/payments";
import { portalRouter } from "./routes/portal";
import { errorHandler, HttpError, notFound } from "./security/errors";

export const app = express();
const startedAt = Date.now();
const allowedOrigins = (process.env.CORS_ORIGIN ?? "http://localhost:3000").split(",").map((v) => v.trim());

app.set("trust proxy", 1);
app.disable("x-powered-by");
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
      callback(new HttpError(403, "مبدأ درخواست مجاز نیست", "ORIGIN_DENIED"));
    },
    credentials: true,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(
  rateLimit({
    windowMs: 60_000,
    limit: 120,
    standardHeaders: true,
    legacyHeaders: false,
    message: { ok: false, error: "تعداد درخواست‌ها بیش از حد مجاز است؛ کمی بعد تلاش کنید", code: "RATE_LIMITED" },
  }),
);
app.use(
  pinoHttp({
    logger,
    // Never serialize request/response headers: Cookie, Authorization, and
    // Set-Cookie values must not reach logs under any circumstance.
    serializers: {
      req: (req) => ({ id: req.id, method: req.method, url: req.url, remoteAddress: req.remoteAddress }),
      res: (res) => ({ statusCode: res.statusCode }),
    },
    autoLogging: { ignore: (req) => req.url === "/health" },
  }),
);

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "installments-api", uptimeSec: Math.round((Date.now() - startedAt) / 1000) });
});
app.get("/health/db", async (_req, res) => {
  try {
    await prisma.$queryRawUnsafe("SELECT 1");
    res.json({ ok: true, db: true });
  } catch (err) {
    logger.error({ err }, "db healthcheck failed");
    res.status(503).json({ ok: false, db: false, error: "عدم اتصال به پایگاه داده" });
  }
});

app.use("/api/v1/auth", authRouter);
app.use("/api/v1", customerRouter);
app.use("/api/v1", contractRouter);
app.use("/api/v1", installmentRouter);
app.use("/api/v1", paymentRouter);
app.use("/api/v1", portalRouter);
app.use("/api/v1", protectedRouter);
app.use(notFound);
app.use(errorHandler);
