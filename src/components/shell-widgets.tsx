"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle,
  Bell,
  ChevronDown,
  ChevronLeft,
  FileText,
  LogOut,
  Search,
  UserRound,
  Users,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/server/actions/auth";
import { cx, ROLE_FA } from "@/lib/format";
import type { Role } from "@/lib/auth";

interface SearchResult {
  id: string;
  type: "customer" | "contract" | "payment";
  href: string;
  title: string;
  subtitle: string;
  status: string | boolean;
}

const TYPE_ICON = {
  customer: Users,
  contract: FileText,
  payment: Wallet,
};

export function GlobalSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<SearchResult[]>([]);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const search = (value: string) => {
    setQ(value);
    if (timerRef.current) clearTimeout(timerRef.current);
    abortRef.current?.abort();
    if (value.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    setBusy(true);
    timerRef.current = setTimeout(async () => {
      const controller = new AbortController();
      abortRef.current = controller;
      try {
        const response = await fetch(`/api/search?q=${encodeURIComponent(value.trim())}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        const data = (await response.json()) as { results?: SearchResult[] };
        setResults(data.results ?? []);
        setOpen(true);
      } catch (error) {
        if ((error as Error).name !== "AbortError") setResults([]);
      } finally {
        setBusy(false);
      }
    }, 250);
  };

  const go = (href: string) => {
    setOpen(false);
    setQ("");
    setResults([]);
    router.push(href);
  };

  return (
    <div className="relative w-full max-w-md">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 size-4 -translate-y-1/2 text-muted" aria-hidden="true" />
        <input
          type="search"
          role="combobox"
          className="input h-9 ps-9 pe-9"
          placeholder="جستجوی مشتری، قرارداد یا پیگیری…"
          aria-label="جستجوی سراسری"
          aria-expanded={open}
          aria-controls="global-search-results"
          value={q}
          onFocus={() => q.trim().length >= 2 && setOpen(true)}
          onChange={(e) => search(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setOpen(false);
            if (e.key === "Enter" && results[0]) go(results[0].href);
          }}
        />
        {q ? (
          <button
            type="button"
            className="absolute end-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-muted hover:bg-[var(--surface-2)]"
            aria-label="پاک کردن جستجو"
            onClick={() => search("")}
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {open ? (
        <>
          <button type="button" aria-label="بستن نتایج" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div id="global-search-results" role="listbox" className="absolute start-0 top-full z-40 mt-2 max-h-80 w-full overflow-y-auto rounded-2xl border border-base bg-surface p-2 shadow-xl">
            {busy ? (
              <div className="space-y-2 p-2"><div className="skeleton h-10" /><div className="skeleton h-10" /></div>
            ) : results.length === 0 ? (
              <p className="px-3 py-5 text-center text-xs text-muted">نتیجه‌ای یافت نشد</p>
            ) : (
              results.map((result) => {
                const Icon = TYPE_ICON[result.type];
                return (
                  <button
                    key={`${result.type}-${result.id}`}
                    type="button"
                    role="option"
                    aria-selected="false"
                    onClick={() => go(result.href)}
                    className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-right transition hover:bg-[var(--surface-2)]"
                  >
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-brand-soft text-brand"><Icon className="size-4" /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{result.title}</span>
                      <span className="block truncate text-[11px] text-muted">{result.subtitle}</span>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

export interface ShellNotification {
  id: string;
  title: string;
  description: string;
  href: string;
  tone: "warning" | "danger" | "info";
}

export function NotificationMenu({ notifications }: { notifications: ShellNotification[] }) {
  const [open, setOpen] = useState(false);
  const unread = notifications.length;
  return (
    <div className="relative">
      <button type="button" className="btn btn-ghost btn-sm relative px-2" aria-label={`اعلان‌ها؛ ${unread} مورد`} onClick={() => setOpen((v) => !v)}>
        <Bell className="size-4" />
        {unread > 0 ? <span className="absolute end-0 top-0 grid min-w-4 -translate-y-0.5 translate-x-0.5 place-items-center rounded-full bg-[var(--danger)] px-1 text-[9px] leading-4 text-white">{unread > 9 ? "+۹" : unread}</span> : null}
      </button>
      {open ? (
        <>
          <button type="button" aria-label="بستن اعلان‌ها" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-40 mt-2 w-80 max-w-[90vw] rounded-2xl border border-base bg-surface p-2 shadow-xl">
            <div className="flex items-center justify-between px-2 py-2">
              <p className="text-sm font-bold">اعلان‌های عملیاتی</p>
              <span className="badge badge-muted">{unread} مورد</span>
            </div>
            <div className="max-h-80 space-y-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <p className="px-4 py-8 text-center text-xs text-muted">اعلان جدیدی وجود ندارد</p>
              ) : (
                notifications.map((n) => (
                  <Link key={n.id} href={n.href} onClick={() => setOpen(false)} className="flex gap-3 rounded-xl px-3 py-2 transition hover:bg-[var(--surface-2)]">
                    <span className={cx("mt-1 size-2.5 shrink-0 rounded-full", n.tone === "danger" ? "bg-[var(--danger)]" : n.tone === "warning" ? "bg-[var(--warning)]" : "bg-brand")} />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium">{n.title}</span>
                      <span className="mt-0.5 block text-[11px] leading-5 text-muted">{n.description}</span>
                    </span>
                  </Link>
                ))
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

const LABELS: Record<string, string> = {
  customers: "مشتریان",
  new: "ثبت جدید",
  contracts: "قراردادها",
  installments: "اقساط",
  payments: "پرداخت‌ها",
  verification: "بررسی پرداخت‌ها",
  reports: "گزارش‌ها",
  print: "نسخه چاپی",
  users: "کاربران",
  audit: "رویدادها",
  settings: "تنظیمات",
  sms: "مدیریت پیامک",
  portal: "پرتال مشتری",
  profile: "پروفایل و نشست‌ها",
  receipts: "رسید",
};

export function Breadcrumbs() {
  const pathname = usePathname();
  const parts = pathname.split("/").filter(Boolean);
  if (pathname === "/") return <span className="text-xs text-muted">داشبورد</span>;
  return (
    <nav aria-label="مسیر صفحه" className="flex min-w-0 items-center gap-1 overflow-hidden whitespace-nowrap text-[11px] text-muted">
      <Link href="/" className="hover:text-brand">خانه</Link>
      {parts.map((part, index) => {
        const href = `/${parts.slice(0, index + 1).join("/")}`;
        const isLast = index === parts.length - 1;
        const label = LABELS[part] ?? (part.length > 18 ? "جزئیات" : part);
        return (
          <span key={href} className="flex min-w-0 items-center gap-1">
            <ChevronLeft className="size-3 shrink-0" />
            {isLast ? <span className="truncate text-body">{label}</span> : <Link href={href} className="truncate hover:text-brand">{label}</Link>}
          </span>
        );
      })}
    </nav>
  );
}

export function ProfileMenu({ user }: { user: { fullName: string; role: Role } }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="relative">
      <button type="button" className="btn btn-ghost btn-sm gap-2 px-2" aria-label="منوی کاربری" onClick={() => setOpen((v) => !v)}>
        <span className="grid size-7 place-items-center rounded-full bg-brand-soft text-xs font-bold text-brand">{user.fullName.slice(0, 1)}</span>
        <span className="hidden max-w-28 truncate text-xs lg:inline">{user.fullName}</span>
        <ChevronDown className="size-3" />
      </button>
      {open ? (
        <>
          <button type="button" aria-label="بستن منوی کاربر" className="fixed inset-0 z-30 cursor-default" onClick={() => setOpen(false)} />
          <div className="absolute end-0 z-40 mt-2 w-56 rounded-2xl border border-base bg-surface p-2 shadow-xl">
            <div className="border-b border-base px-3 py-2">
              <p className="truncate text-sm font-medium">{user.fullName}</p>
              <p className="text-[11px] text-muted">{ROLE_FA[user.role]}</p>
            </div>
            <Link href="/profile" onClick={() => setOpen(false)} className="mt-1 flex items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[var(--surface-2)]">
              <UserRound className="size-4" />
              پروفایل و نشست‌ها
            </Link>
            <button
              type="button"
              disabled={pending}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm text-[var(--danger)] hover:bg-[var(--danger-soft)]"
              onClick={() =>
                start(async () => {
                  await logout();
                  toast.success("از حساب خارج شدید");
                  router.push("/login");
                  router.refresh();
                })
              }
            >
              <LogOut className="size-4" />
              خروج از حساب
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

export function MobileSearchButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-sm px-2 md:hidden" aria-label="باز کردن جستجو" onClick={() => setOpen(true)}>
        <Search className="size-4" />
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] bg-[var(--background)] p-4 md:hidden">
          <div className="mb-4 flex items-center justify-between">
            <p className="font-bold">جستجوی سراسری</p>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} aria-label="بستن"><X className="size-5" /></button>
          </div>
          <GlobalSearch />
        </div>
      ) : null}
    </>
  );
}
