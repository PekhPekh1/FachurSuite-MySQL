import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

/**
 * MySQL connection pool.
 *
 * `timezone: "Z"` makes mysql2 read/write instants in UTC, which is what the
 * TIMESTAMP(3) columns store — this replaces PostgreSQL's timestamptz semantics
 * and keeps every "today" computation (Asia/Tehran) deterministic.
 * `supportBigNumbers` + `bigNumberStrings: false` keeps BIGINT row counts as
 * JS numbers, matching the previous bigint mode:number behaviour.
 */
const globalForDb = globalThis as typeof globalThis & {
  __fachursuiteMysqlPool?: mysql.Pool;
};

export const pool =
  globalForDb.__fachursuiteMysqlPool ??
  mysql.createPool({
    uri: databaseUrl,
    connectionLimit: 10,
    // UTC instants for TIMESTAMP columns.
    timezone: "Z",
    // DECIMAL(18,2) is returned as a JS number by drizzle's mode:"number".
    decimalNumbers: true,
    // Keep dates as JS Date objects.
    dateStrings: false,
    supportBigNumbers: true,
    bigNumberStrings: false,
    charset: "utf8mb4",
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__fachursuiteMysqlPool = pool;
}

export const db = drizzle(pool);
