import { NextResponse } from "next/server";
import { db } from "@/db";
import {
  auditLogs, backupHistory, contracts, counters, customerCreditHistory, customers, documents,
  guarantors, holidays, installments, paymentInstallments, payments, settings, smsJobs, smsLogs,
  smsTemplates, users,
} from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { recordBackup } from "@/server/actions/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Manual database backup (ADMIN only).
 *
 * Security: the dump is streamed directly to the authenticated requester and is
 * never written to any publicly accessible path. Refresh-token digests are
 * deliberately excluded. Password hashes are included because a restore needs
 * them, so the downloaded file must be stored securely. Every backup is recorded
 * in backup_history with per-table row counts for post-restore verification.
 */
export async function GET() {
  const user = await getSessionUser();
  if (!user || user.role !== "ADMIN") {
    return NextResponse.json({ ok: false, error: "دسترسی مجاز نیست" }, { status: 403 });
  }

  const [customerRows, guarantorRows, contractRows, installmentRows, paymentRows, paymentInstallmentRows,
    documentRows, userRows, settingRows, smsLogRows, smsTemplateRows, holidayRows, auditRows, counterRows,
    creditHistoryRows, smsJobRows, backupRows] = await Promise.all([
    db.select().from(customers), db.select().from(guarantors), db.select().from(contracts),
    db.select().from(installments), db.select().from(payments), db.select().from(paymentInstallments),
    db.select().from(documents), db.select().from(users), db.select().from(settings),
    db.select().from(smsLogs), db.select().from(smsTemplates), db.select().from(holidays),
    db.select().from(auditLogs), db.select().from(counters), db.select().from(customerCreditHistory),
    db.select().from(smsJobs), db.select().from(backupHistory),
  ]);

  const tableCounts = {
    customers: customerRows.length, guarantors: guarantorRows.length, contracts: contractRows.length,
    installments: installmentRows.length, payments: paymentRows.length,
    payment_installments: paymentInstallmentRows.length, documents: documentRows.length,
    users: userRows.length, settings: settingRows.length, sms_logs: smsLogRows.length,
    sms_templates: smsTemplateRows.length, holidays: holidayRows.length, audit_logs: auditRows.length,
    counters: counterRows.length, customer_credit_history: creditHistoryRows.length,
    sms_jobs: smsJobRows.length, backup_history: backupRows.length,
  };

  const dump = {
    generatedAt: new Date().toISOString(),
    version: 3,
    // Refresh-token digests are excluded: they must never leave the database.
    excludedTables: ["refresh_tokens"],
    notes: "Password hashes are included because a restore requires them. Store this file securely.",
    tableCounts,
    tables: {
      customers: customerRows, guarantors: guarantorRows, contracts: contractRows,
      installments: installmentRows, payments: paymentRows, payment_installments: paymentInstallmentRows,
      documents: documentRows, users: userRows, settings: settingRows, sms_logs: smsLogRows,
      sms_templates: smsTemplateRows, holidays: holidayRows, audit_logs: auditRows,
      counters: counterRows, customer_credit_history: creditHistoryRows, sms_jobs: smsJobRows,
      backup_history: backupRows,
    },
  };

  const json = JSON.stringify(dump, null, 2);
  const sizeBytes = Buffer.byteLength(json, "utf8");
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const fileName = `backup-${stamp}.json`;

  await recordBackup({ fileName, sizeBytes, tableCount: Object.keys(tableCounts).length, tableCounts, actor: user });

  return new NextResponse(json, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
