"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KeyRound, Pencil, UserPlus } from "lucide-react";
import { Modal } from "@/components/modal";
import { createUser, resetUserPassword, setUserActive, updateBankAccounts, updateFinanceSettings, updateStoreSettings, updateUser } from "@/server/actions/admin";
import type { FinanceSettings } from "@/lib/finance";
import type { BankAccount, StoreSettings } from "@/lib/validators";

const num = (s: string) => Number(s.replace(/[^0-9]/g, "")) || 0;

export function StoreSettingsForm({ initial }: { initial: StoreSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        start(async () => {
          const res = await updateStoreSettings(v);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("تنظیمات فروشگاه ذخیره شد");
          router.refresh();
        });
      }}
    >
      <div>
        <label className="label">نام فروشگاه *</label>
        <input className="input" value={v.storeName} onChange={(e) => setV({ ...v, storeName: e.target.value })} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label">تلفن فروشگاه</label>
          <input className="input" dir="ltr" value={v.phone ?? ""} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <div>
          <label className="label">آدرس</label>
          <input className="input" value={v.address ?? ""} onChange={(e) => setV({ ...v, address: e.target.value })} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "…" : "ذخیره"}</button>
    </form>
  );
}

export function FinanceSettingsForm({ initial }: { initial: FinanceSettings }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [v, setV] = useState(initial);
  const [percent, setPercent] = useState(String(initial.percentBpPerDay / 100));
  const [monthly, setMonthly] = useState(String(initial.percentBpPerMonth / 100));

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const percentBpPerDay = Math.round(parseFloat(percent || "0") * 100);
        const percentBpPerMonth = Math.round(parseFloat(monthly || "0") * 100);
        start(async () => {
          const res = await updateFinanceSettings({
            penaltyType: v.penaltyType,
            percentBpPerMonth,
            percentBpPerDay,
            fixedPerDay: v.fixedPerDay,
            graceDays: v.graceDays,
          });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("تنظیمات مالی ذخیره شد");
          router.refresh();
        });
      }}
    >
      <div>
        <label className="label">نوع جریمه تأخیر</label>
        <select className="input" value={v.penaltyType} onChange={(e) => setV({ ...v, penaltyType: e.target.value as FinanceSettings["penaltyType"] })}>
          <option value="NONE">بدون جریمه</option>
          <option value="PERCENT_MONTHLY">درصدی ماهانه (از مبلغ قسط)</option>
          <option value="FIXED_DAILY">مبلغ ثابت روزانه</option>
          <option value="PERCENT_DAILY">درصدی روزانه (حالت قدیمی)</option>
        </select>
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {v.penaltyType === "PERCENT_MONTHLY" ? (
          <div>
            <label className="label">نرخ ماهانه (٪ از مبلغ قسط)</label>
            <input className="input" dir="ltr" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
        ) : null}
        {v.penaltyType === "PERCENT_DAILY" ? (
          <div>
            <label className="label">نرخ روزانه (٪ از مبلغ قسط)</label>
            <input className="input" dir="ltr" inputMode="decimal" value={percent} onChange={(e) => setPercent(e.target.value.replace(/[^0-9.]/g, ""))} />
          </div>
        ) : null}
        {v.penaltyType === "FIXED_DAILY" ? (
          <div>
            <label className="label">مبلغ ثابت هر روز تأخیر (تومان)</label>
            <input className="input" dir="ltr" inputMode="numeric" value={String(v.fixedPerDay)} onChange={(e) => setV({ ...v, fixedPerDay: num(e.target.value) })} />
          </div>
        ) : null}
        <div>
          <label className="label">مهلت ارفاق (روز)</label>
          <input className="input" dir="ltr" inputMode="numeric" value={String(v.graceDays)} onChange={(e) => setV({ ...v, graceDays: num(e.target.value) })} />
        </div>
      </div>
      <div className="rounded-xl bg-[var(--surface-2)] px-4 py-2.5 text-xs leading-6 text-muted">
        <p className="font-medium text-body">قواعد دقیق محاسبه جریمه</p>
        <ul className="mt-1 list-disc space-y-0.5 pe-4">
          <li>شمارش تأخیر از «روز بعد از سررسید» آغاز می‌شود؛ پرداخت در روز سررسید هرگز دیرکرد ندارد.</li>
          <li>روزهای مهلت ارفاق رایگان‌اند و پس از عبور از مهلت نیز بابت آن روزها جریمه‌ای گرفته نمی‌شود.</li>
          <li>نرخ ماهانه بر پایه ماه ۳۰ روزه و به‌صورت روزشمار محاسبه می‌گردد: مبلغ قسط × نرخ × روزهای مشمول ÷ ۳۰.</li>
          <li>گرد کردن همیشه «رو به پایین» و به تومان کامل است تا مشتری اضافه‌پرداخت نکند.</li>
          <li>جریمه در زمان خواندن محاسبه می‌شود؛ بنابراین هرگز دوبار ثبت یا دریافت نمی‌شود.</li>
          <li>اقساط پرداخت‌شده یا بخشوده‌شده دیگر جریمه‌ای تولید نمی‌کنند و هیچ سودی به‌صورت خودکار اضافه نمی‌شود.</li>
        </ul>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending}>{pending ? "…" : "ذخیره"}</button>
    </form>
  );
}

export function UserCreateForm({ customers }: { customers: { id: string; fullName: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ username: "", password: "", fullName: "", role: "OPERATOR" as "ADMIN" | "OPERATOR" | "CUSTOMER", customerId: "", canReviewPayments: false });

  return (
    <>
      <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
        <UserPlus className="size-4" />
        کاربر جدید
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="ایجاد کاربر جدید">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createUser({
                username: v.username,
                password: v.password,
                fullName: v.fullName,
                role: v.role,
                customerId: v.role === "CUSTOMER" ? v.customerId || null : null,
                canReviewPayments: v.role === "OPERATOR" ? v.canReviewPayments : false,
              });
              if (!res.ok) {
                toast.error(res.error);
                return;
              }
              toast.success("کاربر ایجاد شد");
              setOpen(false);
              setV({ username: "", password: "", fullName: "", role: "OPERATOR", customerId: "", canReviewPayments: false });
              router.refresh();
            });
          }}
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className="label">نام و نام خانوادگی *</label>
              <input className="input" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
            </div>
            <div>
              <label className="label">نام کاربری (لاتین) *</label>
              <input className="input" dir="ltr" value={v.username} onChange={(e) => setV({ ...v, username: e.target.value })} />
            </div>
            <div>
              <label className="label">رمز عبور *</label>
              <input className="input" dir="ltr" type="text" value={v.password} onChange={(e) => setV({ ...v, password: e.target.value })} />
            </div>
            <div>
              <label className="label">نقش *</label>
              <select className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as typeof v.role })}>
                <option value="OPERATOR">اپراتور</option>
                <option value="ADMIN">مدیر سیستم</option>
                <option value="CUSTOMER">مشتری</option>
              </select>
            </div>
          </div>
          {v.role === "CUSTOMER" ? (
            <div>
              <label className="label">پرونده مشتری *</label>
              <select className="input" value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value })}>
                <option value="">— انتخاب کنید —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </div>
          ) : null}
          {v.role === "OPERATOR" ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.canReviewPayments} onChange={(e) => setV({ ...v, canReviewPayments: e.target.checked })} />
              مجاز به بررسی و تأیید پرداخت‌های کارت‌به‌کارت
            </label>
          ) : null}
          <button type="submit" className="btn btn-primary w-full" disabled={pending}>{pending ? "…" : "ایجاد کاربر"}</button>
        </form>
      </Modal>
    </>
  );
}

export function UserActiveToggle({ userId, isActive }: { userId: string; isActive: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className={`btn btn-sm ${isActive ? "btn-danger" : "btn-outline"}`}
      disabled={pending}
      onClick={() =>
        start(async () => {
          const res = await setUserActive(userId, !isActive);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(isActive ? "کاربر غیرفعال شد" : "کاربر فعال شد");
          router.refresh();
        })
      }
    >
      {isActive ? "غیرفعال‌سازی" : "فعال‌سازی"}
    </button>
  );
}

export function ResetPasswordButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [pending, start] = useTransition();
  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" title="بازنشانی رمز عبور" onClick={() => setOpen(true)}>
        <KeyRound className="size-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="بازنشانی رمز عبور">
        <div className="space-y-4">
          <input className="input" dir="ltr" placeholder="رمز عبور جدید (حداقل ۸ کاراکتر)" value={password} onChange={(e) => setPassword(e.target.value)} />
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await resetUserPassword({ userId, password });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("رمز عبور بازنشانی شد");
                setOpen(false);
                setPassword("");
              })
            }
          >
            {pending ? "…" : "ثبت رمز جدید"}
          </button>
        </div>
      </Modal>
    </>
  );
}

/* ------------------------- Store bank cards (Stage 9) ------------------------ */

export function BankAccountsForm({ initial }: { initial: { accounts: BankAccount[] } }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [accounts, setAccounts] = useState<BankAccount[]>(
    initial.accounts.length ? initial.accounts : [{ bankName: "", cardNumber: "", cardHolder: "", iban: "", isActive: true }],
  );

  const update = (index: number, patch: Partial<BankAccount>) =>
    setAccounts((prev) => prev.map((a, i) => (i === index ? { ...a, ...patch } : a)));

  const cardDigits = (value: string) => value.replace(/[^0-9]/g, "").slice(0, 16);

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        const cleaned = accounts.filter((a) => a.bankName.trim() && a.cardNumber.length === 16 && a.cardHolder.trim());
        start(async () => {
          const res = await updateBankAccounts({ accounts: cleaned });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("اطلاعات کارت‌های بانکی ذخیره شد");
          router.refresh();
        });
      }}
    >
      {accounts.map((account, index) => (
        <div key={index} className="space-y-3 rounded-2xl border border-base p-4">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted">کارت {toFaDigitsForBank(index + 1)}</span>
            <button
              type="button"
              className="btn btn-ghost btn-sm text-[var(--danger)]"
              onClick={() => setAccounts((prev) => prev.filter((_, i) => i !== index))}
            >
              حذف
            </button>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label">نام بانک *</label>
              <input className="input" value={account.bankName} onChange={(e) => update(index, { bankName: e.target.value })} />
            </div>
            <div>
              <label className="label">شماره کارت (۱۶ رقم) *</label>
              <input
                className="input"
                dir="ltr"
                inputMode="numeric"
                value={account.cardNumber}
                onChange={(e) => update(index, { cardNumber: cardDigits(e.target.value) })}
              />
            </div>
            <div>
              <label className="label">نام صاحب کارت *</label>
              <input className="input" value={account.cardHolder} onChange={(e) => update(index, { cardHolder: e.target.value })} />
            </div>
            <div>
              <label className="label">شماره شبا (اختیاری)</label>
              <input
                className="input"
                dir="ltr"
                value={account.iban ?? ""}
                onChange={(e) => update(index, { iban: e.target.value.trim() || null })}
              />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="size-4 accent-[var(--brand)]"
              checked={account.isActive}
              onChange={(e) => update(index, { isActive: e.target.checked })}
            />
            فعال و قابل نمایش برای مشتریان
          </label>
        </div>
      ))}

      <button
        type="button"
        className="btn btn-outline"
        onClick={() =>
          setAccounts((prev) => [...prev, { bankName: "", cardNumber: "", cardHolder: "", iban: "", isActive: true }])
        }
      >
        افزودن کارت
      </button>
      <button type="submit" className="btn btn-primary" disabled={pending}>
        {pending ? "…" : "ذخیره کارت‌ها"}
      </button>
    </form>
  );
}

function toFaDigitsForBank(n: number) {
  return n.toLocaleString("en-US").replace(/[0-9]/g, (d) => "۰۱۲۳۴۵۶۷۸۹"[Number(d)]);
}


/* ---------------------------- User profile editing ---------------------------- */

export function EditUserButton({
  user,
  customers,
}: {
  user: { id: string; fullName: string; role: "ADMIN" | "OPERATOR" | "CUSTOMER"; customerId: string | null; canReviewPayments: boolean };
  customers: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [v, setV] = useState({ fullName: user.fullName, role: user.role, customerId: user.customerId ?? "", canReviewPayments: user.canReviewPayments });

  return (
    <>
      <button type="button" className="btn btn-sm btn-ghost" title="ویرایش پروفایل" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" />
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="ویرایش کاربر">
        <div className="space-y-4">
          <div>
            <label className="label">نام و نام خانوادگی *</label>
            <input className="input" value={v.fullName} onChange={(e) => setV({ ...v, fullName: e.target.value })} />
          </div>
          <div>
            <label className="label">نقش *</label>
            <select className="input" value={v.role} onChange={(e) => setV({ ...v, role: e.target.value as typeof v.role })}>
              <option value="OPERATOR">اپراتور</option>
              <option value="ADMIN">مدیر سیستم</option>
              <option value="CUSTOMER">مشتری</option>
            </select>
          </div>
          {v.role === "CUSTOMER" ? (
            <div>
              <label className="label">پرونده مشتری *</label>
              <select className="input" value={v.customerId} onChange={(e) => setV({ ...v, customerId: e.target.value })}>
                <option value="">— انتخاب کنید —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.fullName}</option>
                ))}
              </select>
            </div>
          ) : null}
          {v.role === "OPERATOR" ? (
            <label className="flex cursor-pointer items-center gap-2 text-sm">
              <input type="checkbox" className="size-4 accent-[var(--brand)]" checked={v.canReviewPayments} onChange={(e) => setV({ ...v, canReviewPayments: e.target.checked })} />
              مجاز به بررسی و تأیید پرداخت‌ها
            </label>
          ) : null}
          <button
            type="button"
            className="btn btn-primary w-full"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await updateUser({ userId: user.id, fullName: v.fullName, role: v.role, customerId: v.role === "CUSTOMER" ? v.customerId || null : null, canReviewPayments: v.role === "OPERATOR" ? v.canReviewPayments : false });
                if (!res.ok) {
                  toast.error(res.error);
                  return;
                }
                toast.success("کاربر به‌روزرسانی شد");
                setOpen(false);
                router.refresh();
              })
            }
          >
            {pending ? "…" : "ذخیره تغییرات"}
          </button>
        </div>
      </Modal>
    </>
  );
}
