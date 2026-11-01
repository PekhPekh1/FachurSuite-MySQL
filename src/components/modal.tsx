"use client";

import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";
import { cx } from "@/lib/format";

export function Modal({
  open,
  onClose,
  title,
  children,
  wide,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  wide?: boolean;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center overflow-y-auto bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={cx(
          "card w-full p-5 sm:p-6",
          wide ? "max-w-3xl" : "max-w-lg",
        )}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between border-b border-base pb-3">
          <h2 className="text-base font-bold">{title}</h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="بستن">
            <X className="size-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
