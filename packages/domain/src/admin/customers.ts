import { and, asc, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import { customerMetricsSql } from "../customers/metrics.ts";
import { setMarketingConsent, type MarketingConsentState } from "../customers/consent.ts";
import { segmentMembershipSubquery } from "../segments/service.ts";

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
  /** Only customers in this segment (manual members or matching an automatic segment's rules). */
  segmentId?: string | undefined;
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
    if (input.segmentId) {
      conditions.push(sql`${schema.customers.id} IN ${await segmentMembershipSubquery(tx, ctx.tenantId, input.segmentId)}`);
    }
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
        averageOrderValue: sql<number>`metrics.average_order_value`,
        firstOrderAt: sql<Date | null>`metrics.first_order_at`,
        lastOrderAt: sql<Date | null>`metrics.last_order_at`,
        returnsCount: sql<number>`metrics.returns_count`,
      })
      .from(schema.customers)
      .leftJoin(customerMetricsSql(ctx.tenantId), sql`${schema.customers.id} = metrics.customer_id`)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)))
      .limit(1);

    if (!row || !row.customer) {
      throw new Error(`Customer not found: ${input.id}`);
    }
    const customer = row.customer;

    const addresses = await tx
      .select()
      .from(schema.customerAddresses)
      .where(and(eq(schema.customerAddresses.tenantId, ctx.tenantId), eq(schema.customerAddresses.customerId, input.id)))
      .orderBy(desc(schema.customerAddresses.isDefault), desc(schema.customerAddresses.createdAt));

    const consentHistory = await tx
      .select({
        id: schema.customerConsentEvents.id,
        channel: schema.customerConsentEvents.channel,
        state: schema.customerConsentEvents.state,
        source: schema.customerConsentEvents.source,
        actorType: schema.customerConsentEvents.actorType,
        at: schema.customerConsentEvents.at,
      })
      .from(schema.customerConsentEvents)
      .where(and(eq(schema.customerConsentEvents.tenantId, ctx.tenantId), eq(schema.customerConsentEvents.customerId, input.id)))
      .orderBy(desc(schema.customerConsentEvents.at))
      .limit(20);

    const recentOrders = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        fulfillmentStatus: schema.orders.fulfillmentStatus,
        grandTotal: schema.orders.grandTotal,
        placedAt: schema.orders.placedAt,
      })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.customerId, input.id)))
      .orderBy(desc(schema.orders.placedAt))
      .limit(20);

    const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null);
    return {
      customer: {
        id: customer.id,
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        emailVerified: customer.emailVerified,
        isGuest: customer.isGuest,
        status: customer.status,
        ordersCount: Number(row.ordersCount || 0),
        totalSpent: Number(row.totalSpent || 0),
        averageOrderValue: Number(row.averageOrderValue || 0),
        firstOrderAt: iso(row.firstOrderAt ? new Date(row.firstOrderAt) : null),
        lastOrderAt: iso(row.lastOrderAt ? new Date(row.lastOrderAt) : null),
        returnsCount: Number(row.returnsCount || 0),
        marketingState: customer.marketingState,
        marketingSource: customer.marketingSource,
        marketingUpdatedAt: iso(customer.marketingUpdatedAt),
        tags: customer.tags,
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
      consentHistory: consentHistory.map((e) => ({
        id: e.id,
        channel: e.channel,
        state: e.state,
        source: e.source,
        actorType: e.actorType,
        at: e.at.toISOString(),
      })),
      recentOrders: recentOrders.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        grandTotal: Number(o.grandTotal),
        placedAt: o.placedAt.toISOString(),
      })),
    };
  });
}

export interface UpdateCustomerInput {
  id: string;
  name?: string | undefined;
  email?: string | undefined;
  phone?: string | null | undefined;
}

export interface UpdateCustomerResult {
  id: string;
  name: string;
  email: string;
  phone: string | null;
  emailVerified: boolean;
}

/**
 * Edits the customer profile. The email is editable only for a guest or an unverified account
 * (a verified account changes it from their own account page); a change clears email_verified
 * so the new address must be re-verified before it earns account features.
 */
export async function updateAdminCustomer(rt: Runtime, ctx: TenantContext, input: UpdateCustomerInput): Promise<UpdateCustomerResult> {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select()
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)))
      .limit(1);
    if (!existing) throw new Error(`Customer not found: ${input.id}`);

    const updates: Record<string, unknown> = { updatedAt: new Date() };
    const diff: Record<string, unknown> = {};
    let emailVerified = existing.emailVerified;

    if (input.name !== undefined) {
      const name = input.name.trim();
      if (name !== existing.name) {
        updates.name = name;
        diff.name = { from: existing.name, to: name };
      }
    }

    if (input.email !== undefined) {
      const email = input.email.trim().toLowerCase();
      if (email !== existing.email) {
        if (existing.emailVerified && !existing.isGuest) {
          throw new Error("This account's email is verified. The customer can change it from their account page.");
        }
        const [taken] = await tx
          .select({ id: schema.customers.id })
          .from(schema.customers)
          .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.email, email), ne(schema.customers.id, input.id)))
          .limit(1);
        if (taken) throw new Error(`A customer with email ${email} already exists`);
        updates.email = email;
        updates.emailVerified = false;
        emailVerified = false;
        diff.email = { from: existing.email, to: email, verificationReset: true };
      }
    }

    if (input.phone !== undefined) {
      const phone = input.phone === null || input.phone.trim() === "" ? null : input.phone.trim();
      if (phone !== existing.phone) {
        if (phone) {
          const [taken] = await tx
            .select({ id: schema.customers.id })
            .from(schema.customers)
            .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.phone, phone), ne(schema.customers.id, input.id)))
            .limit(1);
          if (taken) throw new Error(`A customer with phone number ${phone} already exists`);
        }
        updates.phone = phone;
        diff.phone = { from: existing.phone, to: phone };
      }
    }

    if (Object.keys(diff).length === 0) {
      return { id: existing.id, name: existing.name, email: existing.email, phone: existing.phone, emailVerified: existing.emailVerified };
    }

    await tx.update(schema.customers).set(updates).where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)));

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "customer.updated",
      targetType: "customer",
      targetId: input.id,
      diff,
    });

    return {
      id: input.id,
      name: (updates.name as string | undefined) ?? existing.name,
      email: (updates.email as string | undefined) ?? existing.email,
      phone: updates.phone !== undefined ? (updates.phone as string | null) : existing.phone,
      emailVerified,
    };
  });
}

/** Admin switch on the marketing card: routed through the single consent writer (source `admin`). */
export async function setAdminCustomerConsent(rt: Runtime, ctx: TenantContext, input: { id: string; state: MarketingConsentState }) {
  assertPermission(ctx, "customers.write");
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;
  const result = await setMarketingConsent(rt, ctx, {
    customerId: input.id,
    state: input.state,
    source: "admin",
    actorType: "staff",
    actorId,
  });
  return { id: result.customerId, marketingState: result.marketingState, acceptsMarketing: result.acceptsMarketing };
}

export interface AdminAddressInput {
  name: string;
  phone: string;
  line1: string;
  line2?: string | undefined;
  city: string;
  stateCode: string;
  pincode: string;
  type?: string | undefined;
  isDefault?: boolean | undefined;
}

export async function addAdminCustomerAddress(rt: Runtime, ctx: TenantContext, input: { customerId: string; address: AdminAddressInput }) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [customer] = await tx
      .select({ id: schema.customers.id })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.customerId)))
      .limit(1);
    if (!customer) throw new Error(`Customer not found: ${input.customerId}`);

    if (input.address.isDefault) {
      await tx
        .update(schema.customerAddresses)
        .set({ isDefault: false })
        .where(and(eq(schema.customerAddresses.tenantId, ctx.tenantId), eq(schema.customerAddresses.customerId, input.customerId)));
    }

    const [row] = await tx
      .insert(schema.customerAddresses)
      .values({
        tenantId: ctx.tenantId,
        customerId: input.customerId,
        name: input.address.name,
        phone: input.address.phone,
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        city: input.address.city,
        stateCode: input.address.stateCode,
        pincode: input.address.pincode,
        type: input.address.type ?? "home",
        isDefault: input.address.isDefault ?? false,
      })
      .returning({ id: schema.customerAddresses.id });
    if (!row) throw new Error("Failed to create customer address");

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "customer.address_added",
      targetType: "customer",
      targetId: input.customerId,
      diff: { addressId: row.id },
    });

    return { id: row.id };
  });
}

export async function updateAdminCustomerAddress(rt: Runtime, ctx: TenantContext, input: { customerId: string; addressId: string; address: AdminAddressInput }) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const owned = and(
      eq(schema.customerAddresses.tenantId, ctx.tenantId),
      eq(schema.customerAddresses.customerId, input.customerId),
      eq(schema.customerAddresses.id, input.addressId),
    );
    const [existing] = await tx.select({ id: schema.customerAddresses.id }).from(schema.customerAddresses).where(owned).limit(1);
    if (!existing) throw new Error(`Address not found: ${input.addressId}`);

    if (input.address.isDefault) {
      await tx
        .update(schema.customerAddresses)
        .set({ isDefault: false })
        .where(and(eq(schema.customerAddresses.tenantId, ctx.tenantId), eq(schema.customerAddresses.customerId, input.customerId)));
    }

    await tx
      .update(schema.customerAddresses)
      .set({
        name: input.address.name,
        phone: input.address.phone,
        line1: input.address.line1,
        line2: input.address.line2 ?? null,
        city: input.address.city,
        stateCode: input.address.stateCode,
        pincode: input.address.pincode,
        type: input.address.type ?? "home",
        ...(input.address.isDefault !== undefined ? { isDefault: input.address.isDefault } : {}),
        updatedAt: new Date(),
      })
      .where(owned);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "customer.address_updated",
      targetType: "customer",
      targetId: input.customerId,
      diff: { addressId: input.addressId },
    });

    return { success: true };
  });
}

export async function deleteAdminCustomerAddress(rt: Runtime, ctx: TenantContext, input: { customerId: string; addressId: string }) {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [deleted] = await tx
      .delete(schema.customerAddresses)
      .where(
        and(
          eq(schema.customerAddresses.tenantId, ctx.tenantId),
          eq(schema.customerAddresses.customerId, input.customerId),
          eq(schema.customerAddresses.id, input.addressId),
        ),
      )
      .returning({ id: schema.customerAddresses.id });
    if (!deleted) throw new Error(`Address not found: ${input.addressId}`);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "customer.address_deleted",
      targetType: "customer",
      targetId: input.customerId,
      diff: { addressId: input.addressId },
    });

    return { success: true };
  });
}

/** Full order history for the detail page's orders card, optionally filtered by status. */
export async function listAdminCustomerOrders(
  rt: Runtime,
  ctx: TenantContext,
  input: { customerId: string; status?: string | undefined; limit?: number | undefined; offset?: number | undefined },
) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const limit = input.limit ?? 20;
  const offset = input.offset ?? 0;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const conditions = [eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.customerId, input.customerId)];
    if (input.status) conditions.push(eq(schema.orders.status, input.status));
    const where = and(...conditions);

    const [countRow] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.orders).where(where);
    const rows = await tx
      .select({
        id: schema.orders.id,
        number: schema.orders.number,
        status: schema.orders.status,
        paymentStatus: schema.orders.paymentStatus,
        fulfillmentStatus: schema.orders.fulfillmentStatus,
        grandTotal: schema.orders.grandTotal,
        placedAt: schema.orders.placedAt,
      })
      .from(schema.orders)
      .where(where)
      .orderBy(desc(schema.orders.placedAt), desc(schema.orders.id))
      .limit(limit)
      .offset(offset);

    return {
      items: rows.map((o) => ({
        id: o.id,
        number: o.number,
        status: o.status,
        paymentStatus: o.paymentStatus,
        fulfillmentStatus: o.fulfillmentStatus,
        grandTotal: Number(o.grandTotal),
        placedAt: o.placedAt.toISOString(),
      })),
      total: countRow?.count ?? 0,
    };
  });
}

export interface ActivityItem {
  kind: "order" | "return" | "quote" | "review" | "abandoned_cart" | "consent";
  at: string;
  title: string;
  detail: string | null;
  ref: string | null;
}

/** Timeline for the detail page, assembled from existing tables only (no new tables). */
export async function getAdminCustomerActivity(rt: Runtime, ctx: TenantContext, input: { customerId: string; limit?: number | undefined }) {
  assertPermission(ctx, "customers.read");
  const db = rt._db.db;
  const limit = input.limit ?? 50;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const items: ActivityItem[] = [];

    const orders = await tx
      .select({ id: schema.orders.id, number: schema.orders.number, status: schema.orders.status, grandTotal: schema.orders.grandTotal, placedAt: schema.orders.placedAt })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.customerId, input.customerId)))
      .orderBy(desc(schema.orders.placedAt))
      .limit(limit);
    for (const o of orders) {
      items.push({ kind: "order", at: o.placedAt.toISOString(), title: `Order ${o.number}`, detail: `${o.status} · ₹${(Number(o.grandTotal) / 100).toFixed(2)}`, ref: o.id });
    }

    const returnsRows = await tx
      .select({ id: schema.returns.id, status: schema.returns.status, createdAt: schema.returns.createdAt })
      .from(schema.returns)
      .where(and(eq(schema.returns.tenantId, ctx.tenantId), eq(schema.returns.customerId, input.customerId)))
      .orderBy(desc(schema.returns.createdAt))
      .limit(limit);
    for (const r of returnsRows) {
      items.push({ kind: "return", at: r.createdAt.toISOString(), title: "Return requested", detail: r.status, ref: r.id });
    }

    const quotes = await tx
      .select({ id: schema.quoteRequests.id, number: schema.quoteRequests.number, status: schema.quoteRequests.status, createdAt: schema.quoteRequests.createdAt })
      .from(schema.quoteRequests)
      .where(and(eq(schema.quoteRequests.tenantId, ctx.tenantId), eq(schema.quoteRequests.customerId, input.customerId)))
      .orderBy(desc(schema.quoteRequests.createdAt))
      .limit(limit);
    for (const q of quotes) {
      items.push({ kind: "quote", at: q.createdAt.toISOString(), title: `Quote ${q.number}`, detail: q.status, ref: q.id });
    }

    const reviewsRows = await tx
      .select({ id: schema.reviews.id, rating: schema.reviews.rating, status: schema.reviews.status, createdAt: schema.reviews.createdAt })
      .from(schema.reviews)
      .where(and(eq(schema.reviews.tenantId, ctx.tenantId), eq(schema.reviews.customerId, input.customerId)))
      .orderBy(desc(schema.reviews.createdAt))
      .limit(limit);
    for (const r of reviewsRows) {
      items.push({ kind: "review", at: r.createdAt.toISOString(), title: `Review: ${r.rating}★`, detail: r.status, ref: r.id });
    }

    const cartsRows = await tx
      .select({ id: schema.carts.id, status: schema.carts.status, createdAt: schema.carts.createdAt })
      .from(schema.carts)
      .where(and(eq(schema.carts.tenantId, ctx.tenantId), eq(schema.carts.customerId, input.customerId), eq(schema.carts.status, "abandoned")))
      .orderBy(desc(schema.carts.createdAt))
      .limit(limit);
    for (const c of cartsRows) {
      items.push({ kind: "abandoned_cart", at: c.createdAt.toISOString(), title: "Abandoned checkout", detail: null, ref: c.id });
    }

    const consent = await tx
      .select({ id: schema.customerConsentEvents.id, state: schema.customerConsentEvents.state, source: schema.customerConsentEvents.source, at: schema.customerConsentEvents.at })
      .from(schema.customerConsentEvents)
      .where(and(eq(schema.customerConsentEvents.tenantId, ctx.tenantId), eq(schema.customerConsentEvents.customerId, input.customerId)))
      .orderBy(desc(schema.customerConsentEvents.at))
      .limit(limit);
    for (const e of consent) {
      items.push({ kind: "consent", at: e.at.toISOString(), title: `Marketing ${e.state.replace("_", " ")}`, detail: e.source, ref: e.id });
    }

    items.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
    return { items: items.slice(0, limit) };
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


export interface DeleteCustomerResult {
  /** "deleted" when the customer had no orders; "anonymised" when orders were kept. */
  mode: "deleted" | "anonymised";
  id: string;
}

/**
 * Delete a customer (Customers Phase 1, step 1C; the DPDP erasure path).
 * With orders: anonymise — identity replaced with a placeholder, consent unsubscribed,
 * sessions destroyed, addresses/notes/wishlist removed, `deleted_at` set, orders kept for
 * accounts and tax. Without orders: the row is hard-deleted (children cascade).
 */
export async function deleteAdminCustomer(rt: Runtime, ctx: TenantContext, input: { id: string }): Promise<DeleteCustomerResult> {
  assertPermission(ctx, "customers.write");
  const db = rt._db.db;
  const actorId = ctx.actor.type === "staff" ? ctx.actor.userId : null;

  return await withTenant(db, ctx.tenantId, async (tx) => {
    const [existing] = await tx
      .select({ id: schema.customers.id, email: schema.customers.email, name: schema.customers.name })
      .from(schema.customers)
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)))
      .limit(1);
    if (!existing) throw new Error(`Customer not found: ${input.id}`);

    const [orderCount] = await tx
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.orders)
      .where(and(eq(schema.orders.tenantId, ctx.tenantId), eq(schema.orders.customerId, input.id)));
    const hasOrders = (orderCount?.count ?? 0) > 0;

    if (!hasOrders) {
      await tx.delete(schema.customerSessions).where(and(eq(schema.customerSessions.tenantId, ctx.tenantId), eq(schema.customerSessions.userId, input.id)));
      await tx.delete(schema.customers).where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)));
      await tx.insert(schema.auditLogs).values({
        tenantId: ctx.tenantId,
        actorType: ctx.actor.type,
        actorId,
        action: "customer.deleted",
        targetType: "customer",
        targetId: input.id,
        diff: { mode: "deleted", email: existing.email },
      });
      return { mode: "deleted", id: input.id };
    }

    const shortId = input.id.replaceAll("-", "").slice(0, 8);
    await tx.delete(schema.customerAddresses).where(and(eq(schema.customerAddresses.tenantId, ctx.tenantId), eq(schema.customerAddresses.customerId, input.id)));
    await tx.delete(schema.customerNotes).where(and(eq(schema.customerNotes.tenantId, ctx.tenantId), eq(schema.customerNotes.customerId, input.id)));
    await tx.delete(schema.wishlistItems).where(and(eq(schema.wishlistItems.tenantId, ctx.tenantId), eq(schema.wishlistItems.customerId, input.id)));
    await tx.delete(schema.customerSessions).where(and(eq(schema.customerSessions.tenantId, ctx.tenantId), eq(schema.customerSessions.userId, input.id)));
    await tx
      .update(schema.customers)
      .set({
        name: "Deleted customer",
        email: `deleted-${shortId}@invalid`,
        phone: null,
        passwordHash: null,
        emailVerified: false,
        phoneVerified: false,
        isGuest: true,
        tags: [],
        note: null,
        deletedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(schema.customers.tenantId, ctx.tenantId), eq(schema.customers.id, input.id)));

    // Consent goes through the single writer so the history records the erasure (source: admin).
    await setMarketingConsent(rt, ctx, { customerId: input.id, state: "unsubscribed", source: "admin", actorType: "staff", actorId }, tx);

    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId,
      action: "customer.deleted",
      targetType: "customer",
      targetId: input.id,
      diff: { mode: "anonymised", email: existing.email },
    });
    return { mode: "anonymised", id: input.id };
  });
}
