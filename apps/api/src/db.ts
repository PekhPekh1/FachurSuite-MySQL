import { PrismaClient } from "@prisma/client";

const globalDb = globalThis as typeof globalThis & { __apiPrisma?: PrismaClient };
export const prisma = globalDb.__apiPrisma ?? new PrismaClient();
if (process.env.NODE_ENV !== "production") globalDb.__apiPrisma = prisma;
