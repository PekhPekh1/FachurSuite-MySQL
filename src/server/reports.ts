import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { contracts, customers, installments, payments, smsLogs } from "@/db/schema";
import { computePenalty, deriveInstallmentStatus, type FinanceSettings } from "@/lib/finance";
import { getFinanceSettings } from "@/lib/settings-server";
import { addMonthsJalali, jalaliMonthStart, todayGreg } from "@/lib/jalali";

/**
 * ─── FINANCIAL DEFINITIONS (Stage 10, authoritative) ───────────────────────────
 *
 * COLLECTIONS (دریافت‌ها)
 *   Only payments with status = CONFIRMED are money actually received. Payments
 *   with status PENDING_VERIFICATION or REJECTED are NEVER counted as income —
 *   a pending receipt has not been verified, and a rejected one was never received.
 *
 * RECEIVABLES (مطالبات)
 *   The principal of every installment that is still payable (status PENDING or
 *   RESERVED, i.e. not PAID and not FORGIVEN), plus penalties accrued to date on
 *   the overdue subset. RESERVED rows are included because the obligation still
 *   exists until the covering receipt is confirmed.
 *
 * PROFIT (سود / مابه‌التفاوت)
 *   For installment contracts, profit is the CONTRACTUAL DIFFERENCE between the
 *   installment total price and the cash price:
 *       profit = totalPrice − cashPrice − discrepancy_absorbed_as_override
 *   In practice: profit = totalPrice − cashPrice (a discount already reduces
 *   totalPrice). This is a CONTRACTUAL MARGIN, not realized cash income: it is
 *   earned over the life of the contract and is only fully realized when the last
 *   installment is settled. Cash contracts have zero profit by definition
 *   (totalPrice === cashPrice).
 */

export interface ReportRange {
  from: string;
  to: string;
}

export interface ReportFilters extends ReportRange {
  customerId?: string;
  contractStatus?: "ACTIVE" | "SETTLED" | "CANCELED";
  paymentMethod?: "CASH" | "CARD_READER" | "CARD_TO_CARD";
  contractType?: "CASH" | "INSTALLMENT";
  page?: number;
  pageSize?: number;
}

const CONFIRMED = "CONFIRMED" as const;
const PAYABLE = ["PENDING", "RESERVED"] as const;

/** Jalali month boundaries covering the 12 months ending with the current month. */
export function lastTwelveJalaliMonths(today: string) {
  const monthStart = jalaliMonthStart(today);
  return Array.from({ length: 12 }, (_, i) => {
    const start = addMonthsJalali(monthStart, i - 11);
    const end = addMonthsJalali(monthStart, i - 10);
    return { start, end };
  });
}

/* --------------------------------- Dashboard -------------------------------- */

export interface DashboardData {
  today: string;
  totalReceivables: number;
  receivablesPrincipal: number;
  receivablesPenalty: number;
  overdueCount: number;
  overdueAmount: number;
  todayCollections: number;
  monthCollections: number;
  activeContracts: number;
  totalContracts: number;
  contractStatus: Record<string, number>;
  customerCount: number;
  monthly: { label: string; value: number }[];
  methodMix: { name: string; value: number }[];
  onTime: number;
  late: number;
  onTimeRate: number;
  upcoming: {
    id: string; seq: number; dueDate: string; amount: number; contractNo: string;
    contractId: string; customerName: string; customerId: string;
  }[];
  overdue: {
    id: string; seq: number; dueDate: string; amount: number; penalty: number; daysLate: number;
    contractNo: string; contractId: string; customerName: string; customerId: string;
  }[];
  recentPayments: {
    id: string; amount: number; method: string; status: string; createdAt: Date;
    customerName: string; contractNo: string; contractId: string;
  }[];
  pendingVerificationCount: number;
  pendingVerificationAmount: number;
  highOverdueCustomers: { customerId: string; name: string; count: number; amount: number; oldestDays: number }[];
}

export async function getDashboardData(): Promise<DashboardData> {
  const today = todayGreg();
  const monthStart = jalaliMonthStart(today);
  const finance = await getFinanceSettings();
  const dayStart = new Date(`${today}T00:00:00+03:30`);
  const monthStartTs = new Date(`${monthStart}T00:00:00+03:30`);

  const [payable, contractRows, customerRows, paymentRows, sms] = await Promise.all([
    db
      .select({
        id: installments.id, seq: installments.seq, dueDate: installments.dueDate,
        amount: installments.amount, status: installments.status, paidAt: installments.paidAt,
        penaltyForgiven: installments.penaltyForgiven,
        contractId: contracts.id, contractNo: contracts.contractNo, contractStatus: contracts.status,
        customerId: customers.id, customerName: customers.fullName,
      })
      .from(installments)
      .innerJoin(contracts, eq(contracts.id, installments.contractId))
      .innerJoin(customers, eq(customers.id, contracts.customerId)),
    db.select({ id: contracts.id, status: contracts.status }).from(contracts),
    db.select({ id: customers.id }).from(customers),
    db
      .select({
        id: payments.id, amount: payments.amount, method: payments.method, status: payments.status,
        createdAt: payments.createdAt, customerId: payments.customerId,
        contractId: payments.contractId, contractNo: contracts.contractNo, customerName: customers.fullName,
      })
      .from(payments)
      .innerJoin(contracts, eq(contracts.id, payments.contractId))
      .innerJoin(customers, eq(customers.id, payments.customerId))
      .orderBy(desc(payments.createdAt))
      .limit(200),
    db.select({ status: smsLogs.status }).from(smsLogs),
  ]);
  void sms;

  const activePayable = payable.filter((p) => p.contractStatus === "ACTIVE");
  const outstanding = activePayable.filter((p) => (PAYABLE as readonly string[]).includes(p.status));

  let receivablesPenalty = 0;
  const overdueRows: DashboardData["overdue"] = [];
  for (const r of activePayable) {
    const display = deriveInstallmentStatus(r.status, r.dueDate, today);
    if (display !== "OVERDUE") continue;
    const p = computePenalty(r.amount, r.dueDate, today, finance, r.penaltyForgiven);
    receivablesPenalty += p.penalty;
    overdueRows.push({
      id: r.id, seq: r.seq, dueDate: r.dueDate, amount: r.amount,
      penalty: p.penalty, daysLate: p.daysLate, contractNo: r.contractNo,
      contractId: r.contractId, customerName: r.customerName, customerId: r.customerId,
    });
  }
  overdueRows.sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  const confirmedPayments = paymentRows.filter((p) => p.status === CONFIRMED);
  const todayCollections = confirmedPayments
    .filter((p) => p.createdAt >= dayStart)
    .reduce((a, p) => a + p.amount, 0);
  const monthCollections = confirmedPayments
    .filter((p) => p.createdAt >= monthStartTs)
    .reduce((a, p) => a + p.amount, 0);

  // Monthly collections for the previous 12 Jalali months (CONFIRMED only).
  const months = lastTwelveJalaliMonths(today);
  const monthly = months.map((m) => {
    const from = new Date(`${m.start}T00:00:00+03:30`);
    const to = new Date(`${m.end}T00:00:00+03:30`);
    const value = confirmedPayments
      .filter((p) => p.createdAt >= from && p.createdAt < to)
      .reduce((a, p) => a + p.amount, 0);
    return { label: monthLabel(m.start), value };
  });

  const methodTotals = new Map<string, number>();
  for (const p of confirmedPayments) methodTotals.set(p.method, (methodTotals.get(p.method) ?? 0) + p.amount);

  // Overdue vs on-time: among installments that reached a due date, compare
  // PAID-on-or-before-due against everything paid late or still overdue.
  let onTime = 0;
  let late = 0;
  for (const r of payable) {
    const display = deriveInstallmentStatus(r.status, r.dueDate, today);
    if (r.status === "PAID" && r.paidAt) {
      const paidDay = r.paidAt.toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" });
      if (paidDay <= r.dueDate) onTime += 1;
      else late += 1;
    } else if (display === "OVERDUE") {
      late += 1;
    }
  }
  const onTimeRate = onTime + late > 0 ? Math.round((onTime / (onTime + late)) * 100) : 100;

  const contractStatus: Record<string, number> = { ACTIVE: 0, SETTLED: 0, CANCELED: 0 };
  for (const c of contractRows) contractStatus[c.status] = (contractStatus[c.status] ?? 0) + 1;

  const pending = paymentRows.filter((p) => p.status === "PENDING_VERIFICATION");
  const pendingVerificationCount = pending.length;
  const pendingVerificationAmount = pending.reduce((a, p) => a + p.amount, 0);

  // High-overdue customers: 2+ overdue installments or 45+ days past the oldest.
  const byCustomer = new Map<string, { name: string; count: number; amount: number; oldestDays: number }>();
  for (const o of overdueRows) {
    const cur = byCustomer.get(o.customerId) ?? { name: o.customerName, count: 0, amount: 0, oldestDays: 0 };
    cur.count += 1;
    cur.amount += o.amount;
    cur.oldestDays = Math.max(cur.oldestDays, o.daysLate);
    byCustomer.set(o.customerId, cur);
  }
  const highOverdueCustomers = [...byCustomer.entries()]
    .filter(([, v]) => v.count >= 2 || v.oldestDays >= 45)
    .map(([customerId, v]) => ({ customerId, ...v }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 6);

  const upcomingRows = activePayable
    .filter((r) => r.status === "PENDING" && r.dueDate >= today)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
    .slice(0, 8)
    .map((r) => ({
      id: r.id, seq: r.seq, dueDate: r.dueDate, amount: r.amount,
      contractNo: r.contractNo, contractId: r.contractId, customerName: r.customerName, customerId: r.customerId,
    }));

  return {
    today,
    receivablesPrincipal: outstanding.reduce((a, r) => a + r.amount, 0),
    receivablesPenalty,
    totalReceivables: outstanding.reduce((a, r) => a + r.amount, 0) + receivablesPenalty,
    overdueCount: overdueRows.length,
    overdueAmount: overdueRows.reduce((a, r) => a + r.amount, 0),
    todayCollections,
    monthCollections,
    activeContracts: contractStatus.ACTIVE ?? 0,
    totalContracts: contractRows.length,
    contractStatus,
    customerCount: customerRows.length,
    monthly,
    methodMix: [...methodTotals.entries()].map(([k, v]) => ({ name: k, value: v })),
    onTime,
    late,
    onTimeRate,
    upcoming: upcomingRows,
    overdue: overdueRows.slice(0, 10),
    recentPayments: paymentRows.slice(0, 6).map((p) => ({
      id: p.id, amount: p.amount, method: p.method, status: p.status, createdAt: p.createdAt,
      customerName: p.customerName, contractNo: p.contractNo, contractId: p.contractId,
    })),
    pendingVerificationCount,
    pendingVerificationAmount,
    highOverdueCustomers,
  };
}

function monthLabel(greg: string) {
  const { FA_MONTHS, gregToJalali } = require("@/lib/jalali") as typeof import("@/lib/jalali");
  const { jy, jm } = gregToJalali(greg);
  return `${FA_MONTHS[jm - 1]} ${jy}`;
}

/* ---------------------------------- Reports --------------------------------- */

export interface ReportResult<T> {
  rows: T[];
  totals?: Record<string, number>;
  pagination?: { page: number; pageSize: number; total: number; pages: number };
}

/** 1. Overdue installment report */
export async function overdueReport(f: ReportFilters, finance?: FinanceSettings) {
  const settings = finance ?? (await getFinanceSettings());
  const today = todayGreg();
  const conds = [
    inArray(installments.status, ["PENDING"]),
    lte(installments.dueDate, today),
  ] as const;
  const rows = await db
    .select({
      id: installments.id, seq: installments.seq, dueDate: installments.dueDate,
      amount: installments.amount, penaltyForgiven: installments.penaltyForgiven,
      contractId: contracts.id, contractNo: contracts.contractNo, contractStatus: contracts.status,
      customerName: customers.fullName, customerId: customers.id, mobile: customers.mobile,
    })
    .from(installments)
    .innerJoin(contracts, eq(contracts.id, installments.contractId))
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(and(...conds, f.customerId ? eq(contracts.customerId, f.customerId) : undefined))
    .orderBy(asc(installments.dueDate));

  const mapped = rows
    .filter((r) => r.contractStatus !== "CANCELED")
    .map((r) => {
      const p = computePenalty(r.amount, r.dueDate, today, settings, r.penaltyForgiven);
      return {
        customerId: r.customerId, customerName: r.customerName, mobile: r.mobile,
        contractNo: r.contractNo, contractId: r.contractId, seq: r.seq,
        dueDate: r.dueDate, daysLate: p.rawDaysLate, chargeableDays: p.daysLate,
        amount: r.amount, penalty: p.penalty, total: r.amount + p.penalty,
        penaltyForgiven: r.penaltyForgiven,
      };
    });

  const page = f.page ?? 1;
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const start = (page - 1) * pageSize;
  return {
    rows: mapped.slice(start, start + pageSize),
    totals: {
      count: mapped.length,
      amount: mapped.reduce((a, r) => a + r.amount, 0),
      penalty: mapped.reduce((a, r) => a + r.penalty, 0),
      total: mapped.reduce((a, r) => a + r.total, 0),
    },
    pagination: { page, pageSize, total: mapped.length, pages: Math.max(1, Math.ceil(mapped.length / pageSize)) },
  };
}

/** 2. Income report — CONFIRMED collections only. */
export async function incomeReport(f: ReportFilters) {
  const conds = [
    eq(payments.status, CONFIRMED),
    gte(payments.createdAt, new Date(`${f.from}T00:00:00+03:30`)),
    lte(payments.createdAt, new Date(`${f.to}T23:59:59+03:30`)),
  ];
  if (f.paymentMethod) conds.push(eq(payments.method, f.paymentMethod));
  if (f.customerId) conds.push(eq(payments.customerId, f.customerId));

  const rows = await db
    .select({
      id: payments.id, paidAt: payments.paidAt, createdAt: payments.createdAt,
      amount: payments.amount, penaltyAmount: payments.penaltyAmount, method: payments.method,
      isSettlement: payments.isSettlement,
      contractNo: contracts.contractNo, contractId: contracts.id,
      customerName: customers.fullName, customerId: customers.id,
    })
    .from(payments)
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(and(...conds))
    .orderBy(desc(payments.createdAt));

  const mapped = rows.map((r) => ({
    ...r,
    principal: r.amount - r.penaltyAmount,
    effectiveDate: (r.paidAt ?? r.createdAt).toLocaleDateString("en-CA", { timeZone: "Asia/Tehran" }),
  }));
  const byMethod = new Map<string, number>();
  for (const r of mapped) byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + r.amount);

  return {
    rows: mapped,
    totals: {
      count: mapped.length,
      collected: mapped.reduce((a, r) => a + r.amount, 0),
      principal: mapped.reduce((a, r) => a + r.principal, 0),
      penalty: mapped.reduce((a, r) => a + r.penaltyAmount, 0),
    },
    byMethod: [...byMethod.entries()],
  };
}

/** 3. Customer financial report */
export async function customerReport(f: ReportFilters) {
  const [custs, allInstallments, allPayments] = await Promise.all([
    db.select().from(customers).orderBy(asc(customers.fullName)),
    db
      .select({
        customerId: contracts.customerId, amount: installments.amount, status: installments.status,
        dueDate: installments.dueDate, paidAt: installments.paidAt, penaltyForgiven: installments.penaltyForgiven,
        contractStatus: contracts.status,
      })
      .from(installments)
      .innerJoin(contracts, eq(contracts.id, installments.contractId)),
    db
      .select({ customerId: payments.customerId, amount: payments.amount, status: payments.status, createdAt: payments.createdAt })
      .from(payments)
      .where(and(eq(payments.status, CONFIRMED), gte(payments.createdAt, new Date(`${f.from}T00:00:00+03:30`)), lte(payments.createdAt, new Date(`${f.to}T23:59:59+03:30`)))),
  ]);

  const today = todayGreg();
  const finance = await getFinanceSettings();
  const rows = custs
    .filter((c) => (f.customerId ? c.id === f.customerId : true))
    .map((c) => {
      const inst = allInstallments.filter((i) => i.customerId === c.id && i.contractStatus !== "CANCELED");
      const payable = inst.filter((i) => (PAYABLE as readonly string[]).includes(i.status));
      let penalty = 0;
      let overdueCount = 0;
      for (const i of inst) {
        if (deriveInstallmentStatus(i.status, i.dueDate, today) === "OVERDUE") {
          penalty += computePenalty(i.amount, i.dueDate, today, finance, i.penaltyForgiven).penalty;
          overdueCount += 1;
        }
      }
      const collected = allPayments.filter((p) => p.customerId === c.id).reduce((a, p) => a + p.amount, 0);
      return {
        customerId: c.id, fullName: c.fullName, nationalCode: c.nationalCode, mobile: c.mobile,
        creditScore: c.creditScore, isActive: c.isActive, isBlacklisted: c.isBlacklisted,
        contractCount: new Set(inst.map((i) => i.customerId)).size,
        outstanding: payable.reduce((a, i) => a + i.amount, 0),
        penalty, overdueCount, collected,
        receivable: payable.reduce((a, i) => a + i.amount, 0) + penalty,
      };
    });
  return {
    rows,
    totals: {
      count: rows.length,
      outstanding: rows.reduce((a, r) => a + r.outstanding, 0),
      penalty: rows.reduce((a, r) => a + r.penalty, 0),
      collected: rows.reduce((a, r) => a + r.collected, 0),
      receivable: rows.reduce((a, r) => a + r.receivable, 0),
    },
  };
}

/** 4. Contract report */
export async function contractReport(f: ReportFilters) {
  const conds = [
    gte(contracts.createdAt, new Date(`${f.from}T00:00:00+03:30`)),
    lte(contracts.createdAt, new Date(`${f.to}T23:59:59+03:30`)),
  ];
  if (f.contractStatus) conds.push(eq(contracts.status, f.contractStatus));
  if (f.contractType) conds.push(eq(contracts.type, f.contractType));
  if (f.customerId) conds.push(eq(contracts.customerId, f.customerId));

  const rows = await db
    .select({
      id: contracts.id, contractNo: contracts.contractNo, type: contracts.type, status: contracts.status,
      itemDescription: contracts.itemDescription, cashPrice: contracts.cashPrice, totalPrice: contracts.totalPrice,
      downPayment: contracts.downPayment, installmentCount: contracts.installmentCount,
      installmentAmount: contracts.installmentAmount, createdAt: contracts.createdAt,
      customerName: customers.fullName, customerId: customers.id,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(and(...conds))
    .orderBy(desc(contracts.createdAt));

  const ids = rows.map((r) => r.id);
  const inst = ids.length
    ? await db
        .select({ contractId: installments.contractId, status: installments.status, amount: installments.amount })
        .from(installments)
        .where(inArray(installments.contractId, ids))
    : [];
  const paidTotals = new Map<string, { count: number; amount: number }>();
  for (const i of inst) {
    if (i.status !== "PAID") continue;
    const cur = paidTotals.get(i.contractId) ?? { count: 0, amount: 0 };
    cur.count += 1;
    cur.amount += i.amount;
    paidTotals.set(i.contractId, cur);
  }

  const mapped = rows.map((r) => ({
    ...r,
    paidCount: paidTotals.get(r.id)?.count ?? 0,
    paidAmount: paidTotals.get(r.id)?.amount ?? 0,
    margin: r.type === "INSTALLMENT" ? r.totalPrice - r.cashPrice : 0,
  }));
  return {
    rows: mapped,
    totals: {
      count: mapped.length,
      totalValue: mapped.reduce((a, r) => a + r.totalPrice, 0),
      cashValue: mapped.reduce((a, r) => a + r.cashPrice, 0),
      contractMargin: mapped.reduce((a, r) => a + r.margin, 0),
      paidAmount: mapped.reduce((a, r) => a + r.paidAmount, 0),
    },
  };
}

/**
 * 5. Profit report.
 * Contractual margin = totalPrice − cashPrice for installment contracts only.
 * This is NOT realized cash income: it accrues over the contract's life and is
 * fully realized only when the final installment settles.
 */
export async function profitReport(f: ReportFilters) {
  const conds = [
    gte(contracts.createdAt, new Date(`${f.from}T00:00:00+03:30`)),
    lte(contracts.createdAt, new Date(`${f.to}T23:59:59+03:30`)),
    eq(contracts.type, "INSTALLMENT"),
  ];
  if (f.contractStatus) conds.push(eq(contracts.status, f.contractStatus));
  if (f.customerId) conds.push(eq(contracts.customerId, f.customerId));

  const rows = await db
    .select({
      id: contracts.id, contractNo: contracts.contractNo, status: contracts.status,
      cashPrice: contracts.cashPrice, totalPrice: contracts.totalPrice,
      downPayment: contracts.downPayment, installmentCount: contracts.installmentCount,
      createdAt: contracts.createdAt, customerName: customers.fullName,
    })
    .from(contracts)
    .innerJoin(customers, eq(customers.id, contracts.customerId))
    .where(and(...conds))
    .orderBy(desc(contracts.createdAt));

  const ids = rows.map((r) => r.id);
  const inst = ids.length
    ? await db
        .select({ contractId: installments.contractId, status: installments.status, amount: installments.amount })
        .from(installments)
        .where(inArray(installments.contractId, ids))
    : [];
  const counts = new Map<string, { total: number; paid: number; paidAmount: number }>();
  for (const i of inst) {
    const cur = counts.get(i.contractId) ?? { total: 0, paid: 0, paidAmount: 0 };
    cur.total += 1;
    if (i.status === "PAID") {
      cur.paid += 1;
      cur.paidAmount += i.amount;
    }
    counts.set(i.contractId, cur);
  }

  const mapped = rows.map((r) => {
    const c = counts.get(r.id) ?? { total: 0, paid: 0, paidAmount: 0 };
    const margin = r.totalPrice - r.cashPrice;
    // Realized portion of the margin, proportional to settled installments.
    const realizationRate = c.total > 0 ? c.paid / c.total : 0;
    return {
      ...r,
      margin,
      marginPercent: r.cashPrice > 0 ? (margin / r.cashPrice) * 100 : 0,
      paidCount: c.paid, totalCount: c.total, realizationRate,
      realizedMargin: Math.round(margin * realizationRate),
      settled: c.total > 0 && c.paid === c.total,
    };
  });

  return {
    rows: mapped,
    totals: {
      count: mapped.length,
      cashValue: mapped.reduce((a, r) => a + r.cashPrice, 0),
      totalValue: mapped.reduce((a, r) => a + r.totalPrice, 0),
      contractMargin: mapped.reduce((a, r) => a + r.margin, 0),
      realizedMargin: mapped.reduce((a, r) => a + r.realizedMargin, 0),
    },
  };
}

/** 6. Payment verification report */
export async function verificationReport(f: ReportFilters) {
  const conds = [
    gte(payments.createdAt, new Date(`${f.from}T00:00:00+03:30`)),
    lte(payments.createdAt, new Date(`${f.to}T23:59:59+03:30`)),
  ];
  if (f.paymentMethod) conds.push(eq(payments.method, f.paymentMethod));
  if (f.customerId) conds.push(eq(payments.customerId, f.customerId));

  const rows = await db
    .select({
      id: payments.id, method: payments.method, status: payments.status, amount: payments.amount,
      referenceNo: payments.referenceNo, sourceCardNumber: payments.sourceCardNumber,
      createdAt: payments.createdAt, reviewedAt: payments.reviewedAt, reviewNote: payments.reviewNote,
      isResubmittable: payments.isResubmittable, resubmissionOf: payments.resubmissionOf,
      submittedBy: payments.submittedBy, reviewedBy: payments.reviewedBy,
      contractNo: contracts.contractNo, customerName: customers.fullName, customerId: customers.id,
    })
    .from(payments)
    .innerJoin(contracts, eq(contracts.id, payments.contractId))
    .innerJoin(customers, eq(customers.id, payments.customerId))
    .where(and(...conds))
    .orderBy(desc(payments.createdAt));

  const statusCounts: Record<string, number> = {};
  const statusAmounts: Record<string, number> = {};
  for (const r of rows) {
    statusCounts[r.status] = (statusCounts[r.status] ?? 0) + 1;
    statusAmounts[r.status] = (statusAmounts[r.status] ?? 0) + r.amount;
  }
  const decided = rows.filter((r) => r.reviewedAt);
  const avgHours = decided.length
    ? decided.reduce((a, r) => a + (r.reviewedAt!.getTime() - r.createdAt.getTime()) / 3_600_000, 0) / decided.length
    : 0;

  const page = f.page ?? 1;
  const pageSize = Math.min(f.pageSize ?? 50, 200);
  const start = (page - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize).map((r) => ({
      ...r,
      sourceCardNumber: r.sourceCardNumber
        ? `${r.sourceCardNumber.slice(0, 4)}-****-****-${r.sourceCardNumber.slice(12)}`
        : null,
      reviewHours: r.reviewedAt ? (r.reviewedAt.getTime() - r.createdAt.getTime()) / 3_600_000 : null,
    })),
    totals: {
      count: rows.length,
      pendingCount: statusCounts.PENDING_VERIFICATION ?? 0,
      pendingAmount: statusAmounts.PENDING_VERIFICATION ?? 0,
      confirmedCount: statusCounts.CONFIRMED ?? 0,
      confirmedAmount: statusAmounts.CONFIRMED ?? 0,
      rejectedCount: statusCounts.REJECTED ?? 0,
      rejectedAmount: statusAmounts.REJECTED ?? 0,
      avgReviewHours: Math.round(avgHours * 10) / 10,
    },
    pagination: { page, pageSize, total: rows.length, pages: Math.max(1, Math.ceil(rows.length / pageSize)) },
  };
}

/** 7. SMS delivery report */
export async function smsReport(f: ReportFilters) {
  const rows = await db
    .select({
      id: smsLogs.id, phone: smsLogs.phone, body: smsLogs.body, status: smsLogs.status,
      detail: smsLogs.detail, createdAt: smsLogs.createdAt, customerName: customers.fullName,
    })
    .from(smsLogs)
    .leftJoin(customers, eq(customers.id, smsLogs.customerId))
    .where(and(gte(smsLogs.createdAt, new Date(`${f.from}T00:00:00+03:30`)), lte(smsLogs.createdAt, new Date(`${f.to}T23:59:59+03:30`))))
    .orderBy(desc(smsLogs.createdAt))
    .limit(500);

  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] ?? 0) + 1;
  const total = rows.length;
  return {
    rows,
    totals: {
      count: total,
      sent: counts.SENT ?? 0,
      simulated: counts.SIMULATED ?? 0,
      failed: counts.FAILED ?? 0,
      deliveryRate: total > 0 ? Math.round(((counts.SENT ?? 0) / total) * 100) : 0,
    },
  };
}

/** Confirmed collections in a range — used to cross-check income reports. */
export async function confirmedCollections(from: string, to: string) {
  const r = await db
    .select({ total: sql<string>`coalesce(sum(${payments.amount}), 0)`, count: sql<string>`count(*)` })
    .from(payments)
    .where(and(eq(payments.status, CONFIRMED), gte(payments.createdAt, new Date(`${from}T00:00:00+03:30`)), lte(payments.createdAt, new Date(`${to}T23:59:59+03:30`))));
  return { total: Number(r[0]?.total ?? 0), count: Number(r[0]?.count ?? 0) };
}

export const RECEIVABLE_STATUS_FILTER = PAYABLE;
export const unpaidInstallments = () =>
  db.select({ id: installments.id }).from(installments).where(isNull(installments.paidAt));
