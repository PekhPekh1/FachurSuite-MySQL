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

  const [remaining] = await connection.query(
    "SELECT TABLE_NAME AS tableName, COLUMN_NAME AS columnName, CHARACTER_SET_NAME AS characterSet FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND CHARACTER_SET_NAME IS NOT NULL AND CHARACTER_SET_NAME <> 'utf8mb4'",
    [databaseName],
  );
  if (remaining.length > 0) {
    throw new Error(`Some text columns are still not utf8mb4: ${remaining.map((x) => `${x.tableName}.${x.columnName} (${x.characterSet})`).join(", ")}`);
  }

  console.log(`Verified: database default and all ${rows.length} tables use utf8mb4_unicode_ci; all character columns use utf8mb4.`);
} finally {
  await connection.end();
}
