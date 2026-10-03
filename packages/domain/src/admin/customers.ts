import { and, asc, desc, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { customerMetricsSql } from "../customers/metrics.ts";

export interface ListCustomersInput {
  search?: string | undefined;
  tag?: string | undefined;
  /** Customers with more than one order. */
  repeat?: boolean | undefined;
  /** Tab: every customer, accounts only (not guests), guests only, blocked only. */
  view?: "all" | "accounts" | "guests" | "blocked" | undefined;
  /** The Phase 0 single consent record. */
  marketingState?: "subscribed" | "unsubscribed" | "not_subscribed" | "invalid" | undefined;
  /** Pre-Phase-1 filter kept for compatibility; new callers pass marketingState. */
  acceptsMarketing?: boolean | undefined;
  /** State code of one of the customer's addresses. */
  location?: string | undefined;
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
    // Deleted (anonymised) customers stay out of the list; their orders still render.
    const conditions = [isNull(schema.customers.deletedAt)];

    if (input.view === "accounts") conditions.push(eq(schema.customers.isGuest, false));
    if (input.view === "guests") conditions.push(eq(schema.customers.isGuest, true));
    if (input.view === "blocked") conditions.push(eq(schema.customers.status, "blocked"));

    if (input.tag) {
      conditions.push(sql`${input.tag} = ANY(${schema.customers.tags})`);
    }

    if (input.repeat) conditions.push(sql`metrics.orders_count > 1`);
    if (input.marketingState) conditions.push(eq(schema.customers.marketingState, input.marketingState));
    if (input.acceptsMarketing !== undefined) conditions.push(eq(schema.customers.acceptsMarketing, input.acceptsMarketing));
    if (input.location) {
      conditions.push(
        sql`EXISTS (SELECT 1 FROM ${schema.customerAddresses} a
          WHERE a.tenant_id = ${ctx.tenantId} AND a.customer_id = ${schema.customers.id} AND a.state_code = ${input.location})`,
      );
    }
    const from = input.createdFrom ? new Date(input.createdFrom) : null;
    const to = input.createdTo ? new Date(input.createdTo) : null;
    if (from && !Number.isNaN(from.getTime())) conditions.push(gte(schema.customers.createdAt, from));
    if (to && !Number.isNaN(to.getTime())) conditions.push(lt(schema.customers.createdAt, to));

    if (input.search) {
      conditions.push(
        sql`(${schema.customers.name} ILIKE ${`%${input.search}%`} OR ${schema.customers.email} ILIKE ${`%${input.search}%`} OR ${schema.customers.phone} ILIKE ${`%${input.search}%`})`,
      );
    }

    const whereClause = and(...conditions);

    const orderBy = {
      created_desc: [desc(schema.customers.createdAt), desc(schema.customers.id)],
      created_asc: [asc(schema.customers.createdAt), asc(schema.customers.id)],
      name_asc: [asc(schema.customers.name), asc(schema.customers.id)],
      name_desc: [desc(schema.customers.name), desc(schema.customers.id)],
      spent_desc: [desc(sql`metrics.total_spent`), desc(schema.customers.id)],
      spent_asc: [asc(sql`metrics.total_spent`), asc(schema.customers.id)],
      orders_desc: [desc(sql`metrics.orders_count`), desc(schema.customers.id)],
      orders_asc: [asc(sql`metrics.orders_count`), asc(schema.customers.id)],
    }[input.sort ?? "created_desc"];

    const [countResult] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`${schema.customers.id} = metrics.customer_id`)
      .where(whereClause);

    const rows = await tx
      .select({
        id: schema.customers.id,
        name: schema.customers.name,
        email: schema.customers.email,
        phone: schema.customers.phone,
        isGuest: schema.customers.isGuest,
        status: schema.customers.status,
        marketingState: schema.customers.marketingState,
        marketingUpdatedAt: schema.customers.marketingUpdatedAt,
        ordersCount: sql<number>`metrics.orders_count`,
        totalSpent: sql<number>`metrics.total_spent`,
        lastOrderAt: sql<Date | null>`metrics.last_order_at`,
        tags: schema.customers.tags,
        createdAt: schema.customers.createdAt,
      })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`${schema.customers.id} = metrics.customer_id`)
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
        isGuest: r.isGuest,
        status: r.status,
        marketingState: r.marketingState,
        marketingUpdatedAt: r.marketingUpdatedAt ? r.marketingUpdatedAt.toISOString() : null,
        ordersCount: Number(r.ordersCount || 0),
        totalSpent: Number(r.totalSpent || 0),
        lastOrderAt: r.lastOrderAt ? new Date(r.lastOrderAt).toISOString() : null,
        tags: r.tags,
        createdAt: r.createdAt.toISOString(),
      })),
      total: countResult?.count ?? 0,
    };
  });
}

/**
 * Counts for the list page's stat strip. Everything comes from the Phase 0 metrics
 * fragment (real-time from orders), never from the cached sorting columns.
 */
export async function getAdminCustomerStats(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [row] = await tx
      .select({
        total: sql<number>`count(*)::int`,
        newThisMonth: sql<number>`count(*) FILTER (WHERE ${schema.customers.createdAt} >= date_trunc('month', now()))::int`,
        repeat: sql<number>`count(*) FILTER (WHERE metrics.orders_count > 1)::int`,
        subscribers: sql<number>`count(*) FILTER (WHERE ${schema.customers.marketingState} = 'subscribed')::int`,
        totalSpend: sql<number>`COALESCE(SUM(metrics.total_spent), 0)::bigint`,
        averageOrderValue: sql<number>`COALESCE(SUM(metrics.total_spent) / NULLIF(SUM(metrics.orders_count), 0), 0)::bigint`,
      })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`${schema.customers.id} = metrics.customer_id`)
      .where(isNull(schema.customers.deletedAt));

    return {
      total: row?.total ?? 0,
      newThisMonth: row?.newThisMonth ?? 0,
      repeat: row?.repeat ?? 0,
      subscribers: row?.subscribers ?? 0,
      totalSpend: Number(row?.totalSpend || 0),
      averageOrderValue: Number(row?.averageOrderValue || 0),
    };
  });
}

/** Store-wide filter options: every distinct tag and address state in the store, not just those on the current page. */
export async function listAdminCustomerTags(rt: Runtime, ctx: TenantContext) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const tagRows = await tx.execute<{ tag: string }>(sql`
      SELECT DISTINCT tag FROM (
        SELECT unnest(${schema.customers.tags}) AS tag
        FROM ${schema.customers}
        WHERE ${schema.customers.tenantId} = ${ctx.tenantId} AND ${schema.customers.deletedAt} IS NULL
      ) t
      WHERE tag <> ''
      ORDER BY tag
      LIMIT 200
    `);
    const stateRows = await tx.execute<{ state_code: string }>(sql`
      SELECT DISTINCT a.state_code
      FROM ${schema.customerAddresses} a
      WHERE a.tenant_id = ${ctx.tenantId}
      ORDER BY a.state_code
      LIMIT 100
    `);
    return { tags: tagRows.rows.map((r) => r.tag), locationStates: stateRows.rows.map((r) => r.state_code) };
  });
}

export interface SetCustomerStatusInput {
  id: string;
  status: "active" | "blocked";
}

export async function setAdminCustomerStatus(rt: Runtime, ctx: TenantContext, input: SetCustomerStatusInput) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.customers.id, status: schema.customers.status })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)))
      .limit(1);

    if (!existing) {
      throw new Error(`Customer not found: ${input.id}`);
    }

    if (existing.status !== input.status) {
      await tx
        .update(schema.customers)
        .set({ status: input.status, updatedAt: new Date() })
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)));

      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "customer.status_changed",
        targetType: "customer",
        targetId: input.id,
        diff: { from: existing.status, to: input.status },
      });
    }

    return { id: input.id, status: input.status };
  });
}

export interface SetCustomerTagsInput {
  id: string;
  tags: string[];
}

export async function setAdminCustomerTags(rt: Runtime, ctx: TenantContext, input: SetCustomerTagsInput) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const tags = [...new Set(input.tags.map((t) => t.trim()).filter(Boolean))];

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.customers.id, tags: schema.customers.tags })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)))
      .limit(1);

    if (!existing) {
      throw new Error(`Customer not found: ${input.id}`);
    }

    const previous = existing.tags;
    const changed =
      previous.length !== tags.length ||
      [...previous].sort().join("\n") !== [...tags].sort().join("\n");

    if (changed) {
      await tx
        .update(schema.customers)
        .set({ tags, updatedAt: new Date() })
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)));

      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "customer.tags_changed",
        targetType: "customer",
        targetId: input.id,
        diff: {
          added: tags.filter((t) => !previous.includes(t)),
          removed: previous.filter((t) => !tags.includes(t)),
        },
      });
    }

    return { id: input.id, tags };
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
    const [row] = await tx
      .select({
        customer: schema.customers,
        ordersCount: sql<number>`metrics.orders_count`,
        totalSpent: sql<number>`metrics.total_spent`,
      })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`${schema.customers.id} = metrics.customer_id`)
      .where(eq(schema.customers.id, input.id))
      .limit(1);

    if (!row || !row.customer) {
      throw new Error(`Customer not found: ${input.id}`);
    }
    const customer = row.customer;

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
        ordersCount: Number(row.ordersCount || 0),
        totalSpent: Number(row.totalSpent || 0),
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

export interface CreateCustomerInput {
  name: string;
  email: string;
  phone?: string | undefined;
  tags?: string[] | undefined;
  note?: string | undefined;
  address?: {
    line1: string;
    line2?: string | undefined;
    city: string;
    stateCode: string;
    pincode: string;
    phone?: string | undefined;
    name?: string | undefined;
  } | undefined;
}

export async function createAdminCustomer(
  rt: Runtime,
  ctx: TenantContext,
  input: CreateCustomerInput,
) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;

  const email = input.email.trim().toLowerCase();
  const phone = input.phone?.trim() || null;
  const name = input.name.trim();

  return await withTenant(db, ctx.tenantId, async (tx) => {
    // Check email uniqueness
    const [existingEmail] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.email, email)))
      .limit(1);

    if (existingEmail) {
      throw new Error(`A customer with email ${email} already exists`);
    }

    if (phone) {
      const [existingPhone] = await tx
        .select({ id: schema.customers.id })
        .from(schema.customers)
        .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.phone, phone)))
        .limit(1);

      if (existingPhone) {
        throw new Error(`A customer with phone number ${phone} already exists`);
      }
    }

    const [customer] = await tx
      .insert(schema.customers)
      .values({
        tenantId: ctx.tenantId,
        name,
        email,
        phone,
        tags: input.tags ?? [],
        note: input.note?.trim() || null,
      })
      .returning();

    if (!customer) {
      throw new Error("Failed to create customer record");
    }

    let addressId: string | undefined;
    if (input.address) {
      const [addr] = await tx
        .insert(schema.customerAddresses)
        .values({
          tenantId: ctx.tenantId,
          customerId: customer.id,
          name: input.address.name || name,
          phone: input.address.phone || phone || "",
          line1: input.address.line1,
          line2: input.address.line2 || null,
          city: input.address.city,
          stateCode: input.address.stateCode,
          pincode: input.address.pincode,
          isDefault: true,
          type: "shipping",
        })
        .returning({ id: schema.customerAddresses.id });
      addressId = addr?.id;
    }

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "customer.created",
      targetType: "customer",
      targetId: customer.id,
      diff: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
      },
    });

    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        tags: customer.tags,
        note: customer.note,
      },
      addressId,
    };
  });
}

