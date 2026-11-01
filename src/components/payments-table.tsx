"use client";

import { flexRender, getCoreRowModel, useReactTable, type ColumnDef } from "@tanstack/react-table";
import { MethodBadge } from "@/components/ui";
import { ReviewButtons } from "@/components/forms/payment-forms";

export interface PendingPaymentRow {
  id: string;
  contractNo: string;
  customerName: string;
  amountFa: string;
  method: string;
  referenceNo: string | null;
  createdFa: string;
  submittedByName: string;
}

const columns: ColumnDef<PendingPaymentRow>[] = [
  { accessorKey: "contractNo", header: "قرارداد" },
  { accessorKey: "customerName", header: "مشتری" },
  { accessorKey: "amountFa", header: "مبلغ" },
  {
    accessorKey: "method",
    header: "روش",
    cell: (c) => <MethodBadge method={c.getValue<string>()} />,
  },
  { accessorKey: "referenceNo", header: "پیگیری", cell: (c) => <span dir="ltr">{c.getValue<string>() ?? "—"}</span> },
  { accessorKey: "createdFa", header: "زمان ثبت" },
  { accessorKey: "submittedByName", header: "ثبت‌کننده" },
  {
    id: "actions",
    header: "عملیات",
    cell: (c) => <ReviewButtons paymentId={c.row.original.id} />,
  },
];

export function PendingPaymentsTable({ rows }: { rows: PendingPaymentRow[] }) {
  // TanStack Table intentionally returns stable function-bearing objects; the
  // React Compiler cannot memoize this external-library hook, so this component
  // is explicitly opted out while retaining normal React behavior.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable({ data: rows, columns, getCoreRowModel: getCoreRowModel() });
  return (
    <div className="overflow-x-auto rounded-2xl border border-base">
      <table className="w-full min-w-max text-sm [&_td]:border-t [&_td]:border-[var(--border)] [&_td]:px-4 [&_td]:py-3 [&_th]:bg-[var(--surface-2)] [&_th]:px-4 [&_th]:py-3 [&_th]:text-right [&_th]:text-xs [&_th]:font-medium [&_th]:text-[var(--muted)]">
        <thead>
          {table.getHeaderGroups().map((hg) => (
            <tr key={hg.id}>
              {hg.headers.map((h) => (
                <th key={h.id}>{flexRender(h.column.columnDef.header, h.getContext())}</th>
              ))}
            </tr>
          ))}
        </thead>
        <tbody>
          {table.getRowModel().rows.map((r) => (
            <tr key={r.id} className="transition hover:bg-[var(--surface-2)]/60">
              {r.getVisibleCells().map((c) => (
                <td key={c.id}>{flexRender(c.column.columnDef.cell, c.getContext())}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
