import { NextResponse } from "next/server";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "fs/promises";
import path from "path";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, documents, guarantors, payments } from "@/db/schema";
import { getSessionUser } from "@/lib/auth";
import { logAction } from "@/lib/audit";

export const runtime = "nodejs";

const MAX_SIZE = 5 * 1024 * 1024;
const OWNER_TYPES = new Set(["customer", "guarantor", "payment"]);
const CATEGORIES = new Set(["NATIONAL_CARD", "GUARANTEE", "CHEQUE", "RECEIPT", "OTHER"]);

function detectFile(bytes: Buffer): { mime: string; ext: string } | null {
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: ".jpg" };
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return { mime: "image/png", ext: ".png" };
  }
  if (bytes.length >= 5 && bytes.subarray(0, 5).toString("ascii") === "%PDF-") return { mime: "application/pdf", ext: ".pdf" };
  return null;
}

async function canUpload(user: NonNullable<Awaited<ReturnType<typeof getSessionUser>>>, ownerType: string, ownerId: string) {
  if (user.role !== "CUSTOMER") return true;
  if (!user.customerId) return false;
  if (ownerType === "customer") return ownerId === user.customerId;
  if (ownerType === "guarantor") {
    const [row] = await db
      .select({ id: guarantors.id })
      .from(guarantors)
      .where(and(eq(guarantors.id, ownerId), eq(guarantors.customerId, user.customerId)))
      .limit(1);
    return Boolean(row);
  }
  if (ownerType === "payment") {
    const [row] = await db
      .select({ customerId: payments.customerId })
      .from(payments)
      .where(eq(payments.id, ownerId))
      .limit(1);
    // Receipt drafts use a client-generated UUID before the Payment row exists;
    // uploadedBy still scopes the orphan until payment submission links it.
    return !row || row.customerId === user.customerId;
  }
  return false;
}

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "نشست معتبر نیست" }, { status: 401 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const ownerType = String(form?.get("ownerType") ?? "");
  const ownerId = String(form?.get("ownerId") ?? "");
  const categoryInput = String(form?.get("category") ?? "OTHER");
  const category = CATEGORIES.has(categoryInput) ? categoryInput : "OTHER";

  if (!(file instanceof File)) return NextResponse.json({ error: "فایل ارسال نشده است" }, { status: 400 });
  if (!OWNER_TYPES.has(ownerType)) return NextResponse.json({ error: "نوع مالک سند نامعتبر است" }, { status: 400 });
  if (!/^[0-9a-fA-F-]{36}$/.test(ownerId)) return NextResponse.json({ error: "شناسه مالک نامعتبر است" }, { status: 400 });
  if (file.size > MAX_SIZE) return NextResponse.json({ error: "حجم فایل نباید بیش از ۵ مگابایت باشد" }, { status: 400 });
  if (!(await canUpload(user, ownerType, ownerId))) return NextResponse.json({ error: "مجوز بارگذاری این سند را ندارید" }, { status: 403 });

  // Verify the owner actually exists for customer uploads as well.
  if (ownerType === "customer") {
    const [owner] = await db.select({ id: customers.id }).from(customers).where(eq(customers.id, ownerId)).limit(1);
    if (!owner) return NextResponse.json({ error: "مشتری یافت نشد" }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  const detected = detectFile(bytes);
  if (!detected) return NextResponse.json({ error: "محتوای فایل معتبر نیست؛ فقط JPG، PNG و PDF مجاز است" }, { status: 400 });
  if (file.type && file.type !== detected.mime) return NextResponse.json({ error: "نوع اعلام‌شده فایل با محتوای آن مطابقت ندارد" }, { status: 400 });

  const storedName = `${randomUUID()}${detected.ext}`;
  const dir = path.join(process.cwd(), "uploads");
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, storedName), bytes, { flag: "wx" });
  const checksumSha256 = createHash("sha256").update(bytes).digest("hex");

  const docId = randomUUID();
      await db.insert(documents).values({ ...{
      ownerType,
      ownerId,
      category,
      fileName: path.basename(file.name).replace(/[\u0000-\u001f]/g, "").slice(0, 200) || `document${detected.ext}`,
      storedName,
      mimeType: detected.mime,
      checksumSha256,
      size: bytes.length,
      uploadedBy: user.id,
    }, id: docId });
      const doc = { id: docId };

  await logAction(user, "document.upload", "document", doc.id, { ownerType, ownerId, category, size: bytes.length, checksumSha256 });
  return NextResponse.json({ id: doc.id });
}
