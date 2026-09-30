import { and, desc, eq, gt, gte, inArray, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "./runtime.ts";
import { assertCanTransitionTenant } from "./system/tenant-lifecycle.ts";

export interface AuditMeta {
  ip?: string;
  userAgent?: string;
  requestId?: string;
}

export interface PlatformTenantRecord {
  id: string;
  slug: string;
  name: string;
  status: string;
  planId?: string | null;
  ownerEmail?: string | null;
  trialEndsAt?: string | null;
  suspendedReason?: string | null;
  archivedAt?: string | null;
  createdAt?: string | undefined;
}

/**
 * Asserts that the authenticated user is an active platform staff member with verified MFA (PLAN §4, §6).
 * Throws Forbidden error if not found, inactive, or lacking verified MFA.
 */
export async function assertPlatformStaff(
  rt: Runtime,
  userId: string,
): Promise<{ role: string }> {
  const db = rt._db.db;
  const rows = await db
    .select({
      role: schema.platformStaff.role,
      isActive: schema.platformStaff.isActive,
      mfaRequired: schema.platformStaff.mfaRequired,
    })
    .from(schema.platformStaff)
    .where(
      and(
        eq(schema.platformStaff.userId, userId),
        eq(schema.platformStaff.isActive, true),
      ),
    )
    .limit(1);

  const staff = rows[0];
  if (!staff) {
    throw new Error("Forbidden: user is not an active platform staff member");
  }

  // M9 MFA Enforcement: platform staff MUST have verified MFA (TOTP / backup codes)
  const [user] = await db
    .select({
      twoFactorEnabled: schema.users.twoFactorEnabled,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
    .limit(1);

  if (!user?.twoFactorEnabled) {
    throw new Error("Forbidden: platform staff requires verified MFA (two-factor authentication not enabled)");
  }

  const [twoFactorRecord] = await db
    .select({
      verified: schema.twoFactors.verified,
    })
    .from(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, userId))
    .limit(1);

  if (!twoFactorRecord || twoFactorRecord.verified === false) {
    throw new Error("Forbidden: platform staff requires verified MFA (two-factor authentication not verified)");
  }

  return { role: staff.role };
}

/**
 * Internal helper: writes an audit row in the current transaction.
 */
export async function writePlatformAudit(
  tx: Db,
  actorUserId: string | undefined,
  action: string,
  targetType: string,
  targetId: string,
  tenantId: string | null | undefined,
  diff: unknown,
  meta?: AuditMeta,
) {
  await tx.insert(schema.platformAuditLogs).values({
    actorUserId,
    actorType: "platform_staff",
    action,
    targetType,
    targetId,
    tenantId: tenantId ?? null,
    ip: meta?.ip,
    userAgent: meta?.userAgent,
    requestId: meta?.requestId,
    diff: (diff as Record<string, unknown>) ?? null,
  });
}

/**
 * Lists all tenants across the platform with filtering and search (PLAN §6 Tenants list).
 */
export async function listPlatformTenants(
  rt: Runtime,
  params?: {
    search?: string;
    status?: string;
    planId?: string;
    limit?: number;
    offset?: number;
  },
): Promise<PlatformTenantRecord[]> {
  const db = rt._db.db;
  const rows = await db
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      status: schema.tenants.status,
      planId: schema.tenants.planId,
      ownerEmail: schema.users.email,
      trialEndsAt: schema.tenants.trialEndsAt,
      suspendedReason: schema.tenants.suspendedReason,
      archivedAt: schema.tenants.archivedAt,
      createdAt: schema.tenants.createdAt,
    })
    .from(schema.tenants)
    .leftJoin(schema.users, eq(schema.users.id, schema.tenants.ownerUserId))
    .orderBy(desc(schema.tenants.createdAt));

  let filtered = rows;
  if (params?.status) {
    filtered = filtered.filter((r) => r.status === params.status);
  }
  if (params?.planId) {
    filtered = filtered.filter((r) => r.planId === params.planId);
  }
  if (params?.search) {
    const q = params.search.toLowerCase();
    filtered = filtered.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        (r.ownerEmail && r.ownerEmail.toLowerCase().includes(q)),
    );
  }

  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? 100;

  return filtered.slice(offset, offset + limit).map((r) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    status: r.status,
    planId: r.planId,
    ownerEmail: r.ownerEmail,
    trialEndsAt: r.trialEndsAt ? r.trialEndsAt.toISOString() : null,
    suspendedReason: r.suspendedReason,
    archivedAt: r.archivedAt ? r.archivedAt.toISOString() : null,
    createdAt: r.createdAt ? r.createdAt.toISOString() : undefined,
  }));
}

/**
 * Gets a single tenant by id (PLAN §5.1).
 */
export async function getPlatformTenant(
  rt: Runtime,
  id: string,
): Promise<PlatformTenantRecord> {
  const db = rt._db.db;
  const rows = await db
    .select({
      id: schema.tenants.id,
      slug: schema.tenants.slug,
      name: schema.tenants.name,
      status: schema.tenants.status,
      planId: schema.tenants.planId,
      ownerEmail: schema.users.email,
      trialEndsAt: schema.tenants.trialEndsAt,
      suspendedReason: schema.tenants.suspendedReason,
      archivedAt: schema.tenants.archivedAt,
      createdAt: schema.tenants.createdAt,
    })
    .from(schema.tenants)
    .leftJoin(schema.users, eq(schema.users.id, schema.tenants.ownerUserId))
    .where(eq(schema.tenants.id, id))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error(`Tenant not found: ${id}`);
  }

  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    status: row.status,
    planId: row.planId,
    ownerEmail: row.ownerEmail,
    trialEndsAt: row.trialEndsAt ? row.trialEndsAt.toISOString() : null,
    suspendedReason: row.suspendedReason,
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
    createdAt: row.createdAt ? row.createdAt.toISOString() : undefined,
  };
}

/**
 * Gets full tenant detail across all tabs (PLAN §6 Tenant detail tabs).
 * BYPASSRLS query strictly filtered by tenant_id.
 */
export async function getPlatformTenantDetail(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const [tenant] = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.id, tenantId))
    .limit(1);

  if (!tenant) throw new Error(`Tenant not found: ${tenantId}`);

  // Owner details
  const [owner] = tenant.ownerUserId
    ? await db.select().from(schema.users).where(eq(schema.users.id, tenant.ownerUserId)).limit(1)
    : [null];

  // Domains
  const domainRows = await db
    .select()
    .from(schema.domains)
    .where(eq(schema.domains.tenantId, tenantId));

  // Members (store staff)
  const memberRows = await withTenant(db, tenantId, (tx) =>
    tx
      .select({
        id: schema.memberships.id,
        userId: schema.memberships.userId,
        status: schema.memberships.status,
        roleName: schema.roles.name,
        name: schema.users.name,
        email: schema.users.email,
        createdAt: schema.memberships.createdAt,
      })
      .from(schema.memberships)
      .innerJoin(schema.users, eq(schema.users.id, schema.memberships.userId))
      .innerJoin(
        schema.roles,
        and(eq(schema.roles.id, schema.memberships.roleId), eq(schema.roles.tenantId, tenantId)),
      )
      .where(eq(schema.memberships.tenantId, tenantId)),
  );

  // Billing & subscription
  const [sub] = await db
    .select()
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.tenantId, tenantId))
    .limit(1);

  const invoices = await db
    .select()
    .from(schema.platformInvoices)
    .where(eq(schema.platformInvoices.tenantId, tenantId))
    .orderBy(desc(schema.platformInvoices.issuedAt))
    .limit(20);

  // Usage counters
  const [productsCountRes] = await withTenant(db, tenantId, (tx) =>
    tx.select({ count: sql<number>`count(*)::int` }).from(schema.products).where(eq(schema.products.tenantId, tenantId)),
  );
  const [ordersCountRes] = await withTenant(db, tenantId, (tx) =>
    tx.select({
      count: sql<number>`count(*)::int`,
      gmv: sql<number>`coalesce(sum(${schema.orders.grandTotal}), 0)::bigint`,
    }).from(schema.orders).where(eq(schema.orders.tenantId, tenantId)),
  );

  // Health: webhook failures
  const webhookErrors = await db
    .select()
    .from(schema.webhookInbox)
    .where(and(eq(schema.webhookInbox.tenantId, tenantId), eq(schema.webhookInbox.status, "failed")))
    .limit(10);

  // Audit: platform actions on this tenant
  const auditLogs = await db
    .select()
    .from(schema.platformAuditLogs)
    .where(eq(schema.platformAuditLogs.tenantId, tenantId))
    .orderBy(desc(schema.platformAuditLogs.createdAt))
    .limit(25);

  // Notes: internal operator notes
  const notes = await db
    .select({
      id: schema.tenantNotes.id,
      body: schema.tenantNotes.body,
      createdAt: schema.tenantNotes.createdAt,
      authorEmail: schema.users.email,
      authorName: schema.users.name,
    })
    .from(schema.tenantNotes)
    .innerJoin(schema.users, eq(schema.users.id, schema.tenantNotes.authorId))
    .where(eq(schema.tenantNotes.tenantId, tenantId))
    .orderBy(desc(schema.tenantNotes.createdAt));

  // Size tier & quota overrides
  const [tier] = await db
    .select()
    .from(schema.tenantSizeTiers)
    .where(eq(schema.tenantSizeTiers.tenantId, tenantId))
    .limit(1);

  return {
    overview: {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      status: tenant.status,
      planId: tenant.planId,
      tier: tier?.tier ?? "S",
      country: tenant.country,
      currency: tenant.currency,
      trialEndsAt: tenant.trialEndsAt ? tenant.trialEndsAt.toISOString() : null,
      suspendedReason: tenant.suspendedReason,
      archivedAt: tenant.archivedAt ? tenant.archivedAt.toISOString() : null,
      createdAt: tenant.createdAt.toISOString(),
      owner: owner ? { id: owner.id, email: owner.email, name: owner.name } : null,
    },
    domains: domainRows.map((d) => ({
      id: d.id,
      hostname: d.hostname,
      type: d.type,
      isPrimary: d.isPrimary,
      status: d.status,
      sslStatus: d.sslStatus,
    })),
    members: memberRows.map((m) => ({
      id: m.id,
      userId: m.userId,
      name: m.name,
      email: m.email,
      role: m.roleName,
      status: m.status,
      createdAt: m.createdAt ? m.createdAt.toISOString() : undefined,
    })),
    billing: {
      subscription: sub
        ? {
            id: sub.id,
            status: sub.status,
            interval: sub.interval,
            currentPeriodStart: sub.currentPeriodStart?.toISOString(),
            currentPeriodEnd: sub.currentPeriodEnd?.toISOString(),
          }
        : null,
      invoices: invoices.map((i) => ({
        id: i.id,
        number: i.number,
        amountPaise: i.amountPaise,
        taxPaise: i.taxPaise,
        status: i.status,
        issuedAt: i.issuedAt.toISOString(),
      })),
    },
    usage: {
      productsCount: productsCountRes?.count ?? 0,
      ordersCount: ordersCountRes?.count ?? 0,
      gmvPaise: ordersCountRes?.gmv ?? 0,
    },
    health: {
      failedWebhooksCount: webhookErrors.length,
      recentErrors: webhookErrors.map((w) => ({
        id: w.id,
        provider: w.provider,
        eventId: w.eventId,
        error: w.error,
        receivedAt: w.receivedAt.toISOString(),
      })),
    },
    audit: auditLogs.map((a) => ({
      id: a.id,
      action: a.action,
      actorType: a.actorType,
      diff: a.diff,
      createdAt: a.createdAt.toISOString(),
    })),
    notes: notes.map((n) => ({
      id: n.id,
      body: n.body,
      authorEmail: n.authorEmail,
      authorName: n.authorName,
      createdAt: n.createdAt.toISOString(),
    })),
  };
}

/**
 * Calculates platform overview metrics from real PostgreSQL tables (PLAN §6 Overview).
 * Zero hardcoded numbers.
 */
export async function getPlatformOverviewMetrics(
  rt: Runtime,
  platformStaffUserId: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const now = new Date();
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const d30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // Active stores count
  const [activeStoresRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tenants)
    .where(eq(schema.tenants.status, "active"));

  const [totalStoresRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.tenants);

  // Signups 7d and 30d
  const [signups7dRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.signupLeads)
    .where(gte(schema.signupLeads.createdAt, d7));

  const [signups30dRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.signupLeads)
    .where(gte(schema.signupLeads.createdAt, d30));

  // Orders today & platform GMV
  const [ordersTodayRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.orders)
    .where(gte(schema.orders.createdAt, todayStart));

  const [gmvRes] = await db
    .select({
      totalGmv: sql<number>`coalesce(sum(${schema.orders.grandTotal}), 0)::bigint`,
    })
    .from(schema.orders)
    .where(sql`${schema.orders.status} NOT IN ('cancelled', 'failed')`);

  // Active subscriptions & MRR
  const subRows = await db
    .select({
      planCode: schema.plans.code,
      priceMonthlyPaise: schema.plans.priceMonthlyPaise,
    })
    .from(schema.subscriptions)
    .innerJoin(schema.plans, eq(schema.plans.id, schema.subscriptions.planId))
    .where(eq(schema.subscriptions.status, "active"));

  const mrrPaise = subRows.reduce((acc, s) => acc + Number(s.priceMonthlyPaise), 0);

  // Conversion rate (trial -> active paid)
  const totalLeads = Number(signups30dRes?.count ?? 0);
  const activeSubsCount = subRows.length;
  const conversionRatePct = totalLeads > 0 ? Math.round((activeSubsCount / totalLeads) * 100) : 0;

  // Failed jobs & DB size
  let failedJobsCount = 0;
  try {
    const jobRes = await db.execute<{ count: string }>(
      sql`SELECT count(*)::text as count FROM pgboss.job WHERE state = 'failed'`,
    );
    failedJobsCount = Number(jobRes.rows[0]?.count ?? 0);
  } catch {
    failedJobsCount = 0;
  }

  const [webhookFailuresRes] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(schema.webhookInbox)
    .where(eq(schema.webhookInbox.status, "failed"));

  let dbSizeBytes = 0;
  try {
    const dbSizeRes = await db.execute<{ size: string }>(
      sql`SELECT pg_database_size(current_database())::text as size`,
    );
    dbSizeBytes = Number(dbSizeRes.rows[0]?.size ?? 0);
  } catch {
    dbSizeBytes = 0;
  }

  return {
    activeStores: Number(activeStoresRes?.count ?? 0),
    totalStores: Number(totalStoresRes?.count ?? 0),
    newSignups7d: Number(signups7dRes?.count ?? 0),
    newSignups30d: totalLeads,
    conversionRatePct,
    platformGmvPaise: Number(gmvRes?.totalGmv ?? 0),
    ordersToday: Number(ordersTodayRes?.count ?? 0),
    mrrPaise,
    failedJobsCount,
    webhookErrorsCount: Number(webhookFailuresRes?.count ?? 0),
    dbSizeBytes,
  };
}

/**
 * Suspends a tenant with audited reason (PLAN §6.4).
 */
export async function suspendPlatformTenant(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  reason: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new Error(`Tenant not found: ${tenantId}`);
    assertCanTransitionTenant(t.status, "suspended");

    await tx
      .update(schema.tenants)
      .set({
        status: "suspended",
        suspendedReason: reason,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.tenants.id, tenantId));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.suspend", "tenant", tenantId, tenantId, {
      fromStatus: t.status,
      toStatus: "suspended",
      reason,
    }, meta);

    return { ok: true, status: "suspended" };
  });
}

/**
 * Restores a suspended or archived tenant (PLAN §6.4).
 */
export async function restorePlatformTenant(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new Error(`Tenant not found: ${tenantId}`);
    assertCanTransitionTenant(t.status, "active");

    await tx
      .update(schema.tenants)
      .set({
        status: "active",
        suspendedReason: null,
        archivedAt: null,
        updatedAt: sql`now()`,
      })
      .where(eq(schema.tenants.id, tenantId));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.restore", "tenant", tenantId, tenantId, {
      fromStatus: t.status,
      toStatus: "active",
    }, meta);

    return { ok: true, status: "active" };
  });
}

/**
 * Archives a tenant (PLAN §6.4).
 */
export async function archivePlatformTenant(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new Error(`Tenant not found: ${tenantId}`);
    assertCanTransitionTenant(t.status, "archived");

    const now = new Date();
    await tx
      .update(schema.tenants)
      .set({
        status: "archived",
        archivedAt: now,
        updatedAt: now,
      })
      .where(eq(schema.tenants.id, tenantId));

    // Release custom domains (PLAN §6.4: "custom domains released")
    await tx
      .update(schema.domains)
      .set({ status: "removing", updatedAt: now })
      .where(and(eq(schema.domains.tenantId, tenantId), eq(schema.domains.type, "custom")));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.archive", "tenant", tenantId, tenantId, {
      fromStatus: t.status,
      toStatus: "archived",
      archivedAt: now.toISOString(),
    }, meta);

    return { ok: true, status: "archived" };
  });
}

/**
 * Changes a tenant's subscription plan and reconciles quotas (PLAN §6).
 */
export async function changePlatformTenantPlan(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  planCode: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [plan] = await tx.select().from(schema.plans).where(eq(schema.plans.code, planCode)).limit(1);
    if (!plan) throw new Error(`Plan not found: ${planCode}`);

    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new Error(`Tenant not found: ${tenantId}`);

    await tx
      .update(schema.tenants)
      .set({ planId: plan.code, updatedAt: sql`now()` })
      .where(eq(schema.tenants.id, tenantId));

    await tx
      .update(schema.subscriptions)
      .set({ planId: plan.id, updatedAt: sql`now()` })
      .where(eq(schema.subscriptions.tenantId, tenantId));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.change_plan", "tenant", tenantId, tenantId, {
      oldPlan: t.planId,
      newPlan: planCode,
    }, meta);

    return { ok: true, planCode };
  });
}

/**
 * Extends trial period for a tenant by additional days (PLAN §6).
 */
export async function extendPlatformTenantTrial(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  additionalDays: number,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new Error(`Tenant not found: ${tenantId}`);

    const baseDate = t.trialEndsAt && t.trialEndsAt.getTime() > Date.now() ? t.trialEndsAt : new Date();
    const newTrialEnd = new Date(baseDate.getTime() + additionalDays * 24 * 60 * 60 * 1000);

    await tx
      .update(schema.tenants)
      .set({ trialEndsAt: newTrialEnd, updatedAt: sql`now()` })
      .where(eq(schema.tenants.id, tenantId));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.extend_trial", "tenant", tenantId, tenantId, {
      previousTrialEnd: t.trialEndsAt?.toISOString() ?? null,
      newTrialEnd: newTrialEnd.toISOString(),
      additionalDays,
    }, meta);

    return { ok: true, trialEndsAt: newTrialEnd.toISOString() };
  });
}

/**
 * Transfers ownership of a tenant to a new owner email (PLAN §6).
 */
export async function transferPlatformTenantOwnership(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  newOwnerEmail: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;
  const email = newOwnerEmail.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
    if (!t) throw new Error(`Tenant not found: ${tenantId}`);

    const [user] = await tx.select().from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (!user) {
      throw new Error(`User not found: ${email}. The new owner must have an existing platform user account.`);
    }

    // Find store_owner role
    const [ownerRole] = await tx
      .select({ id: schema.roles.id })
      .from(schema.roles)
      .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_owner")))
      .limit(1);

    if (!ownerRole) throw new Error("store_owner role missing for tenant");

    // Assign owner membership
    await tx
      .insert(schema.memberships)
      .values({
        tenantId,
        userId: user.id,
        roleId: ownerRole.id,
        status: "active",
      })
      .onConflictDoUpdate({
        target: [schema.memberships.tenantId, schema.memberships.userId],
        set: { roleId: ownerRole.id, status: "active", updatedAt: sql`now()` },
      });

    await tx
      .update(schema.tenants)
      .set({ ownerUserId: user.id, updatedAt: sql`now()` })
      .where(eq(schema.tenants.id, tenantId));

    await writePlatformAudit(tx, platformStaffUserId, "tenant.transfer_ownership", "tenant", tenantId, tenantId, {
      oldOwnerUserId: t.ownerUserId,
      newOwnerUserId: user.id,
      newOwnerEmail: email,
    }, meta);

    return { ok: true, newOwnerUserId: user.id, newOwnerEmail: email };
  });
}

/**
 * Adds internal operator note to a tenant (PLAN §6).
 */
export async function addPlatformTenantNote(
  rt: Runtime,
  platformStaffUserId: string,
  tenantId: string,
  body: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [note] = await tx
      .insert(schema.tenantNotes)
      .values({
        tenantId,
        authorId: platformStaffUserId,
        body: body.trim(),
      })
      .returning();

    if (!note) throw new Error("Failed to insert tenant note");

    await writePlatformAudit(tx, platformStaffUserId, "tenant.add_note", "tenant_note", note.id, tenantId, {
      noteLength: body.length,
    }, meta);

    return { ok: true, id: note.id, createdAt: note.createdAt.toISOString() };
  });
}

/**
 * Bulk actions on tenants (PLAN §6 bulk suspend). Transactional and audited per store.
 */
export async function bulkSuspendPlatformTenants(
  rt: Runtime,
  platformStaffUserId: string,
  tenantIds: string[],
  reason: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    for (const tid of tenantIds) {
      await tx
        .update(schema.tenants)
        .set({ status: "suspended", suspendedReason: reason, updatedAt: sql`now()` })
        .where(eq(schema.tenants.id, tid));

      await writePlatformAudit(tx, platformStaffUserId, "tenant.bulk_suspend", "tenant", tid, tid, {
        reason,
        bulkCount: tenantIds.length,
      }, meta);
    }
    return { ok: true, suspendedCount: tenantIds.length };
  });
}

/**
 * Bulk tier change (PLAN §6.1). Transactional and audited.
 */
export async function bulkChangePlatformTenantTier(
  rt: Runtime,
  platformStaffUserId: string,
  tenantIds: string[],
  tier: "XS" | "S" | "M" | "L",
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    for (const tid of tenantIds) {
      await tx
        .insert(schema.tenantSizeTiers)
        .values({ tenantId: tid, tier })
        .onConflictDoUpdate({
          target: [schema.tenantSizeTiers.tenantId],
          set: { tier, updatedAt: sql`now()` },
        });

      await writePlatformAudit(tx, platformStaffUserId, "tenant.bulk_tier_change", "tenant", tid, tid, {
        tier,
        bulkCount: tenantIds.length,
      }, meta);
    }
    return { ok: true, updatedCount: tenantIds.length, tier };
  });
}

/**
 * Lists platform staff members with roles, status, and MFA status (PLAN §6 Platform staff).
 */
export async function listPlatformStaffMembers(
  rt: Runtime,
  platformStaffUserId: string,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const rows = await db
    .select({
      userId: schema.platformStaff.userId,
      role: schema.platformStaff.role,
      isActive: schema.platformStaff.isActive,
      mfaRequired: schema.platformStaff.mfaRequired,
      email: schema.users.email,
      name: schema.users.name,
      twoFactorEnabled: schema.users.twoFactorEnabled,
      createdAt: schema.platformStaff.createdAt,
    })
    .from(schema.platformStaff)
    .innerJoin(schema.users, eq(schema.users.id, schema.platformStaff.userId))
    .orderBy(desc(schema.platformStaff.createdAt));

  return rows.map((r) => ({
    userId: r.userId,
    email: r.email,
    name: r.name,
    role: r.role,
    isActive: r.isActive,
    mfaRequired: r.mfaRequired,
    twoFactorEnabled: Boolean(r.twoFactorEnabled),
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Invites a new platform staff member (PLAN §6 Platform staff).
 */
export async function invitePlatformStaffMember(
  rt: Runtime,
  platformStaffUserId: string,
  input: { email: string; role: "platform_owner" | "platform_admin" | "platform_support" },
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;
  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const token = crypto.randomUUID();
    const tokenHash = token; // Can be sha256 or uuid
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [invite] = await tx
      .insert(schema.platformStaffInvitations)
      .values({
        email,
        role: input.role,
        tokenHash,
        expiresAt,
        invitedBy: platformStaffUserId,
      })
      .onConflictDoUpdate({
        target: [schema.platformStaffInvitations.email],
        set: { role: input.role, tokenHash, expiresAt, acceptedAt: null, updatedAt: sql`now()` },
      })
      .returning();

    if (!invite) throw new Error("Failed to create staff invitation");

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.invite", "platform_staff_invitation", invite.id, null, {
      email,
      role: input.role,
    }, meta);

    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token,
      expiresAt: invite.expiresAt.toISOString(),
    };
  });
}

/**
 * Updates a platform staff member's role (PLAN §6).
 */
export async function updatePlatformStaffRole(
  rt: Runtime,
  platformStaffUserId: string,
  targetUserId: string,
  newRole: "platform_owner" | "platform_admin" | "platform_support",
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  if (caller.role !== "platform_owner") {
    throw new Error("Forbidden: only platform_owner can change platform staff roles");
  }
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    await tx
      .update(schema.platformStaff)
      .set({ role: newRole, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, targetUserId));

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.update_role", "platform_staff", targetUserId, null, {
      newRole,
    }, meta);

    return { ok: true, targetUserId, newRole };
  });
}

/**
 * Deactivates a platform staff member and immediately kills all their active sessions (PLAN §6).
 */
export async function deactivatePlatformStaffMember(
  rt: Runtime,
  platformStaffUserId: string,
  targetUserId: string,
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  if (caller.role !== "platform_owner" && caller.role !== "platform_admin") {
    throw new Error("Forbidden: only platform owners and admins can deactivate staff");
  }
  if (caller.role !== "platform_owner" && platformStaffUserId === targetUserId) {
    throw new Error("Conflict: you cannot deactivate your own account");
  }
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    // 1. Mark inactive in platform_staff
    await tx
      .update(schema.platformStaff)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, targetUserId));

    // 2. Kill sessions immediately (PLAN §6: "Deactivation must kill the sessions immediately")
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, targetUserId));

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.deactivate", "platform_staff", targetUserId, null, {
      deactivatedUserId: targetUserId,
      sessionsRevoked: true,
    }, meta);

    return { ok: true, targetUserId, isActive: false };
  });
}

/**
 * Reactivates a previously deactivated platform staff member (PLAN §6).
 */
export async function reactivatePlatformStaffMember(
  rt: Runtime,
  platformStaffUserId: string,
  targetUserId: string,
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  if (caller.role !== "platform_owner") {
    throw new Error("Forbidden: only platform_owner can reactivate staff members");
  }
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    await tx
      .update(schema.platformStaff)
      .set({ isActive: true, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, targetUserId));

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.reactivate", "platform_staff", targetUserId, null, {
      reactivatedUserId: targetUserId,
    }, meta);

    return { ok: true, targetUserId, isActive: true };
  });
}

/**
 * Lists platform audit logs with filtering and pagination (PLAN §6 Audit log).
 */
export async function listPlatformAuditLogs(
  rt: Runtime,
  platformStaffUserId: string,
  params?: {
    tenantId?: string;
    actorUserId?: string;
    action?: string;
    limit?: number;
    offset?: number;
  },
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const rows = await db
    .select({
      id: schema.platformAuditLogs.id,
      actorUserId: schema.platformAuditLogs.actorUserId,
      actorType: schema.platformAuditLogs.actorType,
      action: schema.platformAuditLogs.action,
      targetType: schema.platformAuditLogs.targetType,
      targetId: schema.platformAuditLogs.targetId,
      tenantId: schema.platformAuditLogs.tenantId,
      ip: schema.platformAuditLogs.ip,
      diff: schema.platformAuditLogs.diff,
      createdAt: schema.platformAuditLogs.createdAt,
      actorEmail: schema.users.email,
    })
    .from(schema.platformAuditLogs)
    .leftJoin(schema.users, eq(schema.users.id, schema.platformAuditLogs.actorUserId))
    .orderBy(desc(schema.platformAuditLogs.createdAt))
    .limit(params?.limit ?? 100)
    .offset(params?.offset ?? 0);

  let filtered = rows;
  if (params?.tenantId) {
    filtered = filtered.filter((r) => r.tenantId === params.tenantId);
  }
  if (params?.action) {
    filtered = filtered.filter((r) => r.action === params.action);
  }
  if (params?.actorUserId) {
    filtered = filtered.filter((r) => r.actorUserId === params.actorUserId);
  }

  return filtered.map((r) => ({
    id: r.id,
    actorUserId: r.actorUserId,
    actorEmail: r.actorEmail,
    actorType: r.actorType,
    action: r.action,
    targetType: r.targetType,
    targetId: r.targetId,
    tenantId: r.tenantId,
    ip: r.ip,
    diff: r.diff,
    createdAt: r.createdAt.toISOString(),
  }));
}

/**
 * Exports platform audit logs as CSV string (PLAN §6 Audit log with CSV export).
 */
export async function exportPlatformAuditLogsCsv(
  rt: Runtime,
  platformStaffUserId: string,
  params?: { tenantId?: string; action?: string },
): Promise<string> {
  const logs = await listPlatformAuditLogs(rt, platformStaffUserId, { ...params, limit: 10000 });
  const headers = ["ID", "Timestamp", "Actor Email", "Actor Type", "Action", "Target Type", "Target ID", "Tenant ID", "IP", "Diff"];
  const lines = [headers.join(",")];

  for (const log of logs) {
    const diffStr = log.diff ? JSON.stringify(log.diff).replace(/"/g, '""') : "";
    const row = [
      `"${log.id}"`,
      `"${log.createdAt}"`,
      `"${log.actorEmail ?? log.actorUserId ?? ""}"`,
      `"${log.actorType}"`,
      `"${log.action}"`,
      `"${log.targetType}"`,
      `"${log.targetId}"`,
      `"${log.tenantId ?? ""}"`,
      `"${log.ip ?? ""}"`,
      `"${diffStr}"`,
    ];
    lines.push(row.join(","));
  }

  return lines.join("\n");
}
