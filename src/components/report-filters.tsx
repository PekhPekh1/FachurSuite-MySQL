"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Filter, RotateCcw } from "lucide-react";
import { JalaliDatePicker } from "@/components/jalali-date-picker";

export function ReportFilters({
  report,
  initial,
  customers,
}: {
  report: string;
  initial: { from: string; to: string; customerId?: string; status?: string; method?: string; type?: string };
  customers: { id: string; fullName: string }[];
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [from, setFrom] = useState<string | null>(initial.from);
  const [to, setTo] = useState<string | null>(initial.to);
  const [customerId, setCustomerId] = useState(initial.customerId ?? "");
  const [status, setStatus] = useState(initial.status ?? "");
  const [method, setMethod] = useState(initial.method ?? "");
  const [type, setType] = useState(initial.type ?? "");

  const apply = () => {
    const params = new URLSearchParams({ report });
    if (from) params.set("from", from);
    if (to) params.set("to", to);
    if (customerId) params.set("customerId", customerId);
    if (status) params.set("status", status);
    if (method) params.set("method", method);
    if (type) params.set("type", type);
    start(() => router.push(`/reports?${params.toString()}`));
  };

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-6">
      <div>
        <label className="label">از تاریخ (شمسی)</label>
        <JalaliDatePicker value={from} onChange={setFrom} />
      </div>
      <div>
        <label className="label">تا تاریخ (شمسی)</label>
        <JalaliDatePicker value={to} onChange={setTo} />
      </div>
      <div>
        <label className="label">مشتری</label>
        <select className="input" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
          <option value="">همه مشتریان</option>
          {customers.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
        </select>
      </div>
      <div>
        <label className="label">وضعیت قرارداد</label>
        <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">همه</option>
          <option value="ACTIVE">فعال</option>
          <option value="SETTLED">تسویه شده</option>
          <option value="CANCELED">لغو شده</option>
        </select>
      </div>
      <div>
        <label className="label">روش پرداخت</label>
        <select className="input" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">همه</option>
          <option value="CASH">نقدی</option>
          <option value="CARD_READER">کارتخوان</option>
          <option value="CARD_TO_CARD">کارت به کارت</option>
        </select>
      </div>
      <div>
        <label className="label">نوع قرارداد</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="">همه</option>
          <option value="INSTALLMENT">اقساطی</option>
          <option value="CASH">نقدی</option>
        </select>
      </div>
      <div className="flex flex-wrap gap-2 sm:col-span-2 lg:col-span-6">
        <button type="button" className="btn btn-primary" disabled={pending} onClick={apply}>
          <Filter className="size-4" />
          {pending ? "در حال اعمال…" : "اعمال فیلترها"}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setCustomerId("");
            setStatus("");
            setMethod("");
            setType("");
            start(() => router.push(`/reports?report=${report}`));
          }}
        >
          <RotateCcw className="size-4" />
          پاک کردن فیلترها
        </button>
      </div>
    </div>
  );
}
