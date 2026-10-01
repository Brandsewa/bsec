import { and, asc, desc, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

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
    minSubtotal?: number | undefined;
    usageLimit?: number | undefined;
    perCustomerLimit?: number | undefined;
    combinable?: boolean | undefined;
    startsAt?: string | undefined;
    endsAt?: string | undefined;
  },
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [created] = await tx
      .insert(schema.discounts)
      .values({
        tenantId: ctx.tenantId,
        code: input.code ? input.code.toUpperCase() : null,
        title: input.title,
        type: input.type,
        value: input.value,
        minSubtotal: input.minSubtotal ?? 0,
        usageLimit: input.usageLimit ?? null,
        perCustomerLimit: input.perCustomerLimit ?? null,
        combinable: input.combinable ?? false,
        startsAt: input.startsAt ? new Date(input.startsAt) : null,
        endsAt: input.endsAt ? new Date(input.endsAt) : null,
        status: "active",
      })
      .returning();

    if (!created) {
      throw new Error("Failed to create discount");
    }

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

export async function updateAdminDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: {
    id: string;
    title?: string | undefined;
    status?: "active" | "scheduled" | "expired" | "disabled" | undefined;
    usageLimit?: number | null | undefined;
  },
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [updated] = await tx
      .update(schema.discounts)
      .set({
        ...(input.title ? { title: input.title } : {}),
        ...(input.status ? { status: input.status } : {}),
        ...(input.usageLimit !== undefined ? { usageLimit: input.usageLimit } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.discounts.id, input.id))
      .returning();

    if (!updated) {
      throw new Error(`Discount not found: ${input.id}`);
    }

    return {
      id: updated.id,
      status: updated.status,
    };
  });
}

export async function deleteAdminDiscount(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "discounts.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    await tx.delete(schema.discounts).where(eq(schema.discounts.id, input.id));
    return { success: true };
  });
}
