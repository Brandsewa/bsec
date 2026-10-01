import { desc, eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { addCustomDomain } from "../domains/service.ts";
import { writePlatformAudit, type AuditMeta } from "../platform-services.ts";

type Page = { limit?: number | undefined; offset?: number | undefined } | undefined;

/** All hostnames across all stores with their DNS/SSL state (Super Admin → Domains). */
export async function listPlatformDomains(rt: Runtime, page?: Page) {
  const rows = await rt._db.db
    .select({
      id: schema.domains.id,
      tenantId: schema.domains.tenantId,
      hostname: schema.domains.hostname,
      type: schema.domains.type,
      isPrimary: schema.domains.isPrimary,
      status: schema.domains.status,
      sslStatus: schema.domains.sslStatus,
      failureReason: schema.domains.failureReason,
      createdAt: schema.domains.createdAt,
      tenantName: schema.tenants.name,
      tenantSlug: schema.tenants.slug,
    })
    .from(schema.domains)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.domains.tenantId))
    .orderBy(desc(schema.domains.createdAt))
    .limit(Math.min(page?.limit ?? 100, 500))
    .offset(page?.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    hostname: r.hostname,
    type: r.type,
    isPrimary: r.isPrimary,
    status: r.status,
    sslStatus: r.sslStatus,
    failureReason: r.failureReason,
    createdAt: r.createdAt.toISOString(),
    tenantName: r.tenantName,
    tenantSlug: r.tenantSlug,
  }));
}

export async function listPlatformPlans(rt: Runtime) {
  const plans = await rt._db.db.select().from(schema.plans);
  const subCounts = await rt._db.db
    .select({ planId: schema.subscriptions.planId, count: sql<number>`count(*)::int` })
    .from(schema.subscriptions)
    .where(eq(schema.subscriptions.status, "active"))
    .groupBy(schema.subscriptions.planId);
  const countMap = new Map(subCounts.map((s) => [s.planId, s.count]));

  return plans.map((p) => ({
    id: p.id,
    code: p.code,
    name: p.name,
    priceMonthlyPaise: Number(p.priceMonthlyPaise),
    priceYearlyPaise: Number(p.priceYearlyPaise),
    activeSubscribersCount: countMap.get(p.id) ?? 0,
    features: p.limits,
  }));
}

export async function listPlatformInvoices(rt: Runtime, page?: Page) {
  const rows = await rt._db.db
    .select({
      id: schema.platformInvoices.id,
      tenantId: schema.platformInvoices.tenantId,
      number: schema.platformInvoices.number,
      amountPaise: schema.platformInvoices.amountPaise,
      taxPaise: schema.platformInvoices.taxPaise,
      status: schema.platformInvoices.status,
      issuedAt: schema.platformInvoices.issuedAt,
      tenantName: schema.tenants.name,
    })
    .from(schema.platformInvoices)
    .innerJoin(schema.tenants, eq(schema.tenants.id, schema.platformInvoices.tenantId))
    .orderBy(desc(schema.platformInvoices.issuedAt))
    .limit(Math.min(page?.limit ?? 50, 500))
    .offset(page?.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    tenantId: r.tenantId,
    tenantName: r.tenantName,
    number: r.number,
    amountPaise: Number(r.amountPaise),
    taxPaise: Number(r.taxPaise),
    status: r.status,
    issuedAt: r.issuedAt.toISOString(),
  }));
}

export async function listPlatformSignups(rt: Runtime, page?: Page) {
  const rows = await rt._db.db
    .select()
    .from(schema.signupLeads)
    .orderBy(desc(schema.signupLeads.createdAt))
    .limit(Math.min(page?.limit ?? 100, 500))
    .offset(page?.offset ?? 0);

  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    phone: r.phone,
    name: r.name,
    businessName: r.businessName,
    desiredSlug: r.desiredSlug,
    industry: r.industry,
    source: r.source,
    step: r.step,
    createdAt: r.createdAt.toISOString(),
  }));
}

export async function listPlatformThemeTemplates(rt: Runtime) {
  const rows = await rt._db.db.select().from(schema.themeTemplates);
  return rows.map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    industry: r.industry,
    previewImageKey: r.previewImageKey,
    version: r.version,
    isActive: r.isActive,
  }));
}

export async function listPlatformQuotaDefinitions(rt: Runtime) {
  const rows = await rt._db.db.select().from(schema.quotaDefinitions);
  return rows.map((r) => ({
    key: r.key,
    description: r.description,
    unit: r.unit,
    enforcement: r.enforcement,
    tierXs: r.tierXs,
    tierS: r.tierS,
    tierM: r.tierM,
    tierL: r.tierL,
  }));
}

export async function listPlatformFeatureFlags(rt: Runtime) {
  const rows = await rt._db.db.select().from(schema.featureFlags);
  return rows.map((r) => ({ key: r.key, defaultOn: r.defaultOn, killSwitch: r.killSwitch }));
}

/** Changes a global feature flag / kill switch. The change and its audit row are one transaction; unknown keys are refused. */
export async function updatePlatformFeatureFlag(
  rt: Runtime,
  staffUserId: string,
  input: { featureKey: string; defaultOn: boolean; killSwitch?: boolean | undefined },
  meta?: AuditMeta,
): Promise<{ ok: true }> {
  return rt._db.db.transaction(async (tx) => {
    const [before] = await tx.select().from(schema.featureFlags).where(eq(schema.featureFlags.key, input.featureKey)).for("update").limit(1);
    if (!before) throw new Error(`Not Found: feature flag not found: ${input.featureKey}`);

    await tx
      .update(schema.featureFlags)
      .set({
        defaultOn: input.defaultOn,
        ...(input.killSwitch !== undefined ? { killSwitch: input.killSwitch } : {}),
        updatedAt: sql`now()`,
      })
      .where(eq(schema.featureFlags.key, input.featureKey));

    await writePlatformAudit(tx, staffUserId, "feature_flag.update", "feature_flag", input.featureKey, null, {
      from: { defaultOn: before.defaultOn, killSwitch: before.killSwitch },
      to: { defaultOn: input.defaultOn, killSwitch: input.killSwitch ?? before.killSwitch },
    }, meta);
    return { ok: true as const };
  });
}

/**
 * Requests a custom domain for a store right after it was created for a client. Adding one talks to Cloudflare, so it
 * cannot be part of the store's database transaction: the outcome (including a refusal) is returned, never thrown, and a
 * successful request is audited.
 */
export async function requestCustomDomainForClient(
  rt: Runtime,
  staffUserId: string | undefined,
  tenantId: string,
  hostname: string,
): Promise<{ hostname: string; status: string; error: string | null }> {
  try {
    const dom = await addCustomDomain(rt, tenantId, { hostname });
    await rt._db.db.transaction((tx) =>
      writePlatformAudit(tx, staffUserId, "tenant.custom_domain_requested", "tenant", tenantId, tenantId, { hostname: dom.hostname, status: dom.status }),
    );
    return { hostname: dom.hostname, status: dom.status, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to add the custom domain";
    return { hostname: hostname.trim(), status: "not_added", error: message.replace(/^[A-Za-z ]+:\s*/, "") };
  }
}

/** Records that a staff member downloaded a store export. */
export async function recordExportDownload(
  rt: Runtime,
  staffUserId: string,
  file: { exportId: string; tenantId: string; sha256: string },
  meta?: AuditMeta,
): Promise<void> {
  await rt._db.db.transaction((tx) =>
    writePlatformAudit(tx, staffUserId, "tenant.export_downloaded", "export", file.exportId, file.tenantId, { sha256: file.sha256 }, meta),
  );
}
