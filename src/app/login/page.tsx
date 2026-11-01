import { redirect } from "next/navigation";
import { Store, ShieldCheck, BadgePercent, FileText, Heart } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "@/components/forms/login-form";
import { getSetting } from "@/lib/settings-server";
import type { StoreSettings } from "@/lib/validators";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const u = await getSessionUser();
  if (u) redirect(u.role === "CUSTOMER" ? "/portal" : "/");

  const store = await getSetting<StoreSettings>("store", { storeName: "فروشگاه من", phone: null, address: null });

  return (
    <main className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-brand-grad lg:block">
        <div className="absolute inset-0 opacity-15 [background-image:radial-gradient(circle_at_25%_20%,white_1.5px,transparent_1.5px)] [background-size:26px_26px]" />
        <div className="relative flex h-full flex-col justify-between p-12 text-white">
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-2xl bg-white/20 backdrop-blur">
              <Store className="size-6" />
            </div>
            <div>
              <p className="text-lg font-bold">{store.storeName}</p>
              <p className="text-sm text-white/80">FachurSuite — سامانه مدیریت فروش نقدی و اقساطی</p>
            </div>
          </div>
          <div className="space-y-8">
            <h1 className="text-3xl font-bold leading-snug xl:text-4xl">
              مدیریت یکپارچه فروش،
              <br />
              اقساط و مطالبات شما
            </h1>
            <ul className="space-y-4 text-sm text-white/90">
              {[
                { icon: FileText, text: "صدور قرارداد نقدی و اقساطی با کنترل خودکار مغایرت مالی" },
                { icon: BadgePercent, text: "محاسبه جریمه تأخیر، مهلت ارفاق و بخشودگی با سابقه ممیزی" },
                { icon: ShieldCheck, text: "دسترسی نقش‌محور: مدیر، اپراتور و پرتال اختصاصی مشتری" },
              ].map((f) => (
                <li key={f.text} className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-white/15">
                    <f.icon className="size-5" />
                  </span>
                  {f.text}
                </li>
              ))}
            </ul>
          </div>
          <div className="flex items-center gap-1.5 text-xs text-white/70">
            <span className="font-bold tracking-wide">FachurSuite</span>
            <span className="opacity-70">·</span>
            <span>Made with</span>
            <Heart className="inline size-3.5 fill-white/90 text-white/90" aria-label="love" />
            <span>by</span>
            <span className="font-semibold">TheFachur</span>
          </div>
          <p className="text-xs text-white/60">نسخه ۱٫۰ — همه داده‌ها روی سرور شما نگهداری می‌شوند</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <div className="mx-auto mb-4 grid size-14 place-items-center rounded-3xl bg-brand-grad text-white">
              <Store className="size-7" />
            </div>
            <h1 className="text-xl font-bold">FachurSuite</h1>
            <p className="mt-1 text-sm text-muted">{store.storeName} — سامانه مدیریت فروش نقدی و اقساطی</p>
          </div>
          <div className="card p-6 sm:p-8">
            <h2 className="mb-1 text-lg font-bold">ورود به حساب کاربری</h2>
            <p className="mb-6 text-sm text-muted">نام کاربری و رمز عبور خود را وارد کنید</p>
            <LoginForm />
          </div>
          <p className="mt-6 flex items-center justify-center gap-1.5 text-[11px] text-muted">
            Made with <Heart className="inline size-3.5 fill-[var(--danger)] text-[var(--danger)]" aria-label="love" /> by <span className="font-semibold">TheFachur</span>
          </p>
        </div>
      </div>
    </main>
  );
}
