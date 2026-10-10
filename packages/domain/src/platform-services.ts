import { createHash, randomBytes } from "node:crypto";
import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import { hashPassword, verifyPassword } from "@bs/auth";
import type { Runtime } from "./runtime.ts";
import { assertCanTransitionTenant } from "./system/tenant-lifecycle.ts";
import { tierForPlan } from "./saas/plan-tiers.ts";

export interface AuditMeta {
  ip?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
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

export type PlatformRole = "platform_owner" | "platform_admin" | "platform_support";

const ROLE_RANK: Record<string, number> = { platform_support: 1, platform_admin: 2, platform_owner: 3 };

export function roleAtLeast(role: string, min: PlatformRole): boolean {
  return (ROLE_RANK[role] ?? 0) >= (ROLE_RANK[min] ?? 0);
}

/** Throws Forbidden unless the staff role is at least `min`. */
export function assertRoleAtLeast(role: string, min: PlatformRole, action: string): void {
  if (!roleAtLeast(role, min)) {
    throw new Error(`Forbidden: ${action} requires the ${min} role or higher`);
  }
}

export interface PlatformStaffIdentity {
  userId: string;
  role: PlatformRole;
}

/**
 * Asserts that the authenticated user is an active platform staff member with COMPLETED and CURRENT MFA (PLAN §4, §6):
 *  - the account is an active platform_staff row;
 *  - TOTP is enabled and verified (Better Auth two_factors);
 *  - enrolment was completed (mfa_verified_at), which also killed every earlier password-only session;
 *  - if a session is given, it was created after that moment, i.e. it went through password AND TOTP.
 * Internal service functions call this without a session (the router middleware already checked it).
 */
export async function assertPlatformStaff(
  rt: Runtime,
  userId: string,
  session?: { createdAt?: Date | undefined },
): Promise<PlatformStaffIdentity> {
  const db = rt._db.db;
  const [staff] = await db
    .select({
      role: schema.platformStaff.role,
      isActive: schema.platformStaff.isActive,
      mfaVerifiedAt: schema.platformStaff.mfaVerifiedAt,
      twoFactorEnabled: schema.users.twoFactorEnabled,
    })
    .from(schema.platformStaff)
    .innerJoin(schema.users, eq(schema.users.id, schema.platformStaff.userId))
    .where(and(eq(schema.platformStaff.userId, userId), eq(schema.platformStaff.isActive, true)))
    .limit(1);

  if (!staff) {
    throw new Error("Forbidden: user is not an active platform staff member");
  }
  if (!staff.twoFactorEnabled) {
    throw new Error("Forbidden: platform staff requires verified MFA (two-factor authentication not enabled)");
  }

  const [twoFactorRecord] = await db
    .select({ verified: schema.twoFactors.verified })
    .from(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, userId))
    .limit(1);
  if (!twoFactorRecord || twoFactorRecord.verified !== true) {
    throw new Error("Forbidden: platform staff requires verified MFA (two-factor authentication not verified)");
  }

  if (!staff.mfaVerifiedAt) {
    throw new Error("Forbidden: MFA enrolment is not complete; finish setup and sign in again");
  }
  if (session) {
    if (!session.createdAt || session.createdAt.getTime() < staff.mfaVerifiedAt.getTime()) {
      throw new Error("Forbidden: this session predates MFA enrolment; sign in again with your authenticator code");
    }
  }

  return { userId, role: staff.role as PlatformRole };
}

/**
 * Internal helper: writes an audit row in the CURRENT transaction (pass the tx, never the pool).
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
 * State of a platform login for the Super Admin login flow (also used before MFA is complete, so it does not
 * require it). `session` is the Better Auth session of the caller.
 */
export async function getPlatformLoginStatus(
  rt: Runtime,
  userId: string,
  sessionCreatedAt: Date,
): Promise<{
  isPlatformStaff: boolean;
  role: PlatformRole | null;
  mfaEnrolled: boolean;
  mfaComplete: boolean;
  sessionValid: boolean;
}> {
  const db = rt._db.db;
  const [staff] = await db
    .select({
      role: schema.platformStaff.role,
      mfaVerifiedAt: schema.platformStaff.mfaVerifiedAt,
      twoFactorEnabled: schema.users.twoFactorEnabled,
    })
    .from(schema.platformStaff)
    .innerJoin(schema.users, eq(schema.users.id, schema.platformStaff.userId))
    .where(and(eq(schema.platformStaff.userId, userId), eq(schema.platformStaff.isActive, true)))
    .limit(1);
  if (!staff) return { isPlatformStaff: false, role: null, mfaEnrolled: false, mfaComplete: false, sessionValid: false };

  const [tf] = await db
    .select({ verified: schema.twoFactors.verified })
    .from(schema.twoFactors)
    .where(eq(schema.twoFactors.userId, userId))
    .limit(1);
  const mfaEnrolled = Boolean(staff.twoFactorEnabled) && tf?.verified === true;
  const mfaComplete = mfaEnrolled && staff.mfaVerifiedAt !== null;
  return {
    isPlatformStaff: true,
    role: staff.role as PlatformRole,
    mfaEnrolled,
    mfaComplete,
    sessionValid: mfaComplete && sessionCreatedAt.getTime() >= (staff.mfaVerifiedAt?.getTime() ?? Infinity),
  };
}

/**
 * Called after the staff member verified their first TOTP code. Stamps the completion moment and kills EVERY
 * existing session of the user (including the password-only one used for setup), so the next login is
 * password + TOTP. Audited in the same transaction.
 */
export async function completePlatformMfaEnrollment(
  rt: Runtime,
  userId: string,
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  const db = rt._db.db;
  return db.transaction(async (tx) => {
    const [staff] = await tx
      .select({
        mfaVerifiedAt: schema.platformStaff.mfaVerifiedAt,
        twoFactorEnabled: schema.users.twoFactorEnabled,
      })
      .from(schema.platformStaff)
      .innerJoin(schema.users, eq(schema.users.id, schema.platformStaff.userId))
      .where(and(eq(schema.platformStaff.userId, userId), eq(schema.platformStaff.isActive, true)))
      .for("update", { of: schema.platformStaff })
      .limit(1);
    if (!staff) throw new Error("Forbidden: user is not an active platform staff member");
    if (staff.mfaVerifiedAt) throw new Error("Conflict: MFA enrolment is already complete");

    const [tf] = await tx
      .select({ verified: schema.twoFactors.verified })
      .from(schema.twoFactors)
      .where(eq(schema.twoFactors.userId, userId))
      .limit(1);
    if (!staff.twoFactorEnabled || tf?.verified !== true) {
      throw new Error("Conflict: verify a code from your authenticator app before completing setup");
    }

    await tx
      .update(schema.platformStaff)
      .set({ mfaVerifiedAt: sql`now()`, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, userId));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, userId));
    await writePlatformAudit(tx, userId, "platform_staff.mfa_enrolled", "platform_staff", userId, null, { sessionsRevoked: true }, meta);
    return { ok: true as const };
  });
}

/**
 * Lists all tenants across the platform with filtering and search (PLAN §6 Tenants list).
 */
export async function listPlatformTenants(
  rt: Runtime,
  params?: {
    search?: string | undefined;
    status?: string | undefined;
    planId?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  } | undefined,
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

  // Open deletion (grace period / in progress)
  const [openDeletion] = await db
    .select()
    .from(schema.tenantDeletions)
    .where(and(eq(schema.tenantDeletions.tenantId, tenantId), isNull(schema.tenantDeletions.cancelledAt), isNull(schema.tenantDeletions.completedAt)))
    .limit(1);

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
      gmvPaise: Number(ordersCountRes?.gmv ?? 0),
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
    deletion: openDeletion
      ? {
          id: openDeletion.id,
          step: openDeletion.step,
          scheduledFor: openDeletion.scheduledFor.toISOString(),
          reason: openDeletion.reason,
          error: openDeletion.error,
          canCancel: openDeletion.step === "requested" || openDeletion.step === "exported",
        }
      : null,
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
  let failedJobsCount: number;
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

  let dbSizeBytes: number;
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

    // The plan decides the store's size tier (same mapping as provisioning and the billing webhook).
    const tier = tierForPlan(plan.code);
    await tx
      .insert(schema.tenantSizeTiers)
      .values({ tenantId, tier })
      .onConflictDoUpdate({ target: [schema.tenantSizeTiers.tenantId], set: { tier, updatedAt: sql`now()` } });

    await writePlatformAudit(tx, platformStaffUserId, "tenant.change_plan", "tenant", tenantId, tenantId, {
      oldPlan: t.planId,
      newPlan: planCode,
      tier,
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
 * Bulk suspend (PLAN §6). All-or-nothing: every store must exist and be allowed to move to `suspended`, the
 * caller must have typed the exact confirmation, and every store gets its own audit row in the same transaction.
 */
export async function bulkSuspendPlatformTenants(
  rt: Runtime,
  platformStaffUserId: string,
  tenantIds: string[],
  reason: string,
  confirmation: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const ids = [...new Set(tenantIds)];
  if (ids.length === 0) throw new Error("Bad Request: select at least one store");
  if (confirmation !== `SUSPEND ${ids.length}`) {
    throw new Error(`Bad Request: type "SUSPEND ${ids.length}" to confirm`);
  }
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.tenants).where(inArray(schema.tenants.id, ids)).for("update");
    if (rows.length !== ids.length) throw new Error("Not Found: one or more selected stores do not exist");
    for (const t of rows) assertCanTransitionTenant(t.status, "suspended");

    for (const t of rows) {
      await tx
        .update(schema.tenants)
        .set({ status: "suspended", suspendedReason: reason, updatedAt: sql`now()` })
        .where(eq(schema.tenants.id, t.id));
      await writePlatformAudit(tx, platformStaffUserId, "tenant.bulk_suspend", "tenant", t.id, t.id, {
        fromStatus: t.status,
        toStatus: "suspended",
        reason,
        bulkCount: ids.length,
      }, meta);
    }
    return { ok: true, suspendedCount: ids.length };
  });
}

/**
 * Bulk tier change (PLAN §6.1). All-or-nothing, typed confirmation, one audit row per store.
 */
export async function bulkChangePlatformTenantTier(
  rt: Runtime,
  platformStaffUserId: string,
  tenantIds: string[],
  tier: string,
  confirmation: string,
  meta?: AuditMeta,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const ids = [...new Set(tenantIds)];
  if (ids.length === 0) throw new Error("Bad Request: select at least one store");
  const cleanTier = tier.trim().toUpperCase();
  if (confirmation !== `TIER ${cleanTier} ${ids.length}`) {
    throw new Error(`Bad Request: type "TIER ${cleanTier} ${ids.length}" to confirm`);
  }
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    // Validate tier exists and is active inside the same transaction
    const [targetTier] = await tx
      .select({ code: schema.quotaTiers.code, isActive: schema.quotaTiers.isActive })
      .from(schema.quotaTiers)
      .where(eq(schema.quotaTiers.code, cleanTier))
      .for("share")
      .limit(1);

    if (!targetTier) {
      throw new Error(`Bad Request: Quota tier "${cleanTier}" does not exist`);
    }
    if (!targetTier.isActive) {
      throw new Error(`Bad Request: Quota tier "${cleanTier}" is inactive and cannot be assigned to stores`);
    }

    const existing = await tx.select({ id: schema.tenants.id }).from(schema.tenants).where(inArray(schema.tenants.id, ids));
    if (existing.length !== ids.length) throw new Error("Not Found: one or more selected stores do not exist");
    const previous = await tx
      .select({ tenantId: schema.tenantSizeTiers.tenantId, tier: schema.tenantSizeTiers.tier })
      .from(schema.tenantSizeTiers)
      .where(inArray(schema.tenantSizeTiers.tenantId, ids));
    const before = new Map(previous.map((p) => [p.tenantId, p.tier]));

    for (const tid of ids) {
      await tx
        .insert(schema.tenantSizeTiers)
        .values({ tenantId: tid, tier: cleanTier })
        .onConflictDoUpdate({
          target: [schema.tenantSizeTiers.tenantId],
          set: { tier: cleanTier, updatedAt: sql`now()` },
        });

      await writePlatformAudit(tx, platformStaffUserId, "tenant.bulk_tier_change", "tenant", tid, tid, {
        fromTier: before.get(tid) ?? null,
        tier: cleanTier,
        bulkCount: ids.length,
      }, meta);
    }
    return { ok: true, updatedCount: ids.length, tier: cleanTier };
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

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

function sha256(v: string): string {
  return createHash("sha256").update(v).digest("hex");
}

/** Counts active platform owners (used for the last-owner protection). */
async function countActiveOwners(tx: Db): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(schema.platformStaff)
    .where(and(eq(schema.platformStaff.role, "platform_owner"), eq(schema.platformStaff.isActive, true)));
  return Number(row?.n ?? 0);
}

/**
 * Invites a new platform staff member (PLAN §6 Platform staff).
 * - platform_admin may invite support and admin staff; only platform_owner may invite another owner.
 * - Only a SHA-256 of the token is stored. The raw token is returned once, to the inviter, inside the invite URL
 *   (there is no e-mail delivery), and is never returned again.
 */
export async function invitePlatformStaffMember(
  rt: Runtime,
  platformStaffUserId: string,
  input: { email: string; role: PlatformRole },
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(caller.role, "platform_admin", "inviting platform staff");
  if (input.role === "platform_owner") assertRoleAtLeast(caller.role, "platform_owner", "inviting a platform owner");
  const db = rt._db.db;
  const email = input.email.trim().toLowerCase();

  return db.transaction(async (tx) => {
    const [alreadyStaff] = await tx
      .select({ userId: schema.platformStaff.userId })
      .from(schema.platformStaff)
      .innerJoin(schema.users, eq(schema.users.id, schema.platformStaff.userId))
      .where(and(eq(schema.users.email, email), eq(schema.platformStaff.isActive, true)))
      .limit(1);
    if (alreadyStaff) throw new Error("Conflict: this person is already an active platform staff member");

    const token = randomBytes(32).toString("hex");
    const tokenHash = sha256(token);
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);

    const [invite] = await tx
      .insert(schema.platformStaffInvitations)
      .values({ email, role: input.role, tokenHash, expiresAt, invitedBy: platformStaffUserId })
      .onConflictDoUpdate({
        target: [schema.platformStaffInvitations.email],
        set: { role: input.role, tokenHash, expiresAt, acceptedAt: null, invitedBy: platformStaffUserId, updatedAt: sql`now()` },
      })
      .returning();
    if (!invite) throw new Error("Failed to create staff invitation");

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.invite", "platform_staff_invitation", invite.id, null, {
      email,
      role: input.role,
      expiresAt: expiresAt.toISOString(),
    }, meta);

    const base = (process.env.SUPERADMIN_URL ?? process.env.SUPERADMIN_ORIGINS?.split(",")[0] ?? "https://platform.bcom.si").trim().replace(/\/$/, "");
    return {
      id: invite.id,
      email: invite.email,
      role: invite.role,
      token,
      inviteUrl: `${base}/accept-invitation?token=${token}`,
      expiresAt: invite.expiresAt.toISOString(),
    };
  });
}

/**
 * Accepts a platform staff invitation (public endpoint, rate limited by the caller).
 * The token is claimed atomically. A new person gets an account with the password they choose. Someone who already
 * has an account must prove it with their CURRENT password: an invitation never replaces an existing password.
 * MFA enrolment is required at the first sign-in like every other staff account.
 */
export async function acceptPlatformStaffInvitation(
  rt: Runtime,
  input: { token: string; password: string; name?: string | undefined },
  meta?: AuditMeta,
): Promise<{ ok: true; email: string; role: PlatformRole }> {
  const token = input.token.trim();
  if (token.length < 32) throw new Error("Invitation token is invalid, expired, or has already been used");
  if (!input.password || input.password.length < 10) throw new Error("Password must be at least 10 characters long");
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const claimed = await tx.execute<{ id: string; email: string; role: string; invited_by: string | null }>(sql`
      UPDATE platform_staff_invitations
         SET accepted_at = now(), updated_at = now()
       WHERE token_hash = ${sha256(token)} AND accepted_at IS NULL AND expires_at > now()
       RETURNING id, email::text AS email, role, invited_by
    `);
    const invite = claimed.rows[0];
    if (!invite) throw new Error("Invitation token is invalid, expired, or has already been used");

    const email = invite.email.toLowerCase();
    let userId: string;
    const [existing] = await tx.select({ id: schema.users.id }).from(schema.users).where(eq(schema.users.email, email)).limit(1);
    if (existing) {
      userId = existing.id;
      const [cred] = await tx
        .select({ password: schema.accounts.password })
        .from(schema.accounts)
        .where(and(eq(schema.accounts.userId, userId), eq(schema.accounts.providerId, "credential")))
        .limit(1);
      if (!cred?.password || !(await verifyPassword({ hash: cred.password, password: input.password }))) {
        throw new Error("Incorrect password for the existing account with this email");
      }
    } else {
      const [created] = await tx
        .insert(schema.users)
        .values({ email, name: input.name?.trim() || email.split("@")[0] || "Platform staff", emailVerified: false, twoFactorEnabled: false })
        .returning({ id: schema.users.id });
      if (!created) throw new Error("Failed to create user");
      userId = created.id;
      await tx.insert(schema.accounts).values({
        id: crypto.randomUUID(),
        userId,
        accountId: userId,
        providerId: "credential",
        password: await hashPassword(input.password),
      });
    }

    await tx
      .insert(schema.platformStaff)
      .values({ userId, role: invite.role, isActive: true, mfaRequired: true })
      .onConflictDoUpdate({
        target: [schema.platformStaff.userId],
        set: { role: invite.role, isActive: true, mfaRequired: true, updatedAt: sql`now()` },
      });

    await tx.insert(schema.platformAuditLogs).values({
      actorUserId: userId,
      actorType: "system",
      action: "platform_staff.invitation_accepted",
      targetType: "platform_staff",
      targetId: userId,
      ip: meta?.ip,
      userAgent: meta?.userAgent,
      requestId: meta?.requestId,
      diff: { email, role: invite.role, invitedBy: invite.invited_by },
    });
    return { ok: true as const, email, role: invite.role as PlatformRole };
  });
}

/**
 * Updates a platform staff member's role (owner only). The last active owner cannot be demoted.
 */
export async function updatePlatformStaffRole(
  rt: Runtime,
  platformStaffUserId: string,
  targetUserId: string,
  newRole: PlatformRole,
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(caller.role, "platform_owner", "changing platform staff roles");
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: schema.platformStaff.role, isActive: schema.platformStaff.isActive })
      .from(schema.platformStaff)
      .where(eq(schema.platformStaff.userId, targetUserId))
      .for("update")
      .limit(1);
    if (!target) throw new Error("Not Found: platform staff member not found");
    if (target.role === "platform_owner" && newRole !== "platform_owner" && target.isActive && (await countActiveOwners(tx)) <= 1) {
      throw new Error("Conflict: the last active platform owner cannot be demoted");
    }

    await tx
      .update(schema.platformStaff)
      .set({ role: newRole, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, targetUserId));

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.update_role", "platform_staff", targetUserId, null, {
      oldRole: target.role,
      newRole,
    }, meta);

    return { ok: true, targetUserId, newRole };
  });
}

/**
 * Deactivates a platform staff member and immediately kills all their sessions (PLAN §6).
 * Owners can deactivate anyone; admins only support staff. Nobody can deactivate themselves, and the last active
 * owner can never be deactivated.
 */
export async function deactivatePlatformStaffMember(
  rt: Runtime,
  platformStaffUserId: string,
  targetUserId: string,
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(caller.role, "platform_admin", "deactivating platform staff");
  if (platformStaffUserId === targetUserId) {
    throw new Error("Conflict: you cannot deactivate your own account");
  }
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const [target] = await tx
      .select({ role: schema.platformStaff.role, isActive: schema.platformStaff.isActive })
      .from(schema.platformStaff)
      .where(eq(schema.platformStaff.userId, targetUserId))
      .for("update")
      .limit(1);
    if (!target) throw new Error("Not Found: platform staff member not found");
    if (caller.role !== "platform_owner" && target.role !== "platform_support") {
      throw new Error("Forbidden: only a platform_owner can deactivate admins and owners");
    }
    if (target.role === "platform_owner" && target.isActive && (await countActiveOwners(tx)) <= 1) {
      throw new Error("Conflict: the last active platform owner cannot be deactivated");
    }

    await tx
      .update(schema.platformStaff)
      .set({ isActive: false, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, targetUserId));

    // PLAN §6: "Deactivation must kill the sessions immediately"
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, targetUserId));

    await writePlatformAudit(tx, platformStaffUserId, "platform_staff.deactivate", "platform_staff", targetUserId, null, {
      deactivatedUserId: targetUserId,
      role: target.role,
      sessionsRevoked: true,
    }, meta);

    return { ok: true, targetUserId, isActive: false };
  });
}

/**
 * Reactivates a previously deactivated platform staff member (owner only). They must sign in again.
 */
export async function reactivatePlatformStaffMember(
  rt: Runtime,
  platformStaffUserId: string,
  targetUserId: string,
  meta?: AuditMeta,
) {
  const caller = await assertPlatformStaff(rt, platformStaffUserId);
  assertRoleAtLeast(caller.role, "platform_owner", "reactivating platform staff");
  const db = rt._db.db;

  return db.transaction(async (tx) => {
    const updated = await tx
      .update(schema.platformStaff)
      .set({ isActive: true, updatedAt: sql`now()` })
      .where(eq(schema.platformStaff.userId, targetUserId))
      .returning({ userId: schema.platformStaff.userId });
    if (updated.length === 0) throw new Error("Not Found: platform staff member not found");

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
    tenantId?: string | undefined;
    actorUserId?: string | undefined;
    action?: string | undefined;
    limit?: number | undefined;
    offset?: number | undefined;
  } | undefined,
) {
  await assertPlatformStaff(rt, platformStaffUserId);
  const db = rt._db.db;

  const conditions = [
    params?.tenantId ? eq(schema.platformAuditLogs.tenantId, params.tenantId) : undefined,
    params?.action ? eq(schema.platformAuditLogs.action, params.action) : undefined,
    params?.actorUserId ? eq(schema.platformAuditLogs.actorUserId, params.actorUserId) : undefined,
  ].filter((c): c is NonNullable<typeof c> => c !== undefined);

  const filtered = await db
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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(schema.platformAuditLogs.createdAt))
    .limit(Math.min(params?.limit ?? 100, 10000))
    .offset(params?.offset ?? 0);

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
  params?: { tenantId?: string | undefined; action?: string | undefined } | undefined,
): Promise<string> {
  const logs = await listPlatformAuditLogs(rt, platformStaffUserId, { ...params, limit: 10000 });
  const headers = ["ID", "Timestamp", "Actor Email", "Actor Type", "Action", "Target Type", "Target ID", "Tenant ID", "IP", "Diff"];
  const lines = [headers.join(",")];

  // Values starting with = + - @ are prefixed with a quote so spreadsheets never execute them as formulas.
  const cell = (v: unknown): string => {
    let t = v === null || v === undefined ? "" : String(v);
    if (/^[=+\-@\t\r]/.test(t)) t = `'${t}`;
    return `"${t.replace(/"/g, '""')}"`;
  };
  for (const log of logs) {
    lines.push(
      [
        cell(log.id),
        cell(log.createdAt),
        cell(log.actorEmail ?? log.actorUserId ?? ""),
        cell(log.actorType),
        cell(log.action),
        cell(log.targetType),
        cell(log.targetId),
        cell(log.tenantId ?? ""),
        cell(log.ip ?? ""),
        cell(log.diff ? JSON.stringify(log.diff) : ""),
      ].join(","),
    );
  }

  return lines.join("\n");
}
