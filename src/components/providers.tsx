"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import { ServiceWorkerRegister } from "./sw-register";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      <ServiceWorkerRegister />
      <Toaster position="top-center" richColors closeButton dir="rtl" toastOptions={{ style: { fontFamily: "inherit" } }} />
    </ThemeProvider>
  );
}
