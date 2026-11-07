import { randomInt } from "node:crypto";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import type { Tx } from "../blog/shared.ts";

/** No 0/O, 1/I/L: a code read aloud or typed from a screenshot is not mistaken. */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** The most generated codes one discount may hold. */
export const MAX_CODES_PER_DISCOUNT = 10_000;

function randomCode(prefix: string, length: number): string {
  let body = "";
  for (let i = 0; i < length; i++) body += ALPHABET[randomInt(ALPHABET.length)];
  return `${prefix}${body}`;
}

async function loadCodeListDiscount(tx: Tx, ctx: TenantContext, id: string) {
  const [d] = await tx.select().from(schema.discounts).where(and(eq(schema.discounts.tenantId, ctx.tenantId), eq(schema.discounts.id, id))).limit(1);
  if (!d) throw new Error(`Not Found: discount ${id}`);
  if (!d.usesCodeList) throw new Error("Bad Request: this discount does not use a list of codes");
  return d;
}

export interface GenerateDiscountCodesInput {
  id: string;
  count: number;
  /** Letters and digits put in front of every code, e.g. "DIWALI-". */
  prefix?: string | undefined;
  /** Random characters after the prefix. */
  length?: number | undefined;
}

/**
 * Adds single-use codes to a discount made for a list of them (influencers, CRM exports, retention). Every code is unique
 * across the store: it cannot equal another generated code or any discount's own code.
 */
export async function generateDiscountCodes(rt: Runtime, ctx: TenantContext, input: GenerateDiscountCodesInput): Promise<{ created: number }> {
  assertPermission(ctx, "discounts.write");
  const prefix = (input.prefix ?? "").toUpperCase();
  if (!/^[A-Z0-9-]{0,12}$/.test(prefix)) throw new Error("Bad Request: the prefix can have up to 12 letters, digits or dashes");
  const length = input.length ?? 8;
  if (!Number.isInteger(length) || length < 6 || length > 16) throw new Error("Bad Request: codes must be 6 to 16 characters after the prefix");
  if (!Number.isInteger(input.count) || input.count < 1) throw new Error("Bad Request: choose how many codes to make");

  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const d = await loadCodeListDiscount(tx, ctx, input.id);
    if (d.status === "archived") throw new Error("Bad Request: this discount is archived");
    const [have] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.discountCodes).where(and(eq(schema.discountCodes.tenantId, ctx.tenantId), eq(schema.discountCodes.discountId, d.id)));
    if ((have?.n ?? 0) + input.count > MAX_CODES_PER_DISCOUNT) {
      throw new Error(`Bad Request: a discount can hold up to ${MAX_CODES_PER_DISCOUNT} codes (it has ${have?.n ?? 0})`);
    }

    let created = 0;
    for (let attempt = 0; attempt < 20 && created < input.count; attempt++) {
      const want = input.count - created;
      const batch = [...new Set(Array.from({ length: want }, () => randomCode(prefix, length)))];
      // A code equal to a discount's own code would be ambiguous at the till.
      const clash = await tx.select({ code: schema.discounts.code }).from(schema.discounts).where(and(eq(schema.discounts.tenantId, ctx.tenantId), inArray(schema.discounts.code, batch)));
      const clashing = new Set(clash.map((c) => (c.code ?? "").toUpperCase()));
      const fresh = batch.filter((c) => !clashing.has(c));
      if (fresh.length === 0) continue;
      const inserted = await tx
        .insert(schema.discountCodes)
        .values(fresh.map((code) => ({ tenantId: ctx.tenantId, discountId: d.id, code })))
        .onConflictDoNothing()
        .returning({ id: schema.discountCodes.id });
      created += inserted.length;
    }
    if (created < input.count) throw new Error("Bad Request: could not make that many different codes: use a longer code or a different prefix");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "discount.codes.generate",
      targetType: "discount",
      targetId: d.id,
      diff: { count: created, prefix, length },
    });
    return { created };
  });
}

export interface ListDiscountCodesInput {
  id: string;
  filter?: "all" | "used" | "unused" | undefined;
  search?: string | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listDiscountCodes(rt: Runtime, ctx: TenantContext, input: ListDiscountCodesInput) {
  assertPermission(ctx, "discounts.write");
  return withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const d = await loadCodeListDiscount(tx, ctx, input.id);
    const base = and(eq(schema.discountCodes.tenantId, ctx.tenantId), eq(schema.discountCodes.discountId, d.id));
    const where = and(
      base,
      input.filter === "used" ? sql`${schema.discountCodes.usedAt} is not null` : input.filter === "unused" ? sql`${schema.discountCodes.usedAt} is null` : undefined,
      input.search ? sql`${schema.discountCodes.code} ILIKE ${`%${input.search}%`}` : undefined,
    );
    const [totals] = await tx
      .select({ total: sql<number>`count(*)::int`, used: sql<number>`count(${schema.discountCodes.usedAt})::int` })
      .from(schema.discountCodes)
      .where(base);
    const [matching] = await tx.select({ n: sql<number>`count(*)::int` }).from(schema.discountCodes).where(where);
    const rows = await tx
      .select({ id: schema.discountCodes.id, code: schema.discountCodes.code, usedAt: schema.discountCodes.usedAt })
      .from(schema.discountCodes)
      .where(where)
      .orderBy(asc(schema.discountCodes.createdAt), asc(schema.discountCodes.code))
      .limit(Math.min(input.limit ?? 100, 5000))
      .offset(input.offset ?? 0);
    return {
      items: rows.map((r) => ({ id: r.id, code: r.code, usedAt: r.usedAt ? r.usedAt.toISOString() : null })),
      total: matching?.n ?? 0,
      codeCount: totals?.total ?? 0,
      usedCount: totals?.used ?? 0,
    };
  });
}
