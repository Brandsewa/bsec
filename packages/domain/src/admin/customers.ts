import { and, asc, desc, eq, gte, lt, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";

export interface ListCustomersInput {
  search?: string | undefined;
  tag?: string | undefined;
  repeat?: boolean | undefined;
  acceptsMarketing?: boolean | undefined;
  createdFrom?: string | undefined;
  createdTo?: string | undefined;
  sort?: "created_desc" | "created_asc" | "name_asc" | "name_desc" | "spent_desc" | "spent_asc" | "orders_desc" | "orders_asc" | undefined;
  limit?: number | undefined;
  offset?: number | undefined;
}

export async function listAdminCustomers(
  rt: Runtime,
  ctx: TenantContext,
  input: ListCustomersInput = {},
) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const limit = input.limit ?? 50;
  const offset = input.offset ?? 0;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [];

    if (input.tag) {
      conditions.push(sql`${input.tag} = ANY(${schema.customers.tags})`);
    }

    if (input.repeat) conditions.push(sql`${schema.customers.ordersCount} > 1`);
    if (input.acceptsMarketing !== undefined) conditions.push(eq(schema.customers.acceptsMarketing, input.acceptsMarketing));
    const from = input.createdFrom ? new Date(input.createdFrom) : null;
    const to = input.createdTo ? new Date(input.createdTo) : null;
    if (from && !Number.isNaN(from.getTime())) conditions.push(gte(schema.customers.createdAt, from));
    if (to && !Number.isNaN(to.getTime())) conditions.push(lt(schema.customers.createdAt, to));

    if (input.search) {
      conditions.push(
        sql`(${schema.customers.name} ILIKE ${`%${input.search}%`} OR ${schema.customers.email} ILIKE ${`%${input.search}%`} OR ${schema.customers.phone} ILIKE ${`%${input.search}%`})`,
      );
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const orderBy = {
      created_desc: [desc(schema.customers.createdAt), desc(schema.customers.id)],
      created_asc: [asc(schema.customers.createdAt), asc(schema.customers.id)],
      name_asc: [asc(schema.customers.name), asc(schema.customers.id)],
      name_desc: [desc(schema.customers.name), desc(schema.customers.id)],
      spent_desc: [desc(schema.customers.totalSpent), desc(schema.customers.id)],
      spent_asc: [asc(schema.customers.totalSpent), asc(schema.customers.id)],
      orders_desc: [desc(schema.customers.ordersCount), desc(schema.customers.id)],
      orders_asc: [asc(schema.customers.ordersCount), asc(schema.customers.id)],
    }[input.sort ?? "created_desc"];

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customers)
      .where(whereClause);

    const rows = await tx
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        ordersCount: schema.customers.ordersCount,
        totalSpent: schema.customers.totalSpent,
        tags: schema.customers.tags,
        status: schema.customers.status,
        createdAt: schema.customers.createdAt,
      })
      .from(schema.customers)
      .where(whereClause)
      .orderBy(...orderBy)
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        email: r.email,
        phone: r.phone,
        ordersCount: r.ordersCount,
        totalSpent: Number(r.totalSpent),
        tags: r.tags,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      total: countResult?.count ?? 0,
    };
  });
}

export async function getAdminCustomerDetail(
  rt: Runtime,
  ctx: TenantContext,
  input: { id: string },
) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [customer] = await tx
      .select()
      .from(schema.customers)
      .where(eq(schema.customers.id, input.id))
      .limit(1);

    if (!customer) {
      throw new Error(`Customer not found: ${input.id}`);
    }

    const addresses = await tx
      .select()
      .from(schema.customerAddresses)
      .where(eq(schema.customerAddresses.customerId, input.id));

    const recentOrders = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        status: schema.orders.status,
        grandTotal: schema.orders.grandTotal,
        placedAt: schema.orders.placedAt,
      })
      .from(schema.orders)
      .where(eq(schema.orders.customerId, input.id))
      .orderBy(desc(schema.orders.placedAt))
      .limit(10);

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        ordersCount: customer.ordersCount,
        totalSpent: Number(customer.totalSpent),
        tags: customer.tags,
        note: customer.note,
        acceptsMarketing: customer.acceptsMarketing,
        createdAt: customer.createdAt.toISOString(),
      },
      addresses: addresses.map((a) => ({
        id: a.id,
        name: a.name,
        phone: a.phone,
        line1: a.line1,
        line2: a.line2,
        city: a.city,
        stateCode: a.stateCode,
        pincode: a.pincode,
        type: a.type,
        isDefault: a.isDefault,
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        grandTotal: Number(o.grandTotal),
        placedAt: o.placedAt.toISOString(),
      })),
    };
  });
}
