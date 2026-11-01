import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { BarChart3, FileSpreadsheet, Printer } from "lucide-react";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import {
  contractReport, customerReport, incomeReport, overdueReport, profitReport, smsReport, verificationReport,
  type ReportFilters,
} from "@/server/reports";
import { addMonthsJalali, formatJalali, jalaliMonthStart, todayGreg } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { fmtDate, fmtNum, fmtToman, toFaDigits, PAYMENT_METHOD_FA, CONTRACT_STATUS_FA } from "@/lib/format";
import { Badge, Card, EmptyState, PageHeader, StatusBadge, MethodBadge, TableShell } from "@/components/ui";
import { ExportXlsxButton } from "@/components/export-xlsx";
import { MonthlyBars } from "@/components/charts";
import { ReportFilters as ReportFiltersForm } from "@/components/report-filters";

export const dynamic = "force-dynamic";

const REPORTS = [
  { key: "overdue", label: "اقساط معوقه" },
  { key: "income", label: "درآمد" },
  { key: "customers", label: "مالی مشتریان" },
  { key: "contracts", label: "قراردادها" },
  { key: "profit", label: "سود قراردادی" },
  { key: "verification", label: "بررسی پرداخت‌ها" },
  { key: "sms", label: "ارسال پیامک" },
] as const;
type ReportKey = (typeof REPORTS)[number]["key"];

const STATUS_FA: Record<string, string> = { SENT: "ارسال شد", SIMULATED: "شبیه‌سازی", FAILED: "ناموفق" };

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    report?: string; from?: string; to?: string; customerId?: string;
    status?: string; method?: string; type?: string; page?: string;
  }>;
}) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const sp = await searchParams;
  const report = (REPORTS.find((r) => r.key === sp.report)?.key ?? "overdue") as ReportKey;

  const today = todayGreg();
  const monthStart = jalaliMonthStart(today);
  const from = sp.from?.match(/^\d{4}-\d{2}-\d{2}$/) ? sp.from : addMonthsJalali(monthStart, -11);
  const to = sp.to?.match(/^\d{4}-\d{2}-\d{2}$/) ? sp.to : today;
  const page = Math.max(1, Number(sp.page ?? 1) || 1);

  const filters: ReportFilters = {
    from, to, page, pageSize: 50,
    customerId: sp.customerId || undefined,
    contractStatus: sp.status === "ACTIVE" || sp.status === "SETTLED" || sp.status === "CANCELED" ? sp.status : undefined,
    contractType: sp.type === "CASH" || sp.type === "INSTALLMENT" ? sp.type : undefined,
    paymentMethod: sp.method === "CASH" || sp.method === "CARD_READER" || sp.method === "CARD_TO_CARD" ? sp.method : undefined,
  };

  const [customerOptions] = await Promise.all([
    db.select({ id: customers.id, fullName: customers.fullName }).from(customers).orderBy(asc(customers.fullName)),
  ]);

  const overdue = report === "overdue" ? await overdueReport(filters) : null;
  const income = report === "income" ? await incomeReport(filters) : null;
  const custFin = report === "customers" ? await customerReport(filters) : null;
  const contracts = report === "contracts" ? await contractReport(filters) : null;
  const profit = report === "profit" ? await profitReport(filters) : null;
  const verification = report === "verification" ? await verificationReport(filters) : null;
  const sms = report === "sms" ? await smsReport(filters) : null;

  // Sheet rows for the Excel export of the currently visible report.
  let sheetRows: Record<string, string | number | null>[] = [];
  let sheetName = "گزارش";
  if (overdue) {
    sheetName = "اقساط معوقه";
    sheetRows = overdue.rows.map((r) => ({
      مشتری: r.customerName, "کد ملی": r.customerName ? "" : "", قرارداد: r.contractNo, قسط: r.seq,
      سررسید: formatJalali(r.dueDate), "روزهای تأخیر": r.daysLate, "روزهای مشمول": r.chargeableDays,
      "مبلغ قسط": r.amount, جریمه: r.penalty, "جمع قابل دریافت": r.total, "بخشودگی جریمه": r.penaltyForgiven ? "بله" : "خیر",
    }));
  } else if (income) {
    sheetName = "درآمد";
    sheetRows = income.rows.map((r) => ({
      تاریخ: r.effectiveDate, مشتری: r.customerName, قرارداد: r.contractNo,
      "اصل (تومان)": r.principal, "جریمه (تومان)": r.penaltyAmount, "جمع (تومان)": r.amount,
      روش: PAYMENT_METHOD_FA[r.method] ?? r.method, تسویه: r.isSettlement ? "بله" : "خیر",
    }));
  } else if (custFin) {
    sheetName = "مالی مشتریان";
    sheetRows = custFin.rows.map((r) => ({
      مشتری: r.fullName, "کد ملی": r.nationalCode, موبایل: r.mobile, "امتیاز اعتباری": r.creditScore,
      "اقساط باز": r.outstanding, جریمه: r.penalty, "معوقه": r.overdueCount,
      "دریافتی در بازه": r.collected, "کل مطالبات": r.receivable,
      وضعیت: r.isBlacklisted ? "فهرست سیاه" : r.isActive ? "فعال" : "غیرفعال",
    }));
  } else if (contracts) {
    sheetName = "قراردادها";
    sheetRows = contracts.rows.map((r) => ({
      "شماره قرارداد": r.contractNo, مشتری: r.customerName,
      نوع: r.type === "CASH" ? "نقدی" : "اقساطی", وضعیت: CONTRACT_STATUS_FA[r.status],
      "شرح": r.itemDescription, "قیمت نقدی": r.cashPrice, "مبلغ کل": r.totalPrice,
      پیش‌پرداخت: r.downPayment, "تعداد اقساط": r.installmentCount,
      "اقساط پرداخت‌شده": r.paidCount, "مبلغ پرداخت‌شده": r.paidAmount,
      "مابه‌التفاوت قراردادی": r.margin, "تاریخ ثبت": formatJalali(r.createdAt),
    }));
  } else if (profit) {
    sheetName = "سود قراردادی";
    sheetRows = profit.rows.map((r) => ({
      "شماره قرارداد": r.contractNo, مشتری: r.customerName, وضعیت: CONTRACT_STATUS_FA[r.status],
      "قیمت نقدی": r.cashPrice, "مبلغ کل اقساطی": r.totalPrice,
      "مابه‌التفاوت قراردادی": r.margin, "درصد مابه‌التفاوت": Math.round(r.marginPercent * 100) / 100,
      "اقساط پرداخت‌شده": `${r.paidCount}/${r.totalCount}`,
      "سهم تحقق‌یافته": Math.round(r.realizationRate * 100),
      "سود تحقق‌یافته": r.realizedMargin, "تاریخ ثبت": formatJalali(r.createdAt),
    }));
  } else if (verification) {
    sheetName = "بررسی پرداخت‌ها";
    sheetRows = verification.rows.map((r) => ({
      مشتری: r.customerName, قرارداد: r.contractNo, "مبلغ": r.amount,
      روش: PAYMENT_METHOD_FA[r.method] ?? r.method, وضعیت: r.status,
      پیگیری: r.referenceNo ?? "", "کارت مبدأ": r.sourceCardNumber ?? "",
      "زمان ثبت": formatJalali(r.createdAt, true), "زمان بررسی": r.reviewedAt ? formatJalali(r.reviewedAt, true) : "",
      "ساعت تا بررسی": r.reviewHours ?? "", "دلیل رد": r.reviewNote ?? "",
    }));
  } else if (sms) {
    sheetName = "ارسال پیامک";
    sheetRows = sms.rows.map((r) => ({
      مشتری: r.customerName ?? "—", موبایل: r.phone, متن: r.body,
      وضعیت: STATUS_FA[r.status] ?? r.status, "زمان": formatJalali(r.createdAt, true), جزئیات: r.detail ?? "",
    }));
  }

  const pag = overdue?.pagination ?? verification?.pagination;
  const queryFor = (patch: Record<string, string | undefined>) => {
    const params = new URLSearchParams();
    const base: Record<string, string | undefined> = {
      report, from, to, customerId: sp.customerId, status: sp.status, method: sp.method, type: sp.type,
      ...patch,
    };
    for (const [k, v] of Object.entries(base)) if (v) params.set(k, v);
    return `/reports?${params.toString()}`;
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="گزارش‌های مالی و عملیاتی"
        subtitle={`بازه: ${fmtDate(formatJalali(from), fa)} تا ${fmtDate(formatJalali(to), fa)}`}
        actions={
          <>
            <ExportXlsxButton fileName={`report-${report}-${to}`} sheets={[{ name: sheetName, rows: sheetRows }]} label="خروجی اکسل" />
            <Link href={`/reports/print?${new URLSearchParams({ report, from, to, customerId: sp.customerId ?? "", status: sp.status ?? "", method: sp.method ?? "", type: sp.type ?? "" }).toString()}`} className="btn btn-outline btn-sm" prefetch={false}>
              <Printer className="size-4" />
              نسخه چاپ / PDF
            </Link>
          </>
        }
      />

      {/* Filters — actual Jalali pickers, persisted through the URL query. */}
      <Card>
        <ReportFiltersForm
          report={report}
          initial={{
            from,
            to,
            customerId: sp.customerId,
            status: sp.status,
            method: sp.method,
            type: sp.type,
          }}
          customers={customerOptions}
        />
      </Card>

      {/* Report tabs */}
      <div className="flex flex-wrap gap-2">
        {REPORTS.map((r) => (
          <Link key={r.key} href={queryFor({ report: r.key, page: undefined })} className={`btn btn-sm ${report === r.key ? "btn-primary" : "btn-outline"}`} prefetch={false}>
            {r.label}
          </Link>
        ))}
      </div>

      {/* 1. Overdue */}
      {overdue ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><p className="text-xs text-muted">تعداد اقساط معوقه</p><p className="mt-1 text-lg font-bold">{fmtNum(overdue.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">اصل معوقه</p><p className="mt-1 text-lg font-bold">{fmtToman(overdue.totals!.amount, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جریمه accrued</p><p className="mt-1 text-lg font-bold text-[var(--danger)]">{fmtToman(overdue.totals!.penalty, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جمع قابل دریافت</p><p className="mt-1 text-lg font-bold text-[var(--danger)]">{fmtToman(overdue.totals!.total, fa)}</p></Card>
          </div>
          <Card>
            <h2 className="mb-4 text-sm font-bold">گزارش اقساط معوقه</h2>
            {overdue.rows.length === 0 ? <EmptyState title="قسط معوقه‌ای وجود ندارد" /> : (
              <TableShell>
                <thead><tr><th>مشتری</th><th>قرارداد</th><th>قسط</th><th>سررسید</th><th>تأخیر</th><th>مبلغ</th><th>جریمه</th><th>جمع</th></tr></thead>
                <tbody>
                  {overdue.rows.map((r) => (
                    <tr key={`${r.contractId}-${r.seq}`}>
                      <td className="font-medium">{r.customerName}</td>
                      <td><span dir="ltr">{r.contractNo}</span></td>
                      <td>{fmtNum(r.seq, fa)}</td>
                      <td>{fmtDate(formatJalali(r.dueDate), fa)}</td>
                      <td><Badge tone={r.daysLate >= 45 ? "danger" : "warning"}>{fmtNum(r.daysLate, fa)} روز</Badge></td>
                      <td>{fmtToman(r.amount, fa)}</td>
                      <td className="text-[var(--danger)]">{r.penalty > 0 ? fmtToman(r.penalty, fa) : "—"}</td>
                      <td className="font-bold">{fmtToman(r.total, fa)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* 2. Income */}
      {income ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><p className="text-xs text-muted">تعداد دریافتی</p><p className="mt-1 text-lg font-bold">{fmtNum(income.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جمع دریافتی (تأییدشده)</p><p className="mt-1 text-lg font-bold text-[var(--success)]">{fmtToman(income.totals!.collected, fa)}</p></Card>
            <Card><p className="text-xs text-muted">اصل اقساط</p><p className="mt-1 text-lg font-bold">{fmtToman(income.totals!.principal, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جریمه دریافتی</p><p className="mt-1 text-lg font-bold">{fmtToman(income.totals!.penalty, fa)}</p></Card>
          </div>
          <Card>
            <h2 className="mb-1 text-sm font-bold">گزارش درآمد</h2>
            <p className="mb-4 text-[11px] text-muted">فقط پرداخت‌های «تأییدشده» لحاظ شده‌اند؛ فیش‌های در انتظار تأیید و ردشده درآمد محسوب نمی‌شوند.</p>
            {income.rows.length === 0 ? <EmptyState title="دریافتی در این بازه ثبت نشده است" /> : (
              <TableShell>
                <thead><tr><th>تاریخ</th><th>مشتری</th><th>قرارداد</th><th>اصل</th><th>جریمه</th><th>جمع</th><th>روش</th></tr></thead>
                <tbody>
                  {income.rows.map((r) => (
                    <tr key={r.id}>
                      <td>{fmtDate(formatJalali(r.effectiveDate), fa)}</td>
                      <td className="font-medium">{r.customerName}</td>
                      <td><span dir="ltr">{r.contractNo}</span></td>
                      <td>{fmtToman(r.principal, fa)}</td>
                      <td>{r.penaltyAmount > 0 ? fmtToman(r.penaltyAmount, fa) : "—"}</td>
                      <td className="font-bold">{fmtToman(r.amount, fa)}</td>
                      <td><MethodBadge method={r.method} />{r.isSettlement ? <Badge tone="info">تسویه</Badge> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* 3. Customer financial */}
      {custFin ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><p className="text-xs text-muted">تعداد مشتریان</p><p className="mt-1 text-lg font-bold">{fmtNum(custFin.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">اصل اقساط باز</p><p className="mt-1 text-lg font-bold">{fmtToman(custFin.totals!.outstanding, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جریمه accrued</p><p className="mt-1 text-lg font-bold">{fmtToman(custFin.totals!.penalty, fa)}</p></Card>
            <Card><p className="text-xs text-muted">کل مطالبات</p><p className="mt-1 text-lg font-bold text-[var(--warning)]">{fmtToman(custFin.totals!.receivable, fa)}</p></Card>
          </div>
          <Card>
            <h2 className="mb-4 text-sm font-bold">گزارش مالی مشتریان</h2>
            {custFin.rows.length === 0 ? <EmptyState title="مشتری ثبت نشده است" /> : (
              <TableShell>
                <thead><tr><th>مشتری</th><th>امتیاز</th><th>اقساط باز</th><th>معوقه</th><th>جریمه</th><th>دریافتی بازه</th><th>کل مطالبات</th><th>وضعیت</th></tr></thead>
                <tbody>
                  {custFin.rows.map((r) => (
                    <tr key={r.customerId}>
                      <td className="font-medium">
                        <Link href={`/customers/${r.customerId}`} className="text-brand hover:underline" prefetch={false}>{r.fullName}</Link>
                      </td>
                      <td>{fmtNum(r.creditScore, fa)}</td>
                      <td>{fmtToman(r.outstanding, fa)}</td>
                      <td>{r.overdueCount > 0 ? <Badge tone="danger">{fmtNum(r.overdueCount, fa)}</Badge> : "—"}</td>
                      <td className="text-[var(--danger)]">{r.penalty > 0 ? fmtToman(r.penalty, fa) : "—"}</td>
                      <td>{fmtToman(r.collected, fa)}</td>
                      <td className="font-bold">{fmtToman(r.receivable, fa)}</td>
                      <td>
                        <div className="flex gap-1">
                          <Badge tone={r.isActive ? "success" : "danger"}>{r.isActive ? "فعال" : "غیرفعال"}</Badge>
                          {r.isBlacklisted ? <Badge tone="danger">سیاه</Badge> : null}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* 4. Contracts */}
      {contracts ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Card><p className="text-xs text-muted">تعداد قرارداد</p><p className="mt-1 text-lg font-bold">{fmtNum(contracts.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">ارزش کل</p><p className="mt-1 text-lg font-bold">{fmtToman(contracts.totals!.totalValue, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جمع قیمت نقدی</p><p className="mt-1 text-lg font-bold">{fmtToman(contracts.totals!.cashValue, fa)}</p></Card>
            <Card><p className="text-xs text-muted">مابه‌التفاوت قراردادی</p><p className="mt-1 text-lg font-bold">{fmtToman(contracts.totals!.contractMargin, fa)}</p></Card>
            <Card><p className="text-xs text-muted">پرداخت‌شده</p><p className="mt-1 text-lg font-bold text-[var(--success)]">{fmtToman(contracts.totals!.paidAmount, fa)}</p></Card>
          </div>
          <Card>
            <h2 className="mb-4 text-sm font-bold">گزارش قراردادها</h2>
            {contracts.rows.length === 0 ? <EmptyState title="قراردادی در این بازه ثبت نشده است" /> : (
              <TableShell>
                <thead><tr><th>شماره</th><th>مشتری</th><th>نوع</th><th>قیمت نقدی</th><th>مبلغ کل</th><th>مابه‌التفاوت</th><th>پرداخت‌شده</th><th>وضعیت</th></tr></thead>
                <tbody>
                  {contracts.rows.map((r) => (
                    <tr key={r.id}>
                      <td><Link href={`/contracts/${r.id}`} className="text-brand hover:underline" prefetch={false}><span dir="ltr">{r.contractNo}</span></Link></td>
                      <td className="font-medium">{r.customerName}</td>
                      <td>{r.type === "CASH" ? "نقدی" : `اقساطی (${fmtNum(r.installmentCount, fa)})`}</td>
                      <td>{fmtToman(r.cashPrice, fa)}</td>
                      <td>{fmtToman(r.totalPrice, fa)}</td>
                      <td>{r.margin > 0 ? fmtToman(r.margin, fa) : "—"}</td>
                      <td>{fmtToman(r.paidAmount, fa)}</td>
                      <td><StatusBadge status={r.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* 5. Profit */}
      {profit ? (
        <>
          <div className="rounded-2xl border border-[var(--warning)]/40 bg-[var(--warning-soft)] px-4 py-3 text-xs leading-6 text-[var(--warning)]">
            <strong>تعریف سود:</strong> مابه‌التفاوت قراردادی بین «مبلغ کل اقساطی» و «قیمت نقدی» کالا در قراردادهای اقساطی است.
            این رقم یک <strong>حاشیه قراردادی</strong> است، نه درآمد نقدی تحقق‌یافته: در طول عمر قرارداد و به نسبت اقساط تسویه‌شده محقق می‌شود
            و تنها با تسویه آخرین قسط به‌طور کامل تحقق می‌یابد. قراردادهای نقدی به‌همراه تعریف، سودی ندارند.
          </div>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Card><p className="text-xs text-muted">قراردادهای اقساطی</p><p className="mt-1 text-lg font-bold">{fmtNum(profit.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جمع قیمت نقدی</p><p className="mt-1 text-lg font-bold">{fmtToman(profit.totals!.cashValue, fa)}</p></Card>
            <Card><p className="text-xs text-muted">جمع مبلغ اقساطی</p><p className="mt-1 text-lg font-bold">{fmtToman(profit.totals!.totalValue, fa)}</p></Card>
            <Card><p className="text-xs text-muted">حاشیه قراردادی</p><p className="mt-1 text-lg font-bold">{fmtToman(profit.totals!.contractMargin, fa)}</p></Card>
            <Card><p className="text-xs text-muted">سود تحقق‌یافته</p><p className="mt-1 text-lg font-bold text-[var(--success)]">{fmtToman(profit.totals!.realizedMargin, fa)}</p></Card>
          </div>
          <Card>
            <h2 className="mb-4 text-sm font-bold">گزارش سود قراردادی</h2>
            {profit.rows.length === 0 ? <EmptyState title="قرارداد اقساطی در این بازه ثبت نشده است" /> : (
              <TableShell>
                <thead><tr><th>شماره</th><th>مشتری</th><th>قیمت نقدی</th><th>مبلغ کل</th><th>مابه‌التفاوت</th><th>درصد</th><th>تحقق</th><th>سود تحقق‌یافته</th></tr></thead>
                <tbody>
                  {profit.rows.map((r) => (
                    <tr key={r.id}>
                      <td><span dir="ltr">{r.contractNo}</span></td>
                      <td className="font-medium">{r.customerName}</td>
                      <td>{fmtToman(r.cashPrice, fa)}</td>
                      <td>{fmtToman(r.totalPrice, fa)}</td>
                      <td className="font-bold">{fmtToman(r.margin, fa)}</td>
                      <td>{toFaDigits((Math.round(r.marginPercent * 10) / 10).toString())}٪</td>
                      <td>
                        <div className="flex items-center gap-2">
                          <div className="h-2 w-16 overflow-hidden rounded-full bg-[var(--surface-2)]">
                            <div className="h-full rounded-full bg-brand-grad" style={{ width: `${Math.round(r.realizationRate * 100)}%` }} />
                          </div>
                          <span className="text-[11px] text-muted">{fmtNum(r.paidCount, fa)}/{fmtNum(r.totalCount, fa)}</span>
                        </div>
                      </td>
                      <td className="text-[var(--success)]">{fmtToman(r.realizedMargin, fa)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* 6. Verification */}
      {verification ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <Card><p className="text-xs text-muted">در انتظار تأیید</p><p className="mt-1 text-lg font-bold text-[var(--warning)]">{fmtNum(verification.totals!.pendingCount, fa)}</p><p className="text-[11px] text-muted">{fmtToman(verification.totals!.pendingAmount, fa)}</p></Card>
            <Card><p className="text-xs text-muted">تأییدشده</p><p className="mt-1 text-lg font-bold text-[var(--success)]">{fmtNum(verification.totals!.confirmedCount, fa)}</p><p className="text-[11px] text-muted">{fmtToman(verification.totals!.confirmedAmount, fa)}</p></Card>
            <Card><p className="text-xs text-muted">ردشده</p><p className="mt-1 text-lg font-bold text-[var(--danger)]">{fmtNum(verification.totals!.rejectedCount, fa)}</p><p className="text-[11px] text-muted">{fmtToman(verification.totals!.rejectedAmount, fa)}</p></Card>
            <Card><p className="text-xs text-muted">مجموع رکوردها</p><p className="mt-1 text-lg font-bold">{fmtNum(verification.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">میانگین زمان بررسی</p><p className="mt-1 text-lg font-bold">{toFaDigits(String(verification.totals!.avgReviewHours))} ساعت</p></Card>
          </div>
          <Card>
            <h2 className="mb-1 text-sm font-bold">گزارش بررسی پرداخت‌ها</h2>
            <p className="mb-4 text-[11px] text-muted">فقط مبالغ «تأییدشده» به‌عنوان دریافتی لحاظ می‌شوند.</p>
            {verification.rows.length === 0 ? <EmptyState title="پرداختی در این بازه ثبت نشده است" /> : (
              <TableShell>
                <thead><tr><th>مشتری</th><th>قرارداد</th><th>مبلغ</th><th>روش</th><th>وضعیت</th><th>زمان ثبت</th><th>زمان بررسی</th><th>دلیل رد</th></tr></thead>
                <tbody>
                  {verification.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.customerName}</td>
                      <td><span dir="ltr">{r.contractNo}</span></td>
                      <td>{fmtToman(r.amount, fa)}</td>
                      <td><MethodBadge method={r.method} /></td>
                      <td><StatusBadge status={r.status} /></td>
                      <td className="text-xs text-muted">{fmtDate(formatJalali(r.createdAt, true), fa)}</td>
                      <td className="text-xs text-muted">{r.reviewedAt ? fmtDate(formatJalali(r.reviewedAt, true), fa) : "—"}</td>
                      <td className="max-w-48 text-[11px] text-muted">{r.reviewNote ?? "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* 7. SMS */}
      {sms ? (
        <>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <Card><p className="text-xs text-muted">مجموع پیامک</p><p className="mt-1 text-lg font-bold">{fmtNum(sms.totals!.count, fa)}</p></Card>
            <Card><p className="text-xs text-muted">ارسال موفق</p><p className="mt-1 text-lg font-bold text-[var(--success)]">{fmtNum(sms.totals!.sent, fa)}</p></Card>
            <Card><p className="text-xs text-muted">شبیه‌سازی / ناموفق</p><p className="mt-1 text-lg font-bold">{fmtNum(sms.totals!.simulated + sms.totals!.failed, fa)}</p></Card>
            <Card><p className="text-xs text-muted">نرخ تحویل</p><p className="mt-1 text-lg font-bold">{toFaDigits(String(sms.totals!.deliveryRate))}٪</p></Card>
          </div>
          <Card>
            <h2 className="mb-1 text-sm font-bold">گزارش ارسال پیامک</h2>
            <p className="mb-4 text-[11px] text-muted">پیامک‌های «شبیه‌سازی» در محیط بدون درگاه پیامک ثبت می‌شوند.</p>
            {sms.rows.length === 0 ? <EmptyState title="پیامکی در این بازه ثبت نشده است" /> : (
              <TableShell>
                <thead><tr><th>مشتری</th><th>موبایل</th><th>متن</th><th>وضعیت</th><th>زمان</th></tr></thead>
                <tbody>
                  {sms.rows.map((r) => (
                    <tr key={r.id}>
                      <td className="font-medium">{r.customerName ?? "—"}</td>
                      <td dir="ltr">{fa ? toFaDigits(r.phone) : r.phone}</td>
                      <td className="max-w-80 truncate text-xs text-muted" title={r.body}>{r.body}</td>
                      <td><Badge tone={r.status === "SENT" ? "success" : r.status === "FAILED" ? "danger" : "warning"}>{STATUS_FA[r.status] ?? r.status}</Badge></td>
                      <td className="text-xs text-muted">{fmtDate(formatJalali(r.createdAt, true), fa)}</td>
                    </tr>
                  ))}
                </tbody>
              </TableShell>
            )}
          </Card>
        </>
      ) : null}

      {/* Pagination */}
      {pag && pag.pages > 1 ? (
        <div className="flex items-center justify-center gap-2">
          {page > 1 ? <Link href={queryFor({ page: String(page - 1) })} className="btn btn-outline btn-sm" prefetch={false}>قبلی</Link> : null}
          <span className="text-xs text-muted">صفحه {fmtNum(page, fa)} از {fmtNum(pag.pages, fa)} ({fmtNum(pag.total, fa)} رکورد)</span>
          {page < pag.pages ? <Link href={queryFor({ page: String(page + 1) })} className="btn btn-outline btn-sm" prefetch={false}>بعدی</Link> : null}
        </div>
      ) : null}

      <p className="text-center text-[11px] leading-6 text-muted">
        <BarChart3 className="me-1 inline size-3" />
        تعاریف: «درآمد» فقط پرداخت‌های تأییدشده است. «مطالبات» اصل اقساط باز (شامل اقساط در انتظار تأیید فیش) به‌علاوه جریمه‌های accrued است.
      </p>
    </div>
  );
}
