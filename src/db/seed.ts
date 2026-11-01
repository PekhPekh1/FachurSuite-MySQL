import { randomUUID } from "node:crypto";
import "dotenv/config";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { db, pool } from "./index";
import {
  auditLogs, contracts, counters, customers, customerCreditHistory, guarantors, holidays,
  installments, paymentInstallments, payments, settings, smsLogs, smsTemplates, users,
} from "./schema";
import { addMonthsJalali, gregToJalali, jalaliToGreg, todayGreg } from "../lib/jalali";

const day = (greg: string, plusDays = 0, hour = "10") => {
  const d = new Date(`${greg}T${hour}:15:00Z`);
  if (plusDays) d.setUTCDate(d.getUTCDate() + plusDays);
  return d;
};

function ncode(base9: string) {
  const d = base9.split("").map(Number);
  const sum = d.reduce((a, x, i) => a + x * (10 - i), 0);
  const r = sum % 11;
  return base9 + String(r < 2 ? r : 11 - r);
}

async function main() {
  const existing = await db.select({ id: users.id }).from(users).limit(1);
  if (existing[0]) {
    console.log("⚠️  دیتابیس قبلاً مقداردهی شده است؛ سید نادیده گرفته شد.");
    return;
  }

  const today = todayGreg();
  const m = (n: number) => addMonthsJalali(today, n);
  const payDay = (greg: string) => gregToJalali(greg).jd;

  await db
    .insert(settings)
    .ignore()
    .values([
      { key: "store", value: { storeName: "فروشگاه لوازم خانگی پارس", phone: "02122334455", address: "تهران، خیابان ولیعصر، پلاک ۱۲۳۴", logoUrl: null, description: null, printHeader: null, printFooter: null } },
      { key: "finance", value: { penaltyType: "PERCENT_MONTHLY", percentBpPerMonth: 120, percentBpPerDay: 10, fixedPerDay: 50_000, graceDays: 3, defaultInstallmentCount: 12, currency: "TOMAN" } },
    ]);

  await db
    .insert(smsTemplates)
    .ignore()
    .values([
      { key: "contract_created", title: "ثبت قرارداد", body: "{customer} گرامی، قرارداد شما با شماره {contractNo} به مبلغ {amount} تومان ثبت شد. از اعتماد شما سپاسگزاریم.", category: "CONFIRMATION" },
      { key: "contract_canceled", title: "لغو قرارداد", body: "{customer} گرامی، قرارداد {contractNo} طبق درخواست ثبت‌شده لغو گردید. برای کسب اطلاعات بیشتر با فروشگاه تماس بگیرید.", category: "CUSTOM" },
      { key: "payment_recorded", title: "ثبت پرداخت", body: "{customer} گرامی، پرداخت {amount} تومانی شما برای قرارداد {contractNo} با موفقیت ثبت شد.", category: "CONFIRMATION" },
      { key: "receipt_submitted", title: "ثبت فیش کارت‌به‌کارت", body: "{customer} گرامی، فیش پرداخت شما برای قرارداد {contractNo} دریافت و در صف بررسی قرار گرفت.", category: "CUSTOM" },
      { key: "receipt_approved", title: "تأیید فیش", body: "{customer} گرامی، پرداخت {amount} تومانی شما برای قرارداد {contractNo} تأیید شد.", category: "CONFIRMATION" },
      { key: "receipt_rejected", title: "رد فیش", body: "{customer} گرامی، فیش پرداخت شما برای قرارداد {contractNo} تأیید نشد. دلیل: {reason}", category: "REJECTION" },
      { key: "overdue_reminder", title: "یادآوری قسط", body: "{customer} گرامی، قسط شماره {seq} قرارداد {contractNo} به مبلغ {amount} تومان در تاریخ {dueDate} سررسیده است. لطفاً جهت پرداخت اقدام فرمایید.", category: "OVERDUE" },
      { key: "upcoming_reminder", title: "یادآوری سررسید نزدیک", body: "{customer} گرامی، قسط شماره {seq} قرارداد {contractNo} به مبلغ {amount} تومان در تاریخ {dueDate} سررسید می‌شود.", category: "UPCOMING" },
      { key: "due_date_reminder", title: "یادآوری روز سررسید", body: "{customer} گرامی، امروز سررسید پرداخت قسط {seq} قرارداد {contractNo} به مبلغ {amount} تومان است.", category: "DUE_DATE" },
      { key: "overdue_notice", title: "اطلاعیه تأخیر", body: "{customer} گرامی، قسط {seq} قرارداد {contractNo} به مبلغ {amount} تومان از تاریخ {dueDate} معوقه شده و تاکنون {daysLate} روز تأخیر داشته است.", category: "OVERDUE" },
      { key: "custom_message", title: "پیام سفارشی", body: "{customer} گرامی، {message}", category: "CUSTOM" },
    ]);

  const jy = gregToJalali(today).jy;
  await db
    .insert(holidays)
    .ignore()
    .values([
      { date: jalaliToGreg(jy, 1, 1), title: "نوروز" },
      { date: jalaliToGreg(jy, 1, 2), title: "نوروز" },
      { date: jalaliToGreg(jy, 1, 3), title: "تعطیلات نوروز" },
      { date: jalaliToGreg(jy, 1, 4), title: "تعطیلات نوروز" },
      { date: jalaliToGreg(jy, 3, 14), title: "تعطیل رسمی نمونه" },
      { date: jalaliToGreg(jy, 11, 22), title: "تعطیل رسمی نمونه" },
    ]);

  const customerIds = Array.from({ length: 6 }, () => randomUUID());
  await db
    .insert(customers)
    .ignore()
    .values([
      { id: customerIds[0], firstName: "علی", lastName: "رضایی", fullName: "علی رضایی", nationalCode: ncode("049937089"), mobile: "09121234567", phone: "02188112233", address: "تهران، سعادت‌آباد", occupation: "مهندس نرم‌افزار", tags: ["VIP", "سابقه خوب"], creditLimit: 30_000_000 },
      { id: customerIds[1], firstName: "مریم", lastName: "احمدی", fullName: "مریم احمدی", nationalCode: ncode("008457123"), mobile: "09129876543", address: "تهران، پیروزی", occupation: "معلم", tags: ["معرفی‌شده"], creditLimit: 15_000_000 },
      { id: customerIds[2], firstName: "حسین", lastName: "کریمی", fullName: "حسین کریمی", nationalCode: ncode("002361478"), mobile: "09351234567", address: "کرج، گوهردشت", occupation: "فروشنده", tags: [], creditLimit: 0 },
      { id: customerIds[3], firstName: "نگار", lastName: "موسوی", fullName: "نگار موسوی", nationalCode: ncode("005214789"), mobile: "09011234567", address: "تهران، نارمک", occupation: "طراح", tags: ["پرریسک"], creditLimit: 5_000_000 },
      { id: customerIds[4], firstName: "رضا", lastName: "قاسمی", fullName: "رضا قاسمی", nationalCode: ncode("007896541"), mobile: "09191112233", address: "تهران، تهرانپارس", occupation: "حسابدار", tags: ["سابقه خوب"], creditLimit: 20_000_000 },
      { id: customerIds[5], firstName: "سارا", lastName: "محمدی", fullName: "سارا محمدی", nationalCode: ncode("003698521"), mobile: "09368889900", address: "اصفهان، مرداویج", occupation: "پزشک", tags: [], creditLimit: 0 },
    ]);

  await db
    .insert(customerCreditHistory)
    .ignore()
    .values(
      customerIds.slice(0, 5).map((id) => ({ customerId: id, oldScore: 500, newScore: 500, reason: "INITIAL", details: { ruleVersion: 1, source: "fictional-seed" } })),
    );

  const guarantorIds = Array.from({ length: 3 }, () => randomUUID());
  await db
    .insert(guarantors)
    .ignore()
    .values([
      { id: guarantorIds[0], customerId: customerIds[0], fullName: "مهدی رضایی", nationalCode: ncode("001122334"), mobile: "09121112233", relation: "برادر" },
      { id: guarantorIds[1], customerId: customerIds[1], fullName: "فاطمه احمدی", nationalCode: ncode("009988776"), mobile: "09123334455", relation: "خواهر" },
      { id: guarantorIds[2], customerId: customerIds[3], fullName: "فرهاد موسوی", nationalCode: ncode("004455667"), mobile: "09124445566", relation: "همکار" },
    ]);

  const adminId = randomUUID();
  const customer1Id = randomUUID();
  await db.insert(users).values([
    { id: adminId, username: "admin", passwordHash: await bcrypt.hash("admin123456", 12), fullName: "مدیر سیستم", role: "ADMIN" },
    { id: randomUUID(), username: "operator", passwordHash: await bcrypt.hash("operator123", 12), fullName: "اپراتور فروش", role: "OPERATOR", canReviewPayments: true },
    { id: customer1Id, username: "customer1", passwordHash: await bcrypt.hash("customer123", 12), fullName: "علی رضایی", role: "CUSTOMER", customerId: customerIds[0] },
  ]);

  // ---- Cash sale, fully paid ----
  const cashC = randomUUID();
  await db.insert(contracts).values({
    id: cashC, contractNo: "CSH-1403-00001", type: "CASH", customerId: customerIds[2],
    itemDescription: "جاروبرقی سامسونگ مدل VC21", cashPrice: 4_500_000, totalPrice: 4_500_000,
    status: "SETTLED", createdBy: adminId, createdAt: day(m(0), -2, "09"),
  });
  const cashInst = randomUUID();
  await db.insert(installments).values({ id: cashInst, contractId: cashC, seq: 1, dueDate: m(0), amount: 4_500_000, status: "PAID", paidAt: day(m(0), -2, "10") });
  const cashPay = randomUUID();
  await db.insert(payments).values({ id: cashPay, idempotencyKey: "seed-cash-1", contractId: cashC, customerId: customerIds[2], amount: 4_500_000, method: "CARD_READER", status: "CONFIRMED", paidAt: day(m(0), -2, "10"), submittedBy: adminId, reviewedBy: adminId, reviewedAt: day(m(0), -2, "10"), createdAt: day(m(0), -2, "10") });
  await db.insert(paymentInstallments).values({ paymentId: cashPay, installmentId: cashInst });

  // ---- 12-month installment, 2 paid, one overdue, rest pending ----
  const insC1 = randomUUID();
  await db.insert(contracts).values({
    id: insC1, contractNo: "INS-1403-00002", type: "INSTALLMENT", customerId: customerIds[0], guarantorId: guarantorIds[0],
    itemDescription: "یخچال فریزر ال‌جی ۲۸ فوت", itemSerialNumber: "LG-F28KWT-8842",
    cashPrice: 9_000_000, totalPrice: 11_000_000, downPayment: 2_000_000,
    installmentCount: 12, installmentAmount: 750_000, firstDueDate: m(-4), paymentDay: payDay(m(-4)),
    createdBy: adminId, createdAt: day(m(-4), -3, "11"),
  });
  const ins1 = Array.from({ length: 12 }, () => randomUUID());
  await db.insert(installments).values(
    ins1.map((id, i) => ({
      id, contractId: insC1, seq: i + 1, dueDate: m(i - 4), amount: 750_000,
      status: (i === 0 || i === 1 ? "PAID" : "PENDING") as "PAID" | "PENDING",
      paidAt: i === 0 ? day(m(-4), 1, "12") : i === 1 ? day(m(-3), 2, "13") : null,
    })),
  );
  const p1 = randomUUID(), p2 = randomUUID();
  await db.insert(payments).values([
    { id: p1, idempotencyKey: "seed-ins1-p1", contractId: insC1, customerId: customerIds[0], amount: 750_000, method: "CASH", status: "CONFIRMED", paidAt: day(m(-4), 1, "12"), submittedBy: adminId, reviewedBy: adminId, reviewedAt: day(m(-4), 1, "12"), createdAt: day(m(-4), 1, "12") },
    { id: p2, idempotencyKey: "seed-ins1-p2", contractId: insC1, customerId: customerIds[0], amount: 750_000, method: "CARD_READER", status: "CONFIRMED", paidAt: day(m(-3), 2, "13"), submittedBy: adminId, reviewedBy: adminId, reviewedAt: day(m(-3), 2, "13"), createdAt: day(m(-3), 2, "13") },
  ]);
  await db.insert(paymentInstallments).values([
    { paymentId: p1, installmentId: ins1[0] },
    { paymentId: p2, installmentId: ins1[1] },
  ]);

  // ---- 6-month installment, one paid, one receipt pending review ----
  const insC2 = randomUUID();
  await db.insert(contracts).values({
    id: insC2, contractNo: "INS-1403-00003", type: "INSTALLMENT", customerId: customerIds[1], guarantorId: guarantorIds[1],
    itemDescription: "ماشین لباسشویی اسنوا ۸ کیلویی",
    cashPrice: 6_000_000, totalPrice: 7_200_000, downPayment: 1_200_000,
    installmentCount: 6, installmentAmount: 1_000_000, firstDueDate: m(-2), paymentDay: payDay(m(-2)),
    createdBy: adminId, createdAt: day(m(-2), -4, "10"),
  });
  const ins2 = Array.from({ length: 6 }, () => randomUUID());
  await db.insert(installments).values(
    ins2.map((id, i) => ({
      id, contractId: insC2, seq: i + 1, dueDate: m(i - 2), amount: 1_000_000,
      status: (i === 0 ? "PAID" : i === 1 ? "RESERVED" : "PENDING") as "PAID" | "RESERVED" | "PENDING",
      paidAt: i === 0 ? day(m(-2), 1, "12") : null,
    })),
  );
  const p3 = randomUUID();
  await db.insert(payments).values({ id: p3, idempotencyKey: "seed-ins2-p1", contractId: insC2, customerId: customerIds[1], amount: 1_000_000, method: "CARD_READER", status: "CONFIRMED", paidAt: day(m(-2), 1, "12"), submittedBy: adminId, reviewedBy: adminId, reviewedAt: day(m(-2), 1, "12"), createdAt: day(m(-2), 1, "12") });
  await db.insert(paymentInstallments).values({ paymentId: p3, installmentId: ins2[0] });

  const pendingPay = randomUUID();
  await db.insert(payments).values({
    id: pendingPay, idempotencyKey: "seed-pending-1", contractId: insC2, customerId: customerIds[1], amount: 1_000_000,
    method: "CARD_TO_CARD", status: "PENDING_VERIFICATION", sourceCardNumber: "6037997512345678",
    referenceNo: "882741960", note: "واریز از بانک ملت", paidAt: day(m(0), -1, "15"),
    submittedBy: customer1Id, createdAt: day(m(0), -1, "15"),
  });
  await db.insert(paymentInstallments).values({ paymentId: pendingPay, installmentId: ins2[1] });

  await db
    .update(installments)
    .set({ penaltyForgiven: true, forgivenAmount: 45_000, forgivenBy: adminId, forgivenAt: day(m(0), -1), forgivenReason: "همکاری بیش از ۵ سال — بخشش مدیر" })
    .where(eq(installments.id, ins2[2]));

  // ---- Fresh contract for c4 ----
  const insC4 = randomUUID();
  await db.insert(contracts).values({
    id: insC4, contractNo: "INS-1403-00004", type: "INSTALLMENT", customerId: customerIds[3], guarantorId: guarantorIds[2],
    itemDescription: "تلویزیون OLED ال‌جی ۵۵ اینچ",
    cashPrice: 15_000_000, totalPrice: 18_600_000, downPayment: 3_600_000,
    installmentCount: 10, installmentAmount: 1_500_000, firstDueDate: m(0), paymentDay: payDay(m(0)),
    createdBy: adminId, createdAt: day(m(0), 0, "09"),
  });
  await db.insert(installments).values(
    Array.from({ length: 10 }, (_, i) => ({ id: randomUUID(), contractId: insC4, seq: i + 1, dueDate: m(i), amount: 1_500_000, status: "PENDING" as const })),
  );

  // ---- Settled installment contract with a settlement payment ----
  const insC5 = randomUUID();
  await db.insert(contracts).values({
    id: insC5, contractNo: "INS-1403-00005", type: "INSTALLMENT", customerId: customerIds[4],
    itemDescription: "کولرگازی ایران‌رادیاتور ۲۴۰۰۰",
    cashPrice: 3_000_000, totalPrice: 3_400_000, downPayment: 400_000,
    installmentCount: 3, installmentAmount: 1_000_000, firstDueDate: m(-3), paymentDay: payDay(m(-3)),
    status: "SETTLED", createdBy: adminId, createdAt: day(m(-3), -2, "10"),
  });
  const ins5 = Array.from({ length: 3 }, () => randomUUID());
  await db.insert(installments).values(
    ins5.map((id, i) => ({ id, contractId: insC5, seq: i + 1, dueDate: m(i - 3), amount: 1_000_000, status: "PAID" as const, paidAt: day(m(i - 3), 1, "11") })),
  );
  const p5a = randomUUID(), p5b = randomUUID();
  await db.insert(payments).values([
    { id: p5a, idempotencyKey: "seed-ins5-a", contractId: insC5, customerId: customerIds[4], amount: 1_000_000, method: "CASH", status: "CONFIRMED", paidAt: day(m(-3), 1, "11"), submittedBy: adminId, reviewedBy: adminId, reviewedAt: day(m(-3), 1, "11"), createdAt: day(m(-3), 1, "11") },
    { id: p5b, idempotencyKey: "seed-ins5-b", contractId: insC5, customerId: customerIds[4], amount: 2_000_000, method: "CARD_TO_CARD", status: "CONFIRMED", referenceNo: "711230045", sourceCardNumber: "6037997587654321", paidAt: day(m(-2), 3, "16"), isSettlement: true, submittedBy: adminId, reviewedBy: adminId, reviewedAt: day(m(-1), 2, "16"), createdAt: day(m(-2), 3, "16"), settlementMeta: { lines: [{ seq: 2, amount: 1_000_000, penalty: 0 }, { seq: 3, amount: 1_000_000, penalty: 0 }], calculatedAt: m(-2) } },
  ]);
  await db.insert(paymentInstallments).values([
    { paymentId: p5a, installmentId: ins5[0] },
    { paymentId: p5b, installmentId: ins5[1] },
    { paymentId: p5b, installmentId: ins5[2] },
  ]);

  await db.insert(counters).ignore().values({ key: "contract", value: 5 });

  await db.insert(smsLogs).values([
    { customerId: customerIds[0], phone: "09121234567", body: "علی رضایی گرامی، قرارداد شما با شماره INS-1403-00002 ثبت شد.", status: "SIMULATED" },
    { customerId: customerIds[1], phone: "09129876543", body: "مریم احمدی گرامی، فیش پرداخت شما در صف بررسی قرار گرفت.", status: "SIMULATED" },
  ]);

  await db.insert(auditLogs).values([
    { userId: adminId, userName: "مدیر سیستم", userRole: "ADMIN", action: "contract.create", entity: "contract", entityId: insC1, meta: { seed: true } },
    { userId: adminId, userName: "مدیر سیستم", userRole: "ADMIN", action: "penalty.forgive", entity: "installment", entityId: ins2[2], meta: { amount: 45_000 } },
  ]);

  console.log("✅ داده‌های نمونه با موفقیت ثبت شد (همه داده‌ها ساختگی و توسعه‌ای هستند)");
  console.log("   مدیر:     admin / admin123456        (فقط برای توسعه)");
  console.log("   اپراتور:  operator / operator123     (مجاز به بررسی فیش)");
  console.log("   مشتری:    customer1 / customer123    (پرتال علی رضایی)");
}

main()
  .catch((e) => {
    console.error("❌ خطا در سید:", e);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
