import { NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents, guarantors, payments } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getSessionUser();
  if (!u) return NextResponse.json({ error: "نشست معتبر نیست" }, { status: 401 });

  const { id } = await params;
  const [doc] = await db.select().from(documents).where(eq(documents.id, id)).limit(1);
  if (!doc) return NextResponse.json({ error: "سند یافت نشد" }, { status: 404 });

  if (u.role === "CUSTOMER") {
    let allowed = false;
    if (doc.ownerType === "customer" && doc.ownerId === u.customerId) allowed = true;
    if (!allowed && doc.ownerType === "guarantor" && u.customerId) {
      const [g] = await db
        .select({ id: guarantors.id })
        .from(guarantors)
        .where(and(eq(guarantors.id, doc.ownerId), eq(guarantors.customerId, u.customerId)))
        .limit(1);
      allowed = Boolean(g);
    }
    if (!allowed && doc.ownerType === "payment" && u.customerId) {
      const [p] = await db
        .select({ id: payments.id })
        .from(payments)
        .where(and(eq(payments.receiptDocumentId, doc.id), eq(payments.customerId, u.customerId)))
        .limit(1);
      allowed = Boolean(p);
    }
    if (!allowed) return NextResponse.json({ error: "دسترسی به این سند برای شما مجاز نیست" }, { status: 403 });
  }

  try {
    const buf = await readFile(path.join(process.cwd(), "uploads", doc.storedName));
    return new NextResponse(new Uint8Array(buf), {
      headers: {
        "Content-Type": doc.mimeType,
        "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(doc.fileName)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch {
    return NextResponse.json({ error: "فایل سند در سرور یافت نشد" }, { status: 404 });
  }
}
