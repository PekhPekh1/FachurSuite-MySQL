"use client";

import { useState } from "react";
import { FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";

export function ExportXlsxButton({
  fileName,
  sheets,
  label,
}: {
  fileName: string;
  sheets: { name: string; rows: Record<string, string | number | null>[] }[];
  label?: string;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="btn btn-outline btn-sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const XLSX = await import("xlsx");
          const wb = XLSX.utils.book_new();
          for (const s of sheets) {
            const ws = XLSX.utils.json_to_sheet(s.rows);
            XLSX.utils.book_append_sheet(wb, ws, s.name.slice(0, 31));
          }
          XLSX.writeFile(wb, `${fileName}.xlsx`);
        } catch {
          toast.error("خطا در ساخت فایل اکسل");
        } finally {
          setBusy(false);
        }
      }}
    >
      <FileSpreadsheet className="size-4" />
      {busy ? "در حال آماده‌سازی…" : label ?? "خروجی اکسل"}
    </button>
  );
}
