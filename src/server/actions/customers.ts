"use server";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { customerCreditHistory, customers, guarantors, users } from "@/db/schema";
import { requireActionUser, revokeAllUserTokens } from "@/lib/auth";
import { customerSchema, guarantorSchema } from "@/lib/validators";
import { logAction } from "@/lib/audit";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): Result => ({ ok: false, error: e instanceof Error ? e.message : "خطای غیرمنتظره رخ داد" });
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: string }).code === "23505";
const fullName = (first: string, last: string) => `${first.trim()} ${last.trim()}`;

export async function createCustomer(raw: unknown): Promise<Result<{ id: string }>> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    const value = customerSchema.parse(raw);
    const row = await db.transaction(async (tx) => {
      const createdId = randomUUID();
      await tx.insert(customers).values({ ...{
          ...value,
          fullName: fullName(value.firstName, value.lastName),
          phone: value.phone || null,
          address: value.address || null,
          occupation: value.occupation || null,
          notes: value.notes || null,
          createdBy: actor.id,
        }, id: createdId });
      const created = { id: createdId };
      await tx.insert(customerCreditHistory).values({
        customerId: created.id,
        oldScore: 500,
        newScore: 500,
        reason: "INITIAL",
        details: { ruleVersion: 1 },
        computedBy: actor.id,
      });
      await logAction(actor, "customer.create", "customer", created.id, { fullName: fullName(value.firstName, value.lastName) }, tx);
      return created;
    });
    revalidatePath("/customers");
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: "مشتری با این کد ملی قبلاً ثبت شده است" };
    return fail(e);
  }
}

export async function updateCustomer(id: string, raw: unknown): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    const value = customerSchema.parse(raw);
    const updated = await db
      .update(customers)
      .set({
        ...value,
        fullName: fullName(value.firstName, value.lastName),
        phone: value.phone || null,
        address: value.address || null,
        occupation: value.occupation || null,
        notes: value.notes || null,
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id));
    if (updated[0].affectedRows === 0) throw new Error("مشتری یافت نشد");
    await logAction(actor, "customer.update", "customer", id, { fields: Object.keys(value).filter((k) => k !== "notes") });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { ok: true };
  } catch (e) {
    if (isUnique(e)) return { ok: false, error: "مشتری دیگری با این کد ملی وجود دارد" };
    return fail(e);
  }
}

export async function setCustomerActive(id: string, active: boolean, reason: string): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    if (!active && reason.trim().length < 3) throw new Error("دلیل غیرفعال‌سازی الزامی است");
    const [updated] = await db
      .update(customers)
      .set({
        isActive: active,
        deactivatedAt: active ? null : new Date(),
        deactivatedBy: active ? null : actor.id,
        deactivationReason: active ? null : reason.trim(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id));
    if (!updated) throw new Error("مشتری یافت نشد");

    if (!active) {
      const linked = await db.select({ id: users.id }).from(users).where(eq(users.customerId, id));
      await db.update(users).set({ isActive: false }).where(eq(users.customerId, id));
      for (const user of linked) await revokeAllUserTokens(user.id);
    }
    await logAction(actor, active ? "customer.activate" : "customer.deactivate", "customer", id, { reason });
    revalidatePath("/customers");
    revalidatePath(`/customers/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setCustomerBlacklist(id: string, blacklisted: boolean, reason: string): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN"]);
    if (blacklisted && reason.trim().length < 3) throw new Error("دلیل ورود به فهرست سیاه الزامی است");
    const [current] = await db.select({ creditScore: customers.creditScore }).from(customers).where(eq(customers.id, id)).limit(1);
    if (!current) throw new Error("مشتری یافت نشد");
    await db
      .update(customers)
      .set({
        isBlacklisted: blacklisted,
        blacklistReason: blacklisted ? reason.trim() : null,
        blacklistedAt: blacklisted ? new Date() : null,
        blacklistedBy: blacklisted ? actor.id : null,
        creditScore: blacklisted ? 0 : 500,
        creditScoreUpdatedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(customers.id, id));
    await db.insert(customerCreditHistory).values({
      customerId: id,
      oldScore: current.creditScore,
      newScore: blacklisted ? 0 : 500,
      reason: blacklisted ? "BLACKLISTED" : "BLACKLIST_REMOVED",
      details: { reason },
      computedBy: actor.id,
    });
    await logAction(actor, blacklisted ? "customer.blacklist" : "customer.unblacklist", "customer", id, { reason });
    revalidatePath(`/customers/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addGuarantor(raw: unknown): Promise<Result<{ id: string }>> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    const value = guarantorSchema.parse(raw);
    const rowId = randomUUID();
      await db.insert(guarantors).values({ ...{
        customerId: value.customerId,
        fullName: value.fullName,
        nationalCode: value.nationalCode || null,
        mobile: value.mobile || null,
        relation: value.relation || null,
        address: value.address || null,
        notes: value.notes || null,
      }, id: rowId });
      const row = { id: rowId };
    await logAction(actor, "guarantor.create", "guarantor", row.id, { customerId: value.customerId });
    revalidatePath(`/customers/${value.customerId}`);
    return { ok: true, data: { id: row.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteGuarantor(id: string, customerId: string): Promise<Result> {
  try {
    const actor = await requireActionUser(["ADMIN", "OPERATOR"]);
    await db.update(guarantors).set({ isActive: false, updatedAt: new Date() }).where(eq(guarantors.id, id));
    await logAction(actor, "guarantor.deactivate", "guarantor", id, { customerId });
    revalidatePath(`/customers/${customerId}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
