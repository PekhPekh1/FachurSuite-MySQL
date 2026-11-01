import dotenv from "dotenv";

// Works when started either from repository root or apps/api.
dotenv.config({ path: [".env", "../../.env"], quiet: true });

void import("./app").then(async ({ app }) => {
  const [{ logger }, { prisma }] = await Promise.all([import("./logger"), import("./db")]);
  const port = Number(process.env.API_PORT ?? 4100);
  const server = app.listen(port, () => logger.info({ port }, "installments-api listening"));

  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      void prisma.$disconnect().then(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 5000).unref();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
});
