import mysql from "mysql2/promise";
import "dotenv/config";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  throw new Error("DATABASE_URL is required");
}

const connection = await mysql.createConnection(databaseUrl);
await connection.query("SET NAMES utf8mb4");

const quoteIdentifier = (value) => "`" + String(value).replace(/`/g, "``") + "`";

try {
  const [[{ databaseName }]] = await connection.query(
    "SELECT DATABASE() AS databaseName",
  );
  if (!databaseName) throw new Error("Could not determine the active database");

  await connection.query(
    `ALTER DATABASE ${quoteIdentifier(databaseName)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
  );

  const [rows] = await connection.query(
    "SELECT TABLE_NAME AS tableName FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE' ORDER BY TABLE_NAME",
    [databaseName],
  );

  await connection.query("SET FOREIGN_KEY_CHECKS = 0");
  try {
    for (const { tableName } of rows) {
      await connection.query(
        `ALTER TABLE ${quoteIdentifier(databaseName)}.${quoteIdentifier(tableName)} CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
      console.log(`Converted: ${tableName}`);
    }
  } finally {
    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
  }

  console.log(`Success: database default and ${rows.length} tables now use utf8mb4_unicode_ci.`);
} finally {
  await connection.end();
}
