"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileText,
  CalendarClock,
  Wallet,
  BarChart3,
  Settings,
  ShieldCheck,
  ScrollText,
  UserRound,
  Menu,
  X,
  Store,
  MessageSquareText,
  ClipboardCheck,
  Heart,
} from "lucide-react";
import { ThemeToggle, PaletteSwitcher, DigitsToggle } from "@/components/controls";
import {
  Breadcrumbs,
  GlobalSearch,
  MobileSearchButton,
  NotificationMenu,
  ProfileMenu,
  type ShellNotification,
} from "@/components/shell-widgets";
import { useUiStore } from "@/lib/store";
import { cx, ROLE_FA } from "@/lib/format";
import type { Palette } from "@/lib/palettes";
import type { Role } from "@/lib/auth";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
  badge?: number;
}

function navFor(role: Role, pendingVerification: number): NavItem[] {
  if (role === "CUSTOMER") {
    return [
      { href: "/portal", label: "پرتال مشتری", icon: <UserRound className="size-4.5" /> },
      { href: "/profile", label: "پروفایل و نشست‌ها", icon: <ShieldCheck className="size-4.5" /> },
    ];
  }
  const items: NavItem[] = [
    { href: "/", label: "داشبورد", icon: <LayoutDashboard className="size-4.5" /> },
    { href: "/customers", label: "مشتریان", icon: <Users className="size-4.5" /> },
    { href: "/contracts", label: "قراردادها", icon: <FileText className="size-4.5" /> },
    { href: "/installments", label: "اقساط", icon: <CalendarClock className="size-4.5" /> },
    { href: "/payments", label: "پرداخت‌ها", icon: <Wallet className="size-4.5" /> },
    {
      href: "/payments/verification",
      label: "بررسی پرداخت‌ها",
      icon: <ClipboardCheck className="size-4.5" />,
      badge: pendingVerification,
    },
    { href: "/reports", label: "گزارش‌ها", icon: <BarChart3 className="size-4.5" /> },
    { href: "/profile", label: "پروفایل و نشست‌ها", icon: <UserRound className="size-4.5" /> },
  ];
  if (role === "ADMIN") {
    items.push(
      { href: "/sms", label: "مدیریت پیامک", icon: <MessageSquareText className="size-4.5" /> },
      { href: "/users", label: "کاربران", icon: <ShieldCheck className="size-4.5" /> },
      { href: "/audit", label: "رویدادها", icon: <ScrollText className="size-4.5" /> },
      { href: "/settings", label: "تنظیمات", icon: <Settings className="size-4.5" /> },
    );
  }
  return items;
}

function StoreMark({ logoUrl, storeName }: { logoUrl?: string | null; storeName: string }) {
  if (logoUrl) {
    return (
      // Admin-supplied logo URL; no server-side fetch occurs, so this does not create SSRF.
      // eslint-disable-next-line @next/next/no-img-element
      <img src={logoUrl} alt={`نشان ${storeName}`} className="size-10 rounded-2xl border border-base object-cover" />
    );
  }
  return (
    <div className="grid size-10 place-items-center rounded-2xl bg-brand-grad text-white" aria-hidden="true">
      <Store className="size-5" />
    </div>
  );
}

export function AppShell({
  user,
  storeName,
  storeLogo,
  palette,
  faDigits,
  notifications,
  pendingVerification,
  children,
}: {
  user: { fullName: string; role: Role };
  storeName: string;
  storeLogo?: string | null;
  palette: Palette;
  faDigits: boolean;
  notifications: ShellNotification[];
  pendingVerification: number;
  children: ReactNode;
}) {
  const pathname = usePathname();
  const { sidebarOpen, setSidebar } = useUiStore();
  const items = navFor(user.role, pendingVerification);

  return (
    <div className="min-h-screen lg:pe-68">
      <aside
        aria-label="منوی اصلی"
        className={cx(
          "app-chrome fixed inset-y-0 right-0 z-50 flex w-68 flex-col border-e border-base bg-surface transition-transform duration-200 max-lg:shadow-2xl",
          sidebarOpen ? "max-lg:translate-x-0" : "max-lg:translate-x-full",
        )}
      >
        <div className="flex items-center gap-3 border-b border-base px-5 py-4">
          <StoreMark logoUrl={storeLogo} storeName={storeName} />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold">{storeName}</p>
            <p className="text-[11px] text-muted">FachurSuite</p>
          </div>
          <button type="button" className="btn btn-ghost btn-sm ms-auto lg:hidden" onClick={() => setSidebar(false)} aria-label="بستن منو">
            <X className="size-4" />
          </button>
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-3">
          {items.map((it) => {
            const active = it.href === "/" ? pathname === "/" : pathname === it.href || pathname.startsWith(`${it.href}/`);
            return (
              <Link key={it.href} href={it.href} className={cx("navlink", active && "active")} onClick={() => setSidebar(false)}>
                {it.icon}
                <span className="flex-1">{it.label}</span>
                {it.badge ? <span className="badge badge-warning min-w-6 justify-center">{it.badge > 99 ? "+۹۹" : it.badge}</span> : null}
              </Link>
            );
          })}
        </nav>
        <Link href="/profile" className="border-t border-base p-4 transition hover:bg-[var(--surface-2)]" onClick={() => setSidebar(false)}>
          <div className="flex items-center gap-3">
            <div className="grid size-9 place-items-center rounded-full bg-brand-soft text-sm font-bold text-brand">{user.fullName.slice(0, 1)}</div>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium">{user.fullName}</p>
              <p className="text-[11px] text-muted">{ROLE_FA[user.role]}</p>
            </div>
          </div>
        </Link>
      </aside>

      {sidebarOpen ? <button type="button" aria-label="بستن منوی کناری" className="fixed inset-0 z-40 bg-black/40 lg:hidden" onClick={() => setSidebar(false)} /> : null}

      <div className="flex min-h-screen flex-col">
        <header className="app-chrome sticky top-0 z-30 border-b border-base bg-[color-mix(in_srgb,var(--background)_80%,transparent)] backdrop-blur-md">
          <div className="flex min-h-14 items-center gap-2 px-3 sm:px-6">
            <button type="button" className="btn btn-ghost btn-sm px-2 lg:hidden" onClick={() => setSidebar(true)} aria-label="باز کردن منو">
              <Menu className="size-5" />
            </button>

            <div className="hidden flex-1 md:block">
              <GlobalSearch />
            </div>
            <div className="ms-auto flex items-center gap-0.5">
              <MobileSearchButton />
              <NotificationMenu notifications={notifications} />
              <div className="hidden items-center gap-0.5 sm:flex">
                <DigitsToggle fa={faDigits} />
                <PaletteSwitcher current={palette} />
                <ThemeToggle />
              </div>
              <ProfileMenu user={user} />
            </div>
          </div>
          <div className="border-t border-base/70 px-4 py-1.5 sm:px-6">
            <Breadcrumbs />
          </div>
        </header>

        <main className="app-main mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
        <footer className="app-chrome border-t border-base px-6 py-3 text-center text-[11px] text-muted">
          <p>{storeName} — سامانه مدیریت فروش نقدی و اقساطی</p>
          <p className="mt-1 flex items-center justify-center gap-1">
            <span className="font-bold tracking-wide">FachurSuite</span>
            <span className="opacity-70">·</span>
            Made with <Heart className="inline size-3.5 fill-[var(--danger)] text-[var(--danger)]" aria-label="love" /> by <span className="font-semibold">TheFachur</span>
          </p>
        </footer>
      </div>
    </div>
  );
}
