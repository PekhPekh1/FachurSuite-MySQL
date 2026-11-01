"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { KeyRound, LogOut, ShieldOff } from "lucide-react";
import { toast } from "sonner";
import { changePassword, logout, logoutAllDevices } from "@/server/actions/auth";

export function ChangeMyPasswordForm() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [pending, start] = useTransition();

  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        if (newPassword !== confirmPassword) {
          toast.error("تکرار رمز عبور با رمز جدید یکسان نیست");
          return;
        }
        start(async () => {
          const res = await changePassword({ currentPassword, newPassword });
          if (!res.ok) {
            toast.error(res.error);
            return;
          }
          toast.success("رمز عبور تغییر کرد؛ نشست سایر دستگاه‌ها باطل شد");
          setCurrentPassword("");
          setNewPassword("");
          setConfirmPassword("");
          router.refresh();
        });
      }}
    >
      <div>
        <label className="label" htmlFor="profile-current-password">رمز عبور فعلی *</label>
        <input id="profile-current-password" className="input" dir="ltr" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className="label" htmlFor="profile-new-password">رمز عبور جدید *</label>
          <input id="profile-new-password" className="input" dir="ltr" type="password" autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          <p className="mt-1 text-[11px] text-muted">حداقل ۸ کاراکتر، شامل حرف و عدد</p>
        </div>
        <div>
          <label className="label" htmlFor="profile-confirm-password">تکرار رمز جدید *</label>
          <input id="profile-confirm-password" className="input" dir="ltr" type="password" autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
        </div>
      </div>
      <button type="submit" className="btn btn-primary" disabled={pending || !currentPassword || !newPassword}>
        <KeyRound className="size-4" />
        {pending ? "در حال تغییر…" : "تغییر رمز عبور"}
      </button>
    </form>
  );
}

export function SessionActions() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [allPending, startAll] = useTransition();

  return (
    <div className="flex flex-wrap gap-2">
      <button
        type="button"
        className="btn btn-outline"
        disabled={pending}
        onClick={() =>
          start(async () => {
            await logout();
            toast.success("از این دستگاه خارج شدید");
            router.push("/login");
            router.refresh();
          })
        }
      >
        <LogOut className="size-4" />
        خروج از این دستگاه
      </button>
      <button
        type="button"
        className="btn btn-danger"
        disabled={allPending}
        onClick={() => {
          if (!confirm("از همه دستگاه‌ها خارج شوید؟ همه نشست‌های فعال باطل می‌شوند.")) return;
          startAll(async () => {
            const res = await logoutAllDevices();
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success("همه نشست‌ها باطل شدند");
            router.push("/login");
            router.refresh();
          });
        }}
      >
        <ShieldOff className="size-4" />
        خروج از همه دستگاه‌ها
      </button>
    </div>
  );
}
