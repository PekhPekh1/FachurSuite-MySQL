"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { toast } from "sonner";
import { Plus, Trash2, UploadCloud, X } from "lucide-react";
import { customerSchema, guarantorSchema } from "@/lib/validators";
import type { z } from "zod";
import { addGuarantor, createCustomer, deleteGuarantor, updateCustomer } from "@/server/actions/customers";
import { FieldError } from "@/components/ui";

type CustomerFormValues = z.input<typeof customerSchema>;

function TagsField({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [draft, setDraft] = useState("");
  const add = () => {
    const t = draft.trim();
    if (t && !value.includes(t) && value.length < 12) onChange([...value, t]);
    setDraft("");
  };
  return (
    <div>
      <div className="flex gap-2">
        <input
          className="input"
          placeholder="مثلاً: VIP، معرفی‌شده، پرریسک"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
        />
        <button type="button" className="btn btn-outline shrink-0" onClick={add}>
          <Plus className="size-4" />
        </button>
      </div>
      {value.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {value.map((t) => (
            <span key={t} className="badge badge-info">
              {t}
              <button type="button" onClick={() => onChange(value.filter((x) => x !== t))} aria-label={`حذف برچسب ${t}`}>
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function CustomerForm({ initial, customerId }: { initial?: Partial<CustomerFormValues>; customerId?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [tags, setTags] = useState<string[]>((initial?.tags as string[]) ?? []);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors },
  } = useForm<CustomerFormValues>({
    resolver: zodResolver(customerSchema),
    defaultValues: { firstName: "", lastName: "", nationalCode: "", mobile: "", creditLimit: 0, ...initial },
  });
  setValue("tags", tags);

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={handleSubmit((values) =>
        start(async () => {
          const res = customerId ? await updateCustomer(customerId, { ...values, tags }) : await createCustomer({ ...values, tags });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success(customerId ? "مشتری به‌روزرسانی شد" : "مشتری جدید ثبت شد");
          if (!customerId && res.data) router.push(`/customers/${res.data.id}`);
          router.refresh();
        }),
      )}
    >
      <div>
        <label className="label">نام *</label>
        <input className="input" {...register("firstName")} />
        <FieldError message={errors.firstName?.message} />
      </div>
      <div>
        <label className="label">نام خانوادگی *</label>
        <input className="input" {...register("lastName")} />
        <FieldError message={errors.lastName?.message} />
      </div>
      <div>
        <label className="label">کد ملی *</label>
        <input className="input" dir="ltr" inputMode="numeric" maxLength={10} {...register("nationalCode")} />
        <FieldError message={errors.nationalCode?.message} />
      </div>
      <div>
        <label className="label">موبایل *</label>
        <input className="input" dir="ltr" inputMode="numeric" maxLength={11} placeholder="09xxxxxxxxx" {...register("mobile")} />
        <FieldError message={errors.mobile?.message} />
      </div>
      <div>
        <label className="label">شماره تماس دوم</label>
        <input className="input" dir="ltr" inputMode="numeric" {...register("phone")} />
        <FieldError message={errors.phone?.message} />
      </div>
      <div>
        <label className="label">شغل</label>
        <input className="input" {...register("occupation")} />
        <FieldError message={errors.occupation?.message} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">آدرس</label>
        <input className="input" {...register("address")} />
        <FieldError message={errors.address?.message} />
      </div>
      <div>
        <label className="label">سقف اعتبار (تومان)</label>
        <input className="input" dir="ltr" inputMode="numeric" {...register("creditLimit")} />
        <FieldError message={errors.creditLimit?.message} />
      </div>
      <div>
        <label className="label">برچسب‌ها</label>
        <TagsField value={tags} onChange={setTags} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">یادداشت</label>
        <textarea className="input min-h-20" {...register("notes")} />
        <FieldError message={errors.notes?.message} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ذخیره…" : customerId ? "ذخیره تغییرات" : "ثبت مشتری"}
        </button>
      </div>
    </form>
  );
}

type GuarantorFormValues = z.input<typeof guarantorSchema>;

export function GuarantorForm({ customerId, onDone }: { customerId: string; onDone?: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<GuarantorFormValues>({ resolver: zodResolver(guarantorSchema), defaultValues: { customerId } });

  return (
    <form
      className="grid grid-cols-1 gap-4 sm:grid-cols-2"
      onSubmit={handleSubmit((values) =>
        start(async () => {
          const res = await addGuarantor({ ...values, customerId });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("ضامن ثبت شد");
          onDone?.();
          router.refresh();
        }),
      )}
    >
      <div>
        <label className="label">نام و نام خانوادگی *</label>
        <input className="input" {...register("fullName")} />
        <FieldError message={errors.fullName?.message} />
      </div>
      <div>
        <label className="label">کد ملی</label>
        <input className="input" dir="ltr" inputMode="numeric" maxLength={10} {...register("nationalCode")} />
        <FieldError message={errors.nationalCode?.message} />
      </div>
      <div>
        <label className="label">موبایل</label>
        <input className="input" dir="ltr" inputMode="numeric" maxLength={11} {...register("mobile")} />
        <FieldError message={errors.mobile?.message} />
      </div>
      <div>
        <label className="label">نسبت با مشتری</label>
        <input className="input" placeholder="مثلاً: برادر، همکار" {...register("relation")} />
      </div>
      <div className="sm:col-span-2">
        <label className="label">آدرس محل کار/سکونت</label>
        <input className="input" {...register("address")} />
      </div>
      <div className="sm:col-span-2">
        <button type="submit" className="btn btn-primary" disabled={pending}>
          {pending ? "در حال ذخیره…" : "افزودن ضامن"}
        </button>
      </div>
    </form>
  );
}

export function DeleteGuarantorButton({ id, customerId }: { id: string; customerId: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <button
      type="button"
      className="btn btn-danger btn-sm"
      disabled={pending}
      onClick={() => {
        if (!confirm("ضامن حذف شود؟")) return;
        start(async () => {
          const res = await deleteGuarantor(id, customerId);
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("ضامن حذف شد");
          router.refresh();
        });
      }}
    >
      <Trash2 className="size-3.5" />
    </button>
  );
}

// Customer activation/blacklist controls live in components/forms/detail-actions.tsx
// (CustomerStateButtons) so that lifecycle changes always capture an audited reason.

export function DocumentUpload({ ownerType, ownerId, label }: { ownerType: string; ownerId: string; label?: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          if (file.size > 5 * 1024 * 1024) {
            toast.error("حجم فایل نباید بیش از ۵ مگابایت باشد");
            return;
          }
          start(async () => {
            const fd = new FormData();
            fd.set("file", file);
            fd.set("ownerType", ownerType);
            fd.set("ownerId", ownerId);
            const res = await fetch("/api/upload", { method: "POST", body: fd });
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            if (!res.ok) {
              toast.error(body.error ?? "بارگذاری ناموفق بود");
              return;
            }
            toast.success("سند بارگذاری شد");
            router.refresh();
            if (inputRef.current) inputRef.current.value = "";
          });
        }}
      />
      <button type="button" className="btn btn-outline btn-sm" disabled={pending} onClick={() => inputRef.current?.click()}>
        <UploadCloud className="size-4" />
        {pending ? "در حال بارگذاری…" : label ?? "بارگذاری سند"}
      </button>
    </div>
  );
}
