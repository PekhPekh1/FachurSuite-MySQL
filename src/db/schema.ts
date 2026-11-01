import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import {
  mysqlTable,
  mysqlEnum,
  varchar,
  text,
  decimal,
  bigint,
  int,
  boolean,
  timestamp,
  date,
  json,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/mysql-core";

/* ---------------------------------- Enums --------------------------------- */

export const userRoleEnum = ["ADMIN", "OPERATOR", "CUSTOMER"] as const;
export const contractTypeEnum = ["CASH", "INSTALLMENT"] as const;
export const contractStatusEnum = ["ACTIVE", "SETTLED", "CANCELED"] as const;
// OVERDUE is derived at read time (never stored) so a PAID/FORGIVEN installment
// can never regress to overdue. FORGIVEN = whole obligation waived by an admin.
export const installmentStatusEnum = ["PENDING", "RESERVED", "PAID", "FORGIVEN"] as const;
export const paymentMethodEnum = ["CASH", "CARD_READER", "CARD_TO_CARD"] as const;
export const paymentStatusEnum = ["PENDING_VERIFICATION", "CONFIRMED", "REJECTED"] as const;

/* --------------------------------- Helpers -------------------------------- */

/** Monetary column: MySQL DECIMAL(18,2) — exact decimal in the DB, never float math upstream. */
const money = (name: string) => decimal(name, { precision: 18, scale: 2, mode: "number" });
const ts = (name: string) => timestamp(name, { fsp: 3 });

/* ---------------------------------- Tables -------------------------------- */

export const customers = mysqlTable(
  "customers",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    firstName: varchar("first_name", { length: 60 }).notNull(),
    lastName: varchar("last_name", { length: 60 }).notNull(),
    /** Denormalized `${firstName} ${lastName}` for stable search/display compatibility. */
    fullName: varchar("full_name", { length: 120 }).notNull(),
    nationalCode: varchar("national_code", { length: 10 }).notNull().unique(),
    mobile: varchar("mobile", { length: 11 }).notNull(),
    phone: varchar("phone", { length: 11 }),
    address: text("address"),
    occupation: varchar("occupation", { length: 120 }),
    notes: text("notes"),
    tags: json("tags").$type<string[]>().notNull().$defaultFn(() => []),
    isBlacklisted: boolean("is_blacklisted").notNull().default(false),
    blacklistReason: text("blacklist_reason"),
    blacklistedAt: ts("blacklisted_at"),
    blacklistedBy: varchar("blacklisted_by", { length: 36 }),
    creditLimit: money("credit_limit").notNull().default(0),
    creditScore: int("credit_score").notNull().default(500),
    creditScoreUpdatedAt: ts("credit_score_updated_at").notNull().defaultNow(),
    isActive: boolean("is_active").notNull().default(true),
    deactivatedAt: ts("deactivated_at"),
    deactivatedBy: varchar("deactivated_by", { length: 36 }),
    deactivationReason: text("deactivation_reason"),
    createdBy: varchar("created_by", { length: 36 }),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [
    index("customers_mobile_idx").on(t.mobile),
    index("customers_name_idx").on(t.lastName, t.firstName),
    index("customers_active_idx").on(t.isActive),
    index("customers_blacklist_idx").on(t.isBlacklisted),
    check("customers_credit_limit_nonneg", sql`\`credit_limit\` >= 0`),
    check("customers_credit_score_range", sql`\`credit_score\` between 0 and 1000`),
    check("customers_national_code_fmt", sql`\`national_code\` REGEXP '^[0-9]{10}$'`),
    check("customers_mobile_fmt", sql`\`mobile\` REGEXP '^09[0-9]{9}$'`),
  ],
);

export const customerCreditHistory = mysqlTable(
  "customer_credit_history",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    customerId: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => customers.id),
    oldScore: int("old_score").notNull(),
    newScore: int("new_score").notNull(),
    reason: varchar("reason", { length: 120 }).notNull(),
    details: json("details").$type<Record<string, unknown>>(),
    computedBy: varchar("computed_by", { length: 36 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("credit_history_customer_idx").on(t.customerId, t.createdAt),
    check("credit_history_old_range", sql`\`old_score\` between 0 and 1000`),
    check("credit_history_new_range", sql`\`new_score\` between 0 and 1000`),
  ],
);

export const users = mysqlTable(
  "users",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    username: varchar("username", { length: 60 }).notNull().unique(),
    passwordHash: text("password_hash").notNull(),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    role: mysqlEnum("role", userRoleEnum).notNull(),
    customerId: varchar("customer_id", { length: 36 }).references(() => customers.id, { onDelete: "set null" }),
    canReviewPayments: boolean("can_review_payments").notNull().default(false),
    isActive: boolean("is_active").notNull().default(true),
    /** Increment to invalidate every issued access JWT immediately. */
    sessionVersion: int("session_version").notNull().default(0),
    /** Per-user appearance preferences (theme, palette, Persian digits). */
    prefTheme: varchar("pref_theme", { length: 10 }).notNull().default("system"),
    prefPalette: varchar("pref_palette", { length: 10 }).notNull().default("blue"),
    prefFaDigits: boolean("pref_fa_digits").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [check("users_username_fmt", sql`\`username\` REGEXP '^[a-zA-Z0-9_.]{3,60}$'`)],
);

/**
 * Refresh tokens: opaque 256-bit tokens; only the SHA-256 hash is persisted.
 * Rotation = new row + old row revoked (revokedAt). Deactivating a user deletes
 * all of their rows (instant revocation).
 */
export const refreshTokens = mysqlTable(
  "refresh_tokens",
  {
    tokenHash: varchar("token_hash", { length: 128 }).primaryKey(),
    userId: varchar("user_id", { length: 36 })
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: ts("created_at").notNull().defaultNow(),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
  },
  (t) => [index("refresh_tokens_user_idx").on(t.userId)],
);

export const guarantors = mysqlTable(
  "guarantors",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    customerId: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    fullName: varchar("full_name", { length: 120 }).notNull(),
    nationalCode: varchar("national_code", { length: 10 }),
    mobile: varchar("mobile", { length: 11 }),
    relation: varchar("relation", { length: 60 }),
    address: text("address"),
    notes: text("notes"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: ts("created_at").notNull().defaultNow(),
    updatedAt: ts("updated_at").notNull().defaultNow(),
  },
  (t) => [index("guarantors_customer_idx").on(t.customerId), index("guarantors_active_idx").on(t.isActive)],
);

export const documents = mysqlTable("documents", {
  id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
  ownerType: varchar("owner_type", { length: 12 }).notNull(), // customer | guarantor | payment
  ownerId: varchar("owner_id", { length: 36 }).notNull(),
  category: varchar("category", { length: 40 }).notNull().default("OTHER"),
  fileName: varchar("file_name", { length: 200 }).notNull(),
  storedName: varchar("stored_name", { length: 260 }).notNull().unique(),
  mimeType: varchar("mime_type", { length: 80 }).notNull(),
  checksumSha256: varchar("checksum_sha256", { length: 64 }).notNull(),
  size: int("size").notNull(),
  uploadedBy: varchar("uploaded_by", { length: 36 }),
  createdAt: ts("created_at").notNull().defaultNow(),
});

export const contracts = mysqlTable(
  "contracts",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    contractNo: varchar("contract_no", { length: 24 }).notNull().unique(),
    type: mysqlEnum("type", contractTypeEnum).notNull(),
    customerId: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => customers.id),
    guarantorId: varchar("guarantor_id", { length: 36 }).references(() => guarantors.id, { onDelete: "set null" }),
    itemDescription: text("item_description").notNull(),
    itemSerialNumber: varchar("item_serial_number", { length: 80 }),
    notes: text("notes"),
    cashPrice: money("cash_price").notNull(),
    totalPrice: money("total_price").notNull(),
    downPayment: money("down_payment").notNull().default(0),
    installmentCount: int("installment_count").notNull().default(0),
    installmentAmount: money("installment_amount").notNull().default(0),
    discrepancy: money("discrepancy").notNull().default(0),
    /** Explicit authorized override that applied `discrepancy` to the last installment. */
    discrepancyOverride: boolean("discrepancy_override").notNull().default(false),
    discrepancyOverrideBy: varchar("discrepancy_override_by", { length: 36 }),
    discrepancyOverrideReason: text("discrepancy_override_reason"),
    firstDueDate: date("first_due_date", { mode: "string" }),
    /** Monthly payment day 1..31; shorter months fall back to the month's last day. */
    paymentDay: int("payment_day"),
    /** Client-supplied key that makes contract creation safe against duplicate submits. */
    idempotencyKey: varchar("idempotency_key", { length: 64 }).unique(),
    status: mysqlEnum("status", contractStatusEnum).notNull().default("ACTIVE"),
    cancelReason: text("cancel_reason"),
    canceledAt: ts("canceled_at"),
    canceledBy: varchar("canceled_by", { length: 36 }),
    createdBy: varchar("created_by", { length: 36 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("contracts_customer_idx").on(t.customerId),
    index("contracts_status_idx").on(t.status),
    check("contracts_total_price_pos", sql`\`total_price\` > 0`),
    check("contracts_cash_price_pos", sql`\`cash_price\` > 0`),
    check("contracts_down_payment_nonneg", sql`\`down_payment\` >= 0`),
    check("contracts_installment_count_nonneg", sql`\`installment_count\` >= 0`),
    check("contracts_installment_amount_nonneg", sql`\`installment_amount\` >= 0`),
    check("contracts_payment_day_range", sql`\`payment_day\` is null or (\`payment_day\` between 1 and 31)`),
  ],
);

export const installments = mysqlTable(
  "installments",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    contractId: varchar("contract_id", { length: 36 })
      .notNull()
      .references(() => contracts.id, { onDelete: "cascade" }),
    seq: int("seq").notNull(),
    dueDate: date("due_date", { mode: "string" }).notNull(),
    amount: money("amount").notNull(),
    /** PENDING → (RESERVED while a card-to-card receipt awaits review) → PAID */
    status: mysqlEnum("status", installmentStatusEnum).notNull().default("PENDING"),
    paidAt: ts("paid_at"),
    paymentId: varchar("payment_id", { length: 36 }),
    penaltyForgiven: boolean("penalty_forgiven").notNull().default(false),
    forgivenAmount: money("forgiven_amount").notNull().default(0),
    forgivenBy: varchar("forgiven_by", { length: 36 }),
    forgivenReason: text("forgiven_reason"),
    forgivenAt: ts("forgiven_at"),
    /** Audit trail for authorized due-date changes. */
    originalDueDate: date("original_due_date", { mode: "string" }),
    dueDateChangedBy: varchar("due_date_changed_by", { length: 36 }),
    dueDateChangedAt: ts("due_date_changed_at"),
    dueDateChangeReason: text("due_date_change_reason"),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("installments_contract_seq_uq").on(t.contractId, t.seq),
    index("installments_due_idx").on(t.dueDate),
    index("installments_status_idx").on(t.status),
    check("installments_amount_pos", sql`\`amount\` > 0`),
    check("installments_seq_pos", sql`\`seq\` >= 1`),
  ],
);

export const payments = mysqlTable(
  "payments",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    idempotencyKey: varchar("idempotency_key", { length: 64 }).notNull().unique(),
    contractId: varchar("contract_id", { length: 36 })
      .notNull()
      .references(() => contracts.id),
    customerId: varchar("customer_id", { length: 36 })
      .notNull()
      .references(() => customers.id),
    amount: money("amount").notNull(),
    penaltyAmount: money("penalty_amount").notNull().default(0),
    method: mysqlEnum("method", paymentMethodEnum).notNull(),
    status: mysqlEnum("status", paymentStatusEnum).notNull(),
    /** Masked source card for card-to-card receipts (16 digits, stored raw). */
    sourceCardNumber: varchar("source_card_number", { length: 19 }),
    destinationCardMask: varchar("destination_card_mask", { length: 19 }),
    referenceNo: varchar("reference_no", { length: 80 }),
    note: text("note"),
    /** When the money actually moved (customer-supplied for card-to-card). */
    paidAt: ts("paid_at"),
    isSettlement: boolean("is_settlement").notNull().default(false),
    settlementMeta: json("settlement_meta").$type<unknown>(),
    /** Links a resubmitted receipt to the payment it replaces. */
    resubmissionOf: varchar("resubmission_of", { length: 36 }),
    isResubmittable: boolean("is_resubmittable").notNull().default(false),
    submittedBy: varchar("submitted_by", { length: 36 }),
    /** Verification actor + timestamp (only meaningful once decided). */
    reviewedBy: varchar("reviewed_by", { length: 36 }),
    reviewedAt: ts("reviewed_at"),
    reviewNote: text("review_note"),
    receiptDocumentId: varchar("receipt_document_id", { length: 36 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("payments_contract_idx").on(t.contractId),
    index("payments_customer_idx").on(t.customerId),
    index("payments_status_idx").on(t.status),
    check("payments_amount_pos", sql`\`amount\` > 0`),
    check("payments_penalty_nonneg", sql`\`penalty_amount\` >= 0`),
  ],
);

export const paymentInstallments = mysqlTable(
  "payment_installments",
  {
    paymentId: varchar("payment_id", { length: 36 })
      .notNull()
      .references(() => payments.id, { onDelete: "cascade" }),
    installmentId: varchar("installment_id", { length: 36 })
      .notNull()
      .references(() => installments.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.paymentId, t.installmentId] }), uniqueIndex("payment_installments_inst_uq").on(t.installmentId)],
);

/**
 * Backup history. Records each manual backup taken through the ADMIN UI so
 * operators can see what was captured, when, and by whom. Backups themselves are
 * streamed to the requester and never written to a publicly accessible path.
 */
export const backupHistory = mysqlTable(
  "backup_history",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    fileName: varchar("file_name", { length: 120 }).notNull(),
    sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
    tableCount: int("table_count").notNull(),
    /** Row counts per table, for verification after a restore. */
    tableCounts: json("table_counts").$type<Record<string, number>>(),
    status: varchar("status", { length: 20 }).notNull().default("COMPLETED"),
    detail: text("detail"),
    takenBy: varchar("taken_by", { length: 36 }),
    takenByName: varchar("taken_by_name", { length: 120 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("backup_history_created_idx").on(t.createdAt)],
);

export const settings = mysqlTable("settings", {
  key: varchar("key", { length: 40 }).primaryKey(),
  value: json("value").notNull(),
  updatedBy: varchar("updated_by", { length: 36 }),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

export const auditLogs = mysqlTable(
  "audit_logs",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    userId: varchar("user_id", { length: 36 }),
    userName: varchar("user_name", { length: 120 }),
    userRole: varchar("user_role", { length: 20 }),
    action: varchar("action", { length: 60 }).notNull(),
    entity: varchar("entity", { length: 40 }).notNull(),
    entityId: varchar("entity_id", { length: 64 }),
    meta: json("meta").$type<unknown>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("audit_created_idx").on(t.createdAt), index("audit_entity_idx").on(t.entity)],
);

/**
 * Durable SMS jobs. Persisted rather than held in memory, so a restart resumes
 * pending work instead of losing or duplicating it. The (dedupeKey) unique index
 * makes duplicate scheduling impossible even under concurrency.
 */
export const smsJobs = mysqlTable(
  "sms_jobs",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    /** Stable key (template + installment + send date) preventing duplicates. */
    dedupeKey: varchar("dedupe_key", { length: 160 }).notNull().unique(),
    templateKey: varchar("template_key", { length: 60 }).notNull(),
    customerId: varchar("customer_id", { length: 36 }),
    phone: varchar("phone", { length: 20 }).notNull(),
    vars: json("vars").$type<Record<string, string | number>>(),
    scheduledFor: ts("scheduled_for").notNull(),
    /** PENDING → SENT / FAILED / CANCELLED */
    status: varchar("status", { length: 20 }).notNull().default("PENDING"),
    attempts: int("attempts").notNull().default(0),
    lastAttemptAt: ts("last_attempt_at"),
    lastError: text("last_error"),
    smsLogId: varchar("sms_log_id", { length: 36 }),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [
    index("sms_jobs_pending_idx").on(t.status, t.scheduledFor),
    index("sms_jobs_customer_idx").on(t.customerId),
    check("sms_jobs_attempts_nonneg", sql`\`attempts\` >= 0`),
  ],
);

export const smsLogs = mysqlTable(
  "sms_logs",
  {
    id: varchar("id", { length: 36 }).$defaultFn(() => randomUUID()).primaryKey(),
    customerId: varchar("customer_id", { length: 36 }),
    phone: varchar("phone", { length: 20 }).notNull(),
    body: text("body").notNull(),
    /** SENT | SIMULATED | FAILED */
    status: varchar("status", { length: 20 }).notNull(),
    detail: text("detail"),
    /** Which template produced the message. */
    templateKey: varchar("template_key", { length: 60 }),
    /** Placeholders used, for audit purposes (never credentials). */
    vars: json("vars").$type<Record<string, string | number> | null>(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("sms_created_idx").on(t.createdAt), index("sms_template_idx").on(t.templateKey)],
);

/** Message templates rendered with {placeholder} substitution (see lib/sms.ts). */
export const smsTemplates = mysqlTable("sms_templates", {
  key: varchar("key", { length: 60 }).primaryKey(),
  title: varchar("title", { length: 120 }).notNull(),
  body: text("body").notNull(),
  /** Optional category used by the reminder scheduler. */
  category: varchar("category", { length: 40 }).notNull().default("CUSTOM"),
  isActive: boolean("is_active").notNull().default(true),
  updatedAt: ts("updated_at").notNull().defaultNow(),
});

/** Official holidays (Gregorian storage; Jalali display at app layer). */
export const holidays = mysqlTable(
  "holidays",
  {
    id: bigint("id", { mode: "number" }).autoincrement().primaryKey(),
    date: date("date", { mode: "string" }).notNull().unique(),
    title: varchar("title", { length: 120 }).notNull(),
    createdAt: ts("created_at").notNull().defaultNow(),
  },
  (t) => [index("holidays_date_idx").on(t.date)],
);

/** Allocation counters (contract numbering, etc.). */
export const counters = mysqlTable("counters", {
  key: varchar("key", { length: 40 }).primaryKey(),
  value: bigint("value", { mode: "number" }).notNull().default(0),
});

/* ---------------------------------- Types --------------------------------- */

export type User = typeof users.$inferSelect;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type Customer = typeof customers.$inferSelect;
export type CustomerCreditHistory = typeof customerCreditHistory.$inferSelect;
export type Guarantor = typeof guarantors.$inferSelect;
export type Contract = typeof contracts.$inferSelect;
export type Installment = typeof installments.$inferSelect;
export type Payment = typeof payments.$inferSelect;
export type AuditLog = typeof auditLogs.$inferSelect;
export type SmsLog = typeof smsLogs.$inferSelect;
export type SmsTemplate = typeof smsTemplates.$inferSelect;
export type Holiday = typeof holidays.$inferSelect;
export type BackupHistory = typeof backupHistory.$inferSelect;
export type Document = typeof documents.$inferSelect;
