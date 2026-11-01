"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Power, ShieldAlert, UserPlus } from "lucide-react";
import { Modal } from "@/components/modal";
import { CustomerForm, GuarantorForm } from "@/components/forms/customer-forms";
import { setCustomerActive, setCustomerBlacklist } from "@/server/actions/customers";

export function EditCustomerButton({ initial, customerId }: { initial: Record<string, unknown>; customerId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <Pencil className="size-3.5" />
        ویرایش
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="ویرایش مشتری" wide>
        <CustomerForm initial={initial} customerId={customerId} />
      </Modal>
    </>
  );
}

export function CustomerStateButtons({
  customerId,
  isActive,
  isBlacklisted,
}: {
  customerId: string;
  isActive: boolean;
  isBlacklisted: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const run = (kind: "active" | "blacklist") => {
    const reason = prompt(
      kind === "active"
        ? isActive
          ? "دلیل غیرفعال‌سازی مشتری:"
          : "توضیح فعال‌سازی (اختیاری):"
        : isBlacklisted
          ? "توضیح خروج از فهرست سیاه (اختیاری):"
          : "دلیل ورود به فهرست سیاه:",
    );
    if (reason === null) return;
    start(async () => {
      const result =
        kind === "active"
          ? await setCustomerActive(customerId, !isActive, reason || "فعال‌سازی توسط مدیر")
          : await setCustomerBlacklist(customerId, !isBlacklisted, reason);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(kind === "active" ? (isActive ? "مشتری غیرفعال شد" : "مشتری فعال شد") : isBlacklisted ? "مشتری از فهرست سیاه خارج شد" : "مشتری وارد فهرست سیاه شد");
      router.refresh();
    });
  };
  return (
    <>
      <button type="button" className={isActive ? "btn btn-danger btn-sm" : "btn btn-outline btn-sm"} disabled={pending} onClick={() => run("active")}>
        <Power className="size-3.5" />
        {isActive ? "غیرفعال" : "فعال‌سازی"}
      </button>
      <button type="button" className={isBlacklisted ? "btn btn-outline btn-sm" : "btn btn-danger btn-sm"} disabled={pending} onClick={() => run("blacklist")}>
        <ShieldAlert className="size-3.5" />
        {isBlacklisted ? "خروج از سیاه" : "فهرست سیاه"}
      </button>
    </>
  );
}

export function AddGuarantorButton({ customerId }: { customerId: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-outline btn-sm" onClick={() => setOpen(true)}>
        <UserPlus className="size-3.5" />
        افزودن ضامن
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title="ضامن جدید" wide>
        <GuarantorForm customerId={customerId} onDone={() => setOpen(false)} />
      </Modal>
    </>
  );
}
