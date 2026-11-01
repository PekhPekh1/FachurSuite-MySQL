"use client";

import { useState, useSyncExternalStore, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { Moon, Sun, LogOut, Printer, ChevronDown, Check } from "lucide-react";
import { toast } from "sonner";
import { logout } from "@/server/actions/auth";
import { PALETTES, PALETTE_FA, type Palette } from "@/lib/palettes";
import { cx } from "@/lib/format";

const PALETTE_HEX: Record<Palette, string> = {
  blue: "#2563eb",
  green: "#059669",
  purple: "#7c3aed",
  orange: "#ea580c",
  teal: "#0d9488",
  rose: "#e11d48",
};

function setCookie(name: string, value: string) {
  document.cookie = `${name}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
}

export function ThemeToggle() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  // Hydration-safe mounted flag without setState-in-effect.
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  const dark = (theme === "system" ? resolvedTheme : theme) === "dark";
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      aria-label="تغییر حالت روشن/تیره"
      onClick={() => setTheme(dark ? "light" : "dark")}
    >
      {mounted && dark ? <Sun className="size-4" /> : <Moon className="size-4" />}
      <span className="hidden sm:inline">{mounted && dark ? "روشن" : "تیره"}</span>
    </button>
  );
}

export function PaletteSwitcher({ current }: { current: Palette }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();

  const choose = (p: Palette) => {
    // Persist; the server layout re-renders <html data-palette> on refresh.
    setCookie("palette", p);
    setOpen(false);
    start(() => router.refresh());
  };

  return (
    <div className="relative">
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((v) => !v)} disabled={pending}>
        <span className="size-4 rounded-full" style={{ background: PALETTE_HEX[current] }} />
        <span className="hidden sm:inline">پوسته رنگی</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open ? (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-40 mt-2 w-44 rounded-2xl border border-base bg-surface p-2 shadow-lg">
            {PALETTES.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => choose(p)}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-sm hover:bg-[var(--surface-2)]"
              >
                <span className="size-4 rounded-full" style={{ background: PALETTE_HEX[p] }} />
                {PALETTE_FA[p]}
                {p === current ? <Check className="ms-auto size-4 text-brand" /> : null}
              </button>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}

export function DigitsToggle({ fa }: { fa: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm"
      title="نمایش ارقام فارسی/لاتین"
      disabled={pending}
      onClick={() => {
        setCookie("digits", fa ? "en" : "fa");
        start(() => router.refresh());
      }}
    >
      <span className={cx("text-xs font-semibold", !fa && "text-brand")}>۱۲۳</span>
      <span className="text-muted">/</span>
      <span className={cx("text-xs font-semibold", fa && "text-brand")}>123</span>
    </button>
  );
}

export function LogoutButton() {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm text-[var(--danger)]"
      disabled={pending}
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
      <span className="hidden sm:inline">خروج</span>
    </button>
  );
}

export function PrintButton() {
  return (
    <button type="button" className="btn btn-primary no-print" onClick={() => window.print()}>
      <Printer className="size-4" />
      چاپ / ذخیره PDF
    </button>
  );
}
