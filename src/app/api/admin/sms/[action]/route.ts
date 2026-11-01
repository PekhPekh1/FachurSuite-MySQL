import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth";
import { apiError } from "@/lib/http-security";
import {
  runReminderCycle,
  testSmsProvider,
  updateSmsProvider,
  updateSmsSchedule,
  updateSmsTemplate,
} from "@/server/actions/sms";

export const dynamic = "force-dynamic";

/**
 * ADMIN-only SMS administration endpoints used by the settings screen and the
 * integration test-suite: provider configuration, template editing, scheduling,
 * test dispatch and the reminder cycle.
 */
export async function POST(req: Request, { params }: { params: Promise<{ action: string }> }) {
  const user = await getSessionUser();
  if (!user) return apiError("توکن دسترسی نامعتبر یا منقضی است", 401);
  if (user.role !== "ADMIN") return apiError("شما مجوز انجام این عملیات را ندارید", 403);

  const { action } = await params;
  const body = await req.json().catch(() => ({}));

  switch (action) {
    case "provider": {
      const res = await updateSmsProvider(body);
      return res.ok ? NextResponse.json({ ok: true }) : apiError(res.error, 400);
    }
    case "template": {
      const res = await updateSmsTemplate(body);
      return res.ok ? NextResponse.json({ ok: true }) : apiError(res.error, 400);
    }
    case "schedule": {
      const res = await updateSmsSchedule(body);
      return res.ok ? NextResponse.json({ ok: true }) : apiError(res.error, 400);
    }
    case "test": {
      const res = await testSmsProvider(body);
      return res.ok ? NextResponse.json({ ok: true, status: res.data?.status }) : apiError(res.error, 400);
    }
    case "cycle": {
      const res = await runReminderCycle();
      return res.ok ? NextResponse.json({ ok: true, ...res.data }) : apiError(res.error, 400);
    }
    default:
      return apiError("عملیات نامعتبر است", 404);
  }
}
