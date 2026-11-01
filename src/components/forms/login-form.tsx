"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { LogIn, Eye, EyeOff } from "lucide-react";
import { loginSchema, type LoginInput } from "@/lib/validators";
import { login } from "@/server/actions/auth";
import { FieldError } from "@/components/ui";

export function LoginForm() {
  const router = useRouter();
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<LoginInput>({ resolver: zodResolver(loginSchema) });

  return (
    <form
      className="space-y-4"
      onSubmit={handleSubmit((values) =>
        start(async () => {
          setError(null);
          const res = await login(values);
          if (!res.ok) return setError(res.error);
          router.push(res.role === "CUSTOMER" ? "/portal" : "/");
          router.refresh();
        }),
      )}
    >
      <div>
        <label className="label" htmlFor="username">نام کاربری</label>
        <input id="username" className="input" autoComplete="username" dir="ltr" {...register("username")} />
        <FieldError message={errors.username?.message} />
      </div>
      <div>
        <label className="label" htmlFor="password">رمز عبور</label>
        <div className="relative">
          <input
            id="password"
            type={show ? "text" : "password"}
            className="input ps-10"
            autoComplete="current-password"
            dir="ltr"
            {...register("password")}
          />
          <button
            type="button"
            tabIndex={-1}
            aria-label="نمایش رمز"
            className="absolute start-3 top-1/2 -translate-y-1/2 text-muted"
            onClick={() => setShow((v) => !v)}
          >
            {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </div>
        <FieldError message={errors.password?.message} />
      </div>
      {error ? (
        <div className="rounded-xl bg-[var(--danger-soft)] px-4 py-2.5 text-sm text-[var(--danger)]">{error}</div>
      ) : null}
      <button type="submit" className="btn btn-primary w-full" disabled={pending}>
        <LogIn className="size-4" />
        {pending ? "در حال بررسی…" : "ورود به سامانه"}
      </button>
    </form>
  );
}
