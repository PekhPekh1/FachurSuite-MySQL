import { requireUser } from "@/lib/auth";
import {
  contractReport, customerReport, incomeReport, overdueReport, profitReport, smsReport, verificationReport,
  type ReportFilters,
} from "@/server/reports";
import { addMonthsJalali, formatJalali, jalaliMonthStart, todayGreg } from "@/lib/jalali";
import { faDigits } from "@/lib/prefs";
import { fmtDate, fmtNum, fmtToman, toFaDigits, PAYMENT_METHOD_FA, CONTRACT_STATUS_FA } from "@/lib/format";
import { PrintButton } from "@/components/controls";

export const dynamic = "force-dynamic";

const REPORTS: Record<string, string> = {
  overdue: "گزارش اقساط معوقه",
  income: "گزارش درآمد",
  customers: "گزارش مالی مشتریان",
  contracts: "گزارش قراردادها",
  profit: "گزارش سود قراردادی",
  verification: "گزارش بررسی پرداخت‌ها",
  sms: "گزارش ارسال پیامک",
};

export default async function ReportPrintPage({
  searchParams,
}: {
  searchParams: Promise<{ report?: string; from?: string; to?: string; customerId?: string; status?: string; method?: string; type?: string }>;
}) {
  await requireUser(["ADMIN", "OPERATOR"]);
  const fa = await faDigits();
  const sp = await searchParams;
  const report = sp.report && REPORTS[sp.report] ? sp.report : "overdue";

  const today = todayGreg();
  const monthStart = jalaliMonthStart(today);
  const from = sp.from?.match(/^\d{4}-\d{2}-\d{2}$/) ? sp.from : addMonthsJalali(monthStart, -11);
  const to = sp.to?.match(/^\d{4}-\d{2}-\d{2}$/) ? sp.to : today;

  const filters: ReportFilters = {
    from, to, page: 1, pageSize: 200,
    customerId: sp.customerId || undefined,
    contractStatus: sp.status === "ACTIVE" || sp.status === "SETTLED" || sp.status === "CANCELED" ? sp.status : undefined,
    contractType: sp.type === "CASH" || sp.type === "INSTALLMENT" ? sp.type : undefined,
    paymentMethod: sp.method === "CASH" || sp.method === "CARD_READER" || sp.method === "CARD_TO_CARD" ? sp.method : undefined,
  };

  const data =
    report === "overdue" ? await overdueReport(filters)
    : report === "income" ? await incomeReport(filters)
    : report === "customers" ? await customerReport(filters)
    : report === "contracts" ? await contractReport(filters)
    : report === "profit" ? await profitReport(filters)
    : report === "verification" ? await verificationReport(filters)
    : await smsReport(filters);

  const totals = (data as { totals?: Record<string, number> }).totals ?? {};
  const rows = (data as { rows: Record<string, unknown>[] }).rows ?? [];

  const cell = (v: unknown) => {
    if (v === null || v === undefined) return "—";
    if (typeof v === "number") return toFaDigits(v.toLocaleString("en-US"));
    if (typeof v === "boolean") return v ? "بله" : "خیر";
    if (v instanceof Date) return fmtDate(formatJalali(v, true), fa);
    return String(v);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-4">
      <div className="no-print flex items-center justify-between">
        <p className="text-sm text-muted">نسخه چاپی — برای ذخیره PDF از دکمه چاپ مرورگر استفاده کنید</p>
        <PrintButton />
      </div>

      <div className="receipt-sheet card p-8">
        <div className="mb-6 border-b border-base pb-4 text-center">
          <h1 className="text-lg font-bold">{REPORTS[report]}</h1>
          <p className="mt-1 text-xs text-muted">
            بازه: {fmtDate(formatJalali(from), fa)} تا {fmtDate(formatJalali(to), fa)}
          </p>
          <p className="mt-0.5 text-[11px] text-muted">تاریخ گزارش: {fmtDate(formatJalali(today), fa)}</p>
        </div>

        {Object.keys(totals).length > 0 ? (
          <table className="mb-6 w-full text-xs [&_td]:border [&_td]:border-base [&_td]:px-3 [&_td]:py-1.5 [&_th]:bg-[var(--surface-2)] [&_th]:px-3 [&_th]:py-1.5 [&_th]:text-right">
            <thead><tr><th colSpan={2}>خلاصه</th></tr></thead>
            <tbody>
              {Object.entries(totals).map(([k, v]) => (
                <tr key={k}>
                  <td className="w-1/2 text-muted">{summaryLabel(k)}</td>
                  <td className="font-bold">{typeof v === "number" && v > 999 ? fmtToman(v, fa) : cell(v)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}

        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted">رکوردی در این بازه یافت نشد.</p>
        ) : (
          <table className="w-full text-[10px] [&_td]:border [&_td]:border-base [&_td]:px-2 [&_td]:py-1 [&_th]:bg-[var(--surface-2)] [&_th]:px-2 [&_th]:py-1 [&_th]:text-right">
            <thead>
              <tr>
                <th>#</th>
                {Object.keys(rows[0]).slice(0, 8).map((k) => (
                  <th key={k}>{columnLabel(k)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td>{fmtNum(i + 1, fa)}</td>
                  {Object.keys(rows[0]).slice(0, 8).map((k) => (
                    <td key={k}>{cell(r[k])}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {report === "profit" ? (
          <p className="mt-4 text-[10px] leading-5 text-muted">
            تعریف سود: مابه‌التفاوت قراردادی بین مبلغ کل اقساطی و قیمت نقدی. این یک حاشیه قراردادی است، نه درآمد نقدی تحقق‌یافته.
          </p>
        ) : null}
        {report === "income" ? (
          <p className="mt-4 text-[10px] leading-5 text-muted">
            فقط پرداخت‌های تأییدشده محاسبه شده‌اند؛ فیش‌های در انتظار تأیید و ردشده درآمد محسوب نمی‌شوند.
          </p>
        ) : null}

        <div className="mt-8 text-center text-[10px] text-muted">
          تعداد رکوردها: {fmtNum(rows.length, fa)} — FachurSuite — سامانه مدیریت فروش نقدی و اقساطی
        </div>
      </div>
    </div>
  );
}

function columnLabel(key: string) {
  const map: Record<string, string> = {
    customerId: "شناسه", customerName: "مشتری", fullName: "مشتری", nationalCode: "کد ملی", mobile: "موبایل",
    creditScore: "امتیاز", contractNo: "قرارداد", contractId: "قرارداد", seq: "قسط", dueDate: "سررسید",
    daysLate: "تأخیر (روز)", chargeableDays: "روز مشمول", amount: "مبلغ", penalty: "جریمه", total: "جمع",
    principal: "اصل", penaltyAmount: "جریمه", effectiveDate: "تاریخ", method: "روش", status: "وضعیت",
    createdAt: "زمان ثبت", reviewedAt: "زمان بررسی", reviewNote: "دلیل رد", referenceNo: "پیگیری",
    sourceCardNumber: "کارت مبدأ", isSettlement: "تسویه", cashPrice: "قیمت نقدی", totalPrice: "مبلغ کل",
    downPayment: "پیش‌پرداخت", installmentCount: "تعداد اقساط", paidCount: "پرداخت‌شده", paidAmount: "مبلغ پرداخت‌شده",
    margin: "مابه‌التفاوت", marginPercent: "درصد", realizationRate: "تحقق", realizedMargin: "سود تحقق‌یافته",
    outstanding: "اقساط باز", overdueCount: "معوقه", collected: "دریافتی", receivable: "کل مطالبات",
    isActive: "فعال", isBlacklisted: "سیاه", type: "نوع", itemDescription: "شرح", phone: "موبایل",
    body: "متن", detail: "جزئیات", id: "شناسه", reviewHours: "ساعت بررسی", isResubmittable: "قابل ارسال مجدد",
    settled: "تسویه‌شده", totalCount: "کل اقساط", penaltyForgiven: "بخشودگی",
    customer: "مشتری", contract: "قرارداد",
  };
  return map[key] ?? key;
}

function summaryLabel(key: string) {
  const map: Record<string, string> = {
    count: "تعداد رکورد", amount: "مبلغ", penalty: "جریمه", total: "جمع",
    collected: "جمع دریافتی", principal: "اصل اقساط",
    outstanding: "اصل اقساط باز", receivable: "کل مطالبات",
    totalValue: "ارزش کل", cashValue: "جمع قیمت نقدی", contractMargin: "حاشیه قراردادی",
    paidAmount: "مبلغ پرداخت‌شده", realizedMargin: "سود تحقق‌یافته",
    pendingCount: "تعداد در انتظار تأیید", pendingAmount: "مبلغ در انتظار تأیید",
    confirmedCount: "تعداد تأییدشده", confirmedAmount: "مبلغ تأییدشده",
    rejectedCount: "تعداد ردشده", rejectedAmount: "مبلغ ردشده",
    avgReviewHours: "میانگین زمان بررسی (ساعت)",
    sent: "ارسال موفق", simulated: "شبیه‌سازی", failed: "ناموفق", deliveryRate: "نرخ تحویل (٪)",
  };
  return map[key] ?? key;
}
