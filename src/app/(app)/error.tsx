"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

export default function AppError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <div className="card mx-auto flex max-w-xl flex-col items-center gap-3 p-8 text-center" role="alert">
      <div className="grid size-14 place-items-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]">
        <AlertTriangle className="size-7" />
      </div>
      <h1 className="text-lg font-bold">خطا در دریافت اطلاعات</h1>
      <p className="text-sm leading-7 text-muted">امکان نمایش این بخش وجود ندارد. اتصال شبکه را بررسی کنید و دوباره تلاش نمایید.</p>
      <button type="button" className="btn btn-primary" onClick={reset}>
        <RefreshCw className="size-4" />
        تلاش مجدد
      </button>
    </div>
  );
}
