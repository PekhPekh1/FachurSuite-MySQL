import { cookies } from "next/headers";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { Clock3, MonitorSmartphone, ShieldCheck, UserRound } from "lucide-react";
import { db } from "@/db";
import { refreshTokens, users } from "@/db/schema";
import { hashToken, requireUser } from "@/lib/auth";
import { REFRESH_COOKIE } from "@/lib/auth-constants";
import { faDigits } from "@/lib/prefs";
import { formatJalali } from "@/lib/jalali";
import { fmtDate, fmtNum, ROLE_FA } from "@/lib/format";
import { Badge, Card, PageHeader, TableShell } from "@/components/ui";
import { ChangeMyPasswordForm, SessionActions } from "@/components/forms/profile-forms";
import { AppearanceForm } from "@/components/forms/settings-forms";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const user = await requireUser();
  const fa = await faDigits();
  const rawRefresh = (await cookies()).get(REFRESH_COOKIE)?.value;
  const currentHash = rawRefresh ? hashToken(rawRefresh) : null;

  const [record] = await db
    .select({
      username: users.username,
      fullName: users.fullName,
      role: users.role,
      isActive: users.isActive,
      createdAt: users.createdAt,
      prefTheme: users.prefTheme,
      prefPalette: users.prefPalette,
      prefFaDigits: users.prefFaDigits,
    })
    .from(users)
    .where(eq(users.id, user.id))
    .limit(1);

  const sessions = await db
    .select({ tokenHash: refreshTokens.tokenHash, createdAt: refreshTokens.createdAt, expiresAt: refreshTokens.expiresAt })
    .from(refreshTokens)
    .where(and(eq(refreshTokens.userId, user.id), isNull(refreshTokens.revokedAt), gt(refreshTokens.expiresAt, new Date())))
    .orderBy(desc(refreshTokens.createdAt));

  return (
    <div className="space-y-6">
      <PageHeader title="پروفایل و نشست‌ها" subtitle="مدیریت رمز عبور، دستگاه‌ها و ترجیحات شخصی" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <div className="flex flex-col items-center text-center">
            <div className="grid size-20 place-items-center rounded-full bg-brand-grad text-3xl font-bold text-white">{record.fullName.slice(0, 1)}</div>
            <h2 className="mt-3 text-lg font-bold">{record.fullName}</h2>
            <p className="font-mono text-xs text-muted" dir="ltr">@{record.username}</p>
            <div className="mt-3 flex gap-2">
              <Badge tone={record.role === "ADMIN" ? "danger" : record.role === "OPERATOR" ? "info" : "muted"}>{ROLE_FA[record.role]}</Badge>
              <Badge tone={record.isActive ? "success" : "danger"}>{record.isActive ? "فعال" : "غیرفعال"}</Badge>
            </div>
          </div>
          <div className="mt-5 space-y-2 border-t border-base pt-4 text-sm">
            <p className="flex items-center justify-between"><span className="text-muted">عضویت</span><span>{fmtDate(formatJalali(record.createdAt), fa)}</span></p>
            <p className="flex items-center justify-between"><span className="text-muted">نشست فعال</span><span>{fmtNum(sessions.length, fa)}</span></p>
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <h2 className="mb-4 flex items-center gap-2 text-sm font-bold"><ShieldCheck className="size-4 text-brand" />تغییر رمز عبور</h2>
          <ChangeMyPasswordForm />
        </Card>
      </div>

      <Card>
        <h2 className="mb-1 flex items-center gap-2 text-sm font-bold"><UserRound className="size-4 text-brand" />ترجیحات نمایش من</h2>
        <p className="mb-4 text-xs text-muted">حالت نمایش، پوسته رنگی و نوع ارقام برای این حساب ذخیره می‌شود.</p>
        <AppearanceForm
          initial={{
            theme: record.prefTheme as "light" | "dark" | "system",
            palette: record.prefPalette as "blue" | "green" | "purple" | "orange" | "teal" | "rose",
            faDigits: record.prefFaDigits,
          }}
        />
      </Card>

      <Card>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold"><MonitorSmartphone className="size-4 text-brand" />نشست‌های فعال</h2>
            <p className="mt-1 text-[11px] text-muted">توکن خام هرگز نمایش داده نمی‌شود؛ تنها زمان ایجاد و انقضا قابل مشاهده است.</p>
          </div>
          <SessionActions />
        </div>
        <TableShell>
          <thead><tr><th>نشست</th><th>ایجاد</th><th>انقضا</th><th>وضعیت</th></tr></thead>
          <tbody>
            {sessions.map((s, index) => (
              <tr key={s.tokenHash}>
                <td className="flex items-center gap-2"><Clock3 className="size-3.5 text-muted" />نشست {fmtNum(index + 1, fa)}</td>
                <td className="text-xs text-muted">{fmtDate(formatJalali(s.createdAt, true), fa)}</td>
                <td className="text-xs text-muted">{fmtDate(formatJalali(s.expiresAt, true), fa)}</td>
                <td>{currentHash === s.tokenHash ? <Badge tone="success">این دستگاه</Badge> : <Badge tone="info">فعال</Badge>}</td>
              </tr>
            ))}
          </tbody>
        </TableShell>
      </Card>
    </div>
  );
}
