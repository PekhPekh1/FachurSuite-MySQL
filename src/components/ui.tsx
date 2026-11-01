import type { ReactNode } from "react";
import { cx } from "@/lib/format";
import {
  PAYMENT_METHOD_FA,
  PAYMENT_STATUS_FA,
  CONTRACT_STATUS_FA,
  ROLE_FA,
} from "@/lib/format";

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("card p-5", className)}>{children}</div>;
}

export function PageHeader({
  title,
  subtitle,
  actions,
}: {
  title: ReactNode;
  subtitle?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-xl font-bold sm:text-2xl">{title}</h1>
        {subtitle ? <p className="mt-1 text-sm text-muted">{subtitle}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function StatCard({
  icon,
  label,
  value,
  sub,
  tone = "brand",
}: {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string;
  tone?: "brand" | "success" | "warning" | "danger";
}) {
  const tones: Record<string, string> = {
    brand: "bg-brand-soft text-brand",
    success: "bg-[var(--success-soft)] text-[var(--success)]",
    warning: "bg-[var(--warning-soft)] text-[var(--warning)]",
    danger: "bg-[var(--danger-soft)] text-[var(--danger)]",
  };
  return (
    <div className="card flex items-center gap-4 p-4 sm:p-5">
      <div className={cx("grid size-12 shrink-0 place-items-center rounded-2xl", tones[tone])}>{icon}</div>
      <div className="min-w-0">
        <p className="text-xs text-muted">{label}</p>
        <p className="mt-0.5 truncate text-lg font-bold sm:text-xl">{value}</p>
        {sub ? <p className="mt-0.5 truncate text-[11px] text-muted">{sub}</p> : null}
      </div>
    </div>
  );
}

type Tone = "success" | "warning" | "danger" | "info" | "muted";

export function Badge({ tone = "muted", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("badge", `badge-${tone}`)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  CONFIRMED: "success",
  SETTLED: "success",
  PAID: "success",
  PENDING_VERIFICATION: "warning",
  RESERVED: "warning",
  FORGIVEN: "warning",
  ACTIVE: "info",
  UNPAID: "muted",
  OVERDUE: "danger",
  REJECTED: "danger",
  CANCELED: "danger",
};

const STATUS_FA: Record<string, string> = {
  ...PAYMENT_STATUS_FA,
  ...CONTRACT_STATUS_FA,
  PAID: "پرداخت شده",
  UNPAID: "پرداخت نشده",
  RESERVED: "در انتظار تأیید فیش",
  FORGIVEN: "بخشوده شده",
  OVERDUE: "معوقه",
};

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  return <Badge tone={STATUS_TONE[status] ?? "muted"}>{label ?? STATUS_FA[status] ?? status}</Badge>;
}

export function MethodBadge({ method }: { method: string }) {
  const tone: Tone = method === "CARD_TO_CARD" ? "warning" : method === "CARD_READER" ? "info" : "success";
  return <Badge tone={tone}>{PAYMENT_METHOD_FA[method] ?? method}</Badge>;
}

export function RoleBadge({ role }: { role: string }) {
  const tone: Tone = role === "ADMIN" ? "danger" : role === "OPERATOR" ? "info" : "muted";
  return <Badge tone={tone}>{ROLE_FA[role] ?? role}</Badge>;
}

export function EmptyState({
  icon,
  title,
  hint,
  action,
}: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-base px-6 py-12 text-center">
      {icon ? <div className="text-muted">{icon}</div> : null}
      <p className="font-medium">{title}</p>
      {hint ? <p className="max-w-md text-sm text-muted">{hint}</p> : null}
      {action}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx("skeleton", className)} />;
}

export function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-xs text-[var(--danger)]">{message}</p>;
}

/** Simple RTL table wrapper with sticky header styles. */
export function TableShell({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-2xl border border-base">
      <table className="w-full min-w-max text-sm [&_th]:bg-[var(--surface-2)] [&_th]:px-4 [&_th]:py-3 [&_th]:text-right [&_th]:text-xs [&_th]:font-medium [&_th]:text-[var(--muted)] [&_td]:border-t [&_td]:border-[var(--border)] [&_td]:px-4 [&_td]:py-3">
        {children}
      </table>
    </div>
  );
}
