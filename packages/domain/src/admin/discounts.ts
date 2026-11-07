import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { parseDiscountAppliesTo, parseDiscountRules, type DiscountAppliesTo, type DiscountRules } from "@bs/contracts/discount-rules";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import type { Tx } from "../blog/shared.ts";

/** Audit row for a discount change (AGENTS.md rule 6: money settings are audited). */
async function auditDiscount(tx: Tx, ctx: TenantContext, action: string, id: string, diff: Record<string, unknown>): Promise<void> {
  await tx.insert(schema.auditLogs).values({
    tenantId: ctx.tenantId,
    actorType: ctx.actor.type,
    actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
    action,
    targetType: "discount",
    targetId: id,
    diff,
  });
}

/**
 * The rules that keep a discount meaningful, checked on the server whatever the form sent: a percent is 1 to 100, a
 * scope or a cap only fits a percent or fixed amount, and every product or collection named must be this store's own.
 */
async function assertDiscountSetup(
  tx: Tx,
  ctx: TenantContext,
  setup: { type: string; value: number; appliesTo: DiscountAppliesTo; rules: DiscountRules },
): Promise<void> {
  const { type, value, appliesTo, rules } = setup;
  if (type === "percent" && (value < 1 || value > 100)) throw new Error("Bad Request: a percentage must be between 1 and 100");
  if ((type === "fixed") && value < 1) throw new Error("Bad Request: enter an amount greater than zero");
  if (appliesTo.type !== "all" && type !== "percent" && type !== "fixed") {
    throw new Error("Bad Request: only a percentage or a fixed amount can be limited to products or collections");
  }
  if (rules.maxDiscount !== undefined && type !== "percent") throw new Error("Bad Request: a maximum only applies to a percentage discount");
  if (rules.oncePerOrder && !(type === "fixed" && appliesTo.type !== "all")) {
    throw new Error("Bad Request: 'once per order' only applies to a fixed amount on chosen products");
  }
  if (appliesTo.type === "products") {
    const ids = [...new Set(appliesTo.productIds)];
    const [found] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.products)
      .where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.id, ids)));
    if ((found?.n ?? 0) !== ids.length) throw new Error("Bad Request: one of the chosen products no longer exists");
  }
  if (appliesTo.type === "collections") {
    const ids = [...new Set(appliesTo.collectionIds)];
    const [found] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.collections)
      .where(and(eq(schema.collections.tenantId, ctx.tenantId), inArray(schema.collections.id, ids)));
    if ((found?.n ?? 0) !== ids.length) throw new Error("Bad Request: one of the chosen collections no longer exists");
  }
}

export interface ListDiscountsInput {
  search?: string | undefined;
  status?: string | undefined;
  type?: string | undefined;
  sort?: "created_desc" | "created_asc" | "title_asc" | "title_desc" | "used_desc" | "used_asc" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listAdminDiscounts(
  rt: Runtime,
  ctx: TenantContext,
  input: ListDiscountsInput = {},
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];

    if (input.status) {
      conditions.push(eq(schema.discounts.status, input.status));
    } else {
      // Archived discounts only show under their own filter.
      conditions.push(sql`${schema.discounts.status} <> 'archived'`);
    }

    if (input.type) {
      conditions.push(eq(schema.discounts.type, input.type));
    }

    if (input.search) {
      conditions.push(
        sql`(${schema.discounts.title} ILIKE ${`%${input.search}%`} OR ${schema.discounts.code} ILIKE ${`%${input.search}%`})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderBy = {
      created_desc: [desc(schema.discounts.createdAt), desc(schema.discounts.id)],
      created_asc: [asc(schema.discounts.createdAt), asc(schema.discounts.id)],
      title_asc: [asc(schema.discounts.title), asc(schema.discounts.id)],
      title_desc: [desc(schema.discounts.title), desc(schema.discounts.id)],
      used_desc: [desc(schema.discounts.usedCount), desc(schema.discounts.id)],
      used_asc: [asc(schema.discounts.usedCount), asc(schema.discounts.id)],
    }[input.sort ?? "created_desc"];

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.discounts)
      .where(whereClause);

    const rows = await tx
      .select({
        id: schema.discounts.id,
        code: schema.discounts.code,
        title: schema.discounts.title,
        type: schema.discounts.type,
        value: schema.discounts.value,
        appliesTo: schema.discounts.appliesTo,
        usageLimit: schema.discounts.usageLimit,
        usedCount: schema.discounts.usedCount,
        status: schema.discounts.status,
        combinable: schema.discounts.combinable,
        startsAt: schema.discounts.startsAt,
        endsAt: schema.discounts.endsAt,
        createdAt: schema.discounts.createdAt,
      })
      .from(schema.discounts)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        code: r.code,
        title: r.title,
        type: r.type,
        value: r.value,
        appliesTo: parseDiscountAppliesTo(r.appliesTo) ?? ({ type: "all" } as DiscountAppliesTo),
        usageLimit: r.usageLimit,
        usedCount: r.usedCount,
        status: r.status,
        combinable: r.combinable,
        startsAt: r.startsAt ? r.startsAt.toISOString() : null,
        endsAt: r.endsAt ? r.endsAt.toISOString() : null,
        createdAt: r.createdAt.toISOString(),
      })),
      total: countResult?.count ?? 0,
    };
  });
}

export async function createAdminDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    code?: string | undefined;
    title: string;
    type: "percent" | "fixed" | "free_shipping" | "buy_x_get_y";
    value: number;
    appliesTo?: DiscountAppliesTo | undefined;
    rules?: DiscountRules | undefined;
    minSubtotal?: number | undefined;
    usageLimit?: number | undefined;
    perCustomerLimit?: number | undefined;
    combinable?: boolean | undefined;
    showOnStorefront?: boolean | undefined;
    startsAt?: string | undefined;
    endsAt?: string | undefined;
  },
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const appliesTo: DiscountAppliesTo = input.appliesTo ?? { type: "all" };
    const rules: DiscountRules = input.rules ?? {};
    await assertDiscountSetup(tx, ctx, { type: input.type, value: input.value, appliesTo, rules });
    const [created] = await tx
      .insert(schema.discounts)
      .values({
        tenantId: ctx.tenantId,
        code: input.code ? input.code.toUpperCase() : null,
        title: input.title,
        type: input.type,
        value: input.value,
        appliesTo,
        rules,
        minSubtotal: input.minSubtotal ?? 0,
        usageLimit: input.usageLimit ?? null,
        perCustomerLimit: input.perCustomerLimit ?? null,
        combinable: input.combinable ?? false,
        showOnStorefront: input.showOnStorefront ?? false,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        status: "active",
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create discount");
    }

    await auditDiscount(tx, ctx, "discount.create", created.id, {
      code: created.code,
      title: created.title,
      type: created.type,
      value: created.value,
      appliesTo,
      rules,
      minSubtotal: created.minSubtotal,
      usageLimit: created.usageLimit,
      perCustomerLimit: created.perCustomerLimit,
      combinable: created.combinable,
    });

    return {
      id: created.id,
      code: created.code,
      title: created.title,
      type: created.type,
      value: created.value,
      status: created.status,
    };
  });
}

export async function getAdminDiscount(rt: Runtime, ctx: TenantContext, input: { id: string }) {
  assertPermission(ctx, "discounts.write");
  return await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    const [d] = await tx.select().from(schema.discounts).where(and(eq(schema.discounts.tenantId, ctx.tenantId), eq(schema.discounts.id, input.id))).limit(1);
    if (!d) throw new Error(`Discount not found: ${input.id}`);
    const scope = parseDiscountAppliesTo(d.appliesTo);
    const appliesToItems =
      scope?.type === "products"
        ? await tx.select({ id: schema.products.id, title: schema.products.title }).from(schema.products).where(and(eq(schema.products.tenantId, ctx.tenantId), inArray(schema.products.id, scope.productIds)))
        : scope?.type === "collections"
          ? await tx.select({ id: schema.collections.id, title: schema.collections.title }).from(schema.collections).where(and(eq(schema.collections.tenantId, ctx.tenantId), inArray(schema.collections.id, scope.collectionIds)))
          : [];
    return {
      appliesToItems,
      id: d.id,
      code: d.code,
      title: d.title,
      type: d.type,
      value: d.value,
      appliesTo: parseDiscountAppliesTo(d.appliesTo) ?? ({ type: "all" } as DiscountAppliesTo),
      rules: parseDiscountRules(d.rules),
      minSubtotal: d.minSubtotal ?? 0,
      usageLimit: d.usageLimit,
      perCustomerLimit: d.perCustomerLimit,
      usedCount: d.usedCount,
      combinable: d.combinable,
      showOnStorefront: d.showOnStorefront,
      startsAt: d.startsAt ? d.startsAt.toISOString() : null,
      endsAt: d.endsAt ? d.endsAt.toISOString() : null,
      status: d.status,
      createdAt: d.createdAt.toISOString(),
    };
  });
}

export async function updateAdminDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    id: string;
    title?: string | undefined;
    code?: string | null | undefined;
    type?: "percent" | "fixed" | "free_shipping" | "buy_x_get_y" | undefined;
    value?: number | undefined;
    appliesTo?: DiscountAppliesTo | undefined;
    rules?: DiscountRules | undefined;
    minSubtotal?: number | undefined;
    perCustomerLimit?: number | null | undefined;
    combinable?: boolean | undefined;
    showOnStorefront?: boolean | undefined;
    startsAt?: string | null | undefined;
    endsAt?: string | null | undefined;
    status?: "active" | "scheduled" | "expired" | "disabled" | "archived" | undefined;
    usageLimit?: number | null | undefined;
  },
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const { id, ...changes } = input;
    if (input.type !== undefined || input.value !== undefined || input.appliesTo !== undefined || input.rules !== undefined) {
      // The rules are checked on the discount as it will be after the change.
      const [current] = await tx.select().from(schema.discounts).where(and(eq(schema.discounts.tenantId, ctx.tenantId), eq(schema.discounts.id, id))).limit(1);
      if (!current) throw new Error(`Discount not found: ${id}`);
      await assertDiscountSetup(tx, ctx, {
        type: input.type ?? current.type,
        value: input.value ?? current.value,
        appliesTo: input.appliesTo ?? parseDiscountAppliesTo(current.appliesTo) ?? { type: "all" },
        rules: input.rules ?? parseDiscountRules(current.rules),
      });
    }
    const [updated] = await tx
      .update(schema.discounts)
      .set({
        ...(input.title ? { title: input.title } : {}),
        ...(input.code !== undefined ? { code: input.code ? input.code.toUpperCase() : null } : {}),
        ...(input.type ? { type: input.type } : {}),
        ...(input.value !== undefined ? { value: input.value } : {}),
        ...(input.appliesTo !== undefined ? { appliesTo: input.appliesTo } : {}),
        ...(input.rules !== undefined ? { rules: input.rules } : {}),
        ...(input.minSubtotal !== undefined ? { minSubtotal: input.minSubtotal } : {}),
        ...(input.perCustomerLimit !== undefined ? { perCustomerLimit: input.perCustomerLimit } : {}),
        ...(input.combinable !== undefined ? { combinable: input.combinable } : {}),
        ...(input.showOnStorefront !== undefined ? { showOnStorefront: input.showOnStorefront } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.discounts.tenantId, ctx.tenantId), eq(schema.discounts.id, id)))
      .returning();

    if (!updated) {
      throw new Error(`Discount not found: ${input.id}`);
    }

    await auditDiscount(tx, ctx, input.status === "archived" ? "discount.archive" : "discount.update", updated.id, changes);

    return {
      id: updated.id,
      status: updated.status,
    };
  });
}

/**
 * Deletes a discount. One that has been redeemed on an order is archived instead, so order history keeps pointing at it.
 */
export async function deleteAdminDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [used] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.discountRedemptions)
      .where(and(eq(schema.discountRedemptions.tenantId, ctx.tenantId), eq(schema.discountRedemptions.discountId, input.id)));
    if ((used?.n ?? 0) > 0) {
      await tx
        .update(schema.discounts)
        .set({ status: "archived", updatedAt: new Date() })
        .where(and(eq(schema.discounts.tenantId, ctx.tenantId), eq(schema.discounts.id, input.id)));
      await auditDiscount(tx, ctx, "discount.archive", input.id, { reason: "used on orders, archived instead of deleted" });
      return { success: true, archived: true };
    }
    await tx.delete(schema.discounts).where(and(eq(schema.discounts.tenantId, ctx.tenantId), eq(schema.discounts.id, input.id)));
    await auditDiscount(tx, ctx, "discount.delete", input.id, {});
    return { success: true, archived: false };
  });
}
