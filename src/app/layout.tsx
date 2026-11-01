import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { Providers } from "@/components/providers";
import type { Palette } from "@/lib/palettes";
import { getPreferences } from "@/lib/prefs";
import "./globals.css";

export const metadata: Metadata = {
  title: "FachurSuite — سامانه مدیریت فروش نقدی و اقساطی",
  description: "FachurSuite — مدیریت مشتریان، قراردادهای نقدی و اقساطی، پرداخت‌ها، جرایم و گزارش‌های مالی",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#2563eb",
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const prefs = await getPreferences();
  const palette: Palette = prefs.palette;
  void cookies;
  return (
    <html lang="fa" dir="rtl" data-palette={palette} className={prefs.theme === "dark" ? "dark" : undefined} suppressHydrationWarning>
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
