import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertCustomDomainQuota } from "../system/quotas.ts";
import { isDomainManagementAllowed } from "../system/tenant-lifecycle.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import {
  type CustomDomainProvider,
  CloudflareCustomDomainProvider,
} from "./provider.ts";

export interface CustomDomainRecord {
  id: string;
  tenantId: string;
  hostname: string;
  type: string;
  isPrimary: boolean;
  status: string;
  sslStatus: string | null;
  prevalidateTxt: boolean | null;
  cfCustomHostnameId: string | null;
  verification: {
    cname?: string;
    txt?: { name: string; value: string };
  } | null;
  createdAt: Date;
  updatedAt: Date;
}

const FQDN_PATTERN = /^(?!:\/\/)([a-zA-Z0-9-]+\.)+[a-zA-Z]{2,}$/;

/**
 * Normalizes and validates custom hostname input.
 */
export function normalizeCustomHostname(raw: string): string {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/\/.*$/, "");
  h = h.replace(/:\d+$/, "");

  if (!FQDN_PATTERN.test(h)) {
    throw new Error(`Bad Request: Invalid domain name format: '${raw}'. Please enter a valid fully-qualified domain name (e.g. store.mydomain.com).`);
  }

  // The platform's own domain, its subdomains and the admin/marketing hosts can never be claimed by a store.
  const platformDomain = (process.env.PLATFORM_DOMAIN?.trim() || "bcom.si").toLowerCase();
  const reservedExact = [process.env.ADMIN_HOST, process.env.MARKETING_HOST]
    .map((v) => v?.trim().toLowerCase().replace(/:\d+$/, ""))
    .filter((v): v is string => Boolean(v));
  if (h === platformDomain || h.endsWith(`.${platformDomain}`) || reservedExact.includes(h)) {
    throw new Error(`Bad Request: Platform hosts (${platformDomain} and its subdomains) cannot be added as custom domains.`);
  }

  return h;
}

/**
 * Lists all active and configured domains for a tenant.
 */
export async function listTenantDomains(
  rt: Runtime,
  ctxOrTenantId: TenantContext | string,
): Promise<CustomDomainRecord[]> {
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "settings.read");
  }
  return listTenantDomainsInternal(rt, tenantId);
}

export async function listTenantDomainsInternal(
  rt: Runtime,
  tenantId: string,
): Promise<CustomDomainRecord[]> {
  const db = rt._db.db;

  const rows = await db
    .select()
    .from(schema.domains)
    .where(
      and(
        eq(schema.domains.tenantId, tenantId),
        ne(schema.domains.status, "removed"),
      ),
    )
    .orderBy(schema.domains.createdAt);

  return rows as CustomDomainRecord[];
}

async function writeDomainAudit(
  rt: Runtime,
  ctxOrTenantId: TenantContext | string,
  log: {
    action: string;
    targetId: string;
    diff: Record<string, unknown>;
  },
) {
  if (typeof ctxOrTenantId === "string") return;
  const ctx = ctxOrTenantId;
  await withTenant(rt._db.db, ctx.tenantId, async (tx) => {
    await tx.insert(schema.auditLogs).values({
      tenantId: ctx.tenantId,
      actorType: ctx.actor.type,
      actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: log.action,
      targetType: "custom_domain",
      targetId: log.targetId,
      diff: log.diff,
    });
  });
}

/**
 * Adds a custom domain to a tenant store (PLAN §8, ADR-007, ADR-017).
 * Enforces custom_domains quota, verifies hostname uniqueness, and registers with Cloudflare for SaaS adapter.
 */
export async function addCustomDomain(
  rt: Runtime,
  ctxOrTenantId: TenantContext | string,
  input: {
    hostname: string;
    prevalidateTxt?: boolean;
    provider?: CustomDomainProvider;
  },
): Promise<CustomDomainRecord> {
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "domains.manage");
  }

  const inserted = await addCustomDomainInternal(rt, tenantId, input);

  await writeDomainAudit(rt, ctxOrTenantId, {
    action: "domain.add",
    targetId: inserted.id,
    diff: {
      hostname: { before: null, after: inserted.hostname },
      type: { before: null, after: inserted.type },
      status: { before: null, after: inserted.status },
    },
  });

  return inserted;
}

export async function addCustomDomainInternal(
  rt: Runtime,
  tenantId: string,
  input: {
    hostname: string;
    prevalidateTxt?: boolean;
    provider?: CustomDomainProvider;
  },
): Promise<CustomDomainRecord> {
  const db = rt._db.db;
  const hostname = normalizeCustomHostname(input.hostname);
  const provider = input.provider ?? new CloudflareCustomDomainProvider();

  // 0. Lifecycle (PLAN §6.4): domains can only be added while the store is fully live
  const [tenantRow] = await db.select({ status: schema.tenants.status }).from(schema.tenants).where(eq(schema.tenants.id, tenantId)).limit(1);
  if (tenantRow && !isDomainManagementAllowed(tenantRow.status)) {
    throw new Error(`Forbidden: custom domains cannot be added while the store is '${tenantRow.status}'`);
  }

  // 1. Quota Enforcement (PLAN §6.1)
  await assertCustomDomainQuota(db, tenantId);

  // 2. Hostname Uniqueness Check
  const [existing] = await db
    .select()
    .from(schema.domains)
    .where(
      and(
        eq(schema.domains.hostname, hostname),
        ne(schema.domains.status, "removed"),
      ),
    )
    .limit(1);

  if (existing) {
    throw new Error(`Conflict: Domain '${hostname}' is already registered or connected to a store.`);
  }

  // 3. Register with Provider Adapter
  const cfResult = await provider.createCustomHostname(hostname, {
    ...(input.prevalidateTxt !== undefined ? { prevalidate: input.prevalidateTxt } : {}),
  });

  const domainId = randomUUID();
  const isUnconfigured =
    cfResult.status === "requested" ||
    cfResult.sslStatus === "not_configured" ||
    Boolean(provider.isConfigured && !provider.isConfigured());

  const verificationPayload =
    isUnconfigured || !cfResult.cnameTarget
      ? null
      : {
          cname: cfResult.cnameTarget,
          ...(cfResult.txtVerification ? { txt: cfResult.txtVerification } : {}),
        };

  // 4. Insert into domains table
  const [inserted] = await db
    .insert(schema.domains)
    .values({
      id: domainId,
      tenantId,
      hostname,
      type: "custom",
      status: isUnconfigured ? "requested" : cfResult.status,
      sslStatus: isUnconfigured ? "not_configured" : cfResult.sslStatus,
      isPrimary: false,
      prevalidateTxt: Boolean(input.prevalidateTxt),
      cfCustomHostnameId: isUnconfigured ? null : cfResult.providerHostnameId,
      verification: verificationPayload,
    })
    .returning();

  return inserted as CustomDomainRecord;
}

/**
 * Checks verification and TLS status with Cloudflare for a custom domain (PLAN §8, ADR-017).
 */
export async function verifyCustomDomain(
  rt: Runtime,
  ctxOrTenantId: TenantContext | string,
  domainId: string,
  providerOverride?: CustomDomainProvider,
): Promise<CustomDomainRecord> {
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "domains.manage");
  }

  const { domain, updated, nextStatus, statusRes } = await verifyCustomDomainInternal(
    rt,
    tenantId,
    domainId,
    providerOverride,
  );

  if (updated) {
    await writeDomainAudit(rt, ctxOrTenantId, {
      action: "domain.verify",
      targetId: updated.id,
      diff: {
        status: { before: domain.status, after: nextStatus },
        sslStatus: { before: domain.sslStatus, after: statusRes.sslStatus },
      },
    });
  }

  return updated;
}

export async function verifyCustomDomainInternal(
  rt: Runtime,
  tenantId: string,
  domainId: string,
  providerOverride?: CustomDomainProvider,
): Promise<{
  domain: typeof schema.domains.$inferSelect;
  updated: CustomDomainRecord;
  nextStatus: string;
  statusRes: { status: string; sslStatus?: string | null };
}> {
  const db = rt._db.db;
  const provider = providerOverride ?? new CloudflareCustomDomainProvider();

  const [domain] = await db
    .select()
    .from(schema.domains)
    .where(
      and(
        eq(schema.domains.id, domainId),
        eq(schema.domains.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!domain) {
    throw new Error("Not Found: Domain not found or access denied.");
  }

  if (domain.type === "platform_subdomain" || domain.type === "subdomain") {
    throw new Error("Bad Request: Cannot verify or modify the default platform subdomain.");
  }

  if (domain.type !== "custom" || !domain.cfCustomHostnameId) {
    return {
      domain,
      updated: domain as CustomDomainRecord,
      nextStatus: domain.status,
      statusRes: { status: domain.status, sslStatus: domain.sslStatus },
    };
  }

  const statusRes = await provider.getCustomHostnameStatus(domain.cfCustomHostnameId);

  // State machine: requested -> awaiting_dns -> verifying -> ssl_pending -> active.
  const rank: Record<string, number> = { requested: 0, awaiting_dns: 1, verifying: 2, ssl_pending: 3, active: 4 };
  const currentRank = rank[domain.status] ?? -1;
  const nextRank = rank[statusRes.status] ?? -1;
  const nextStatus = statusRes.status === "failed" || nextRank >= currentRank ? statusRes.status : domain.status;

  const [updated] = await db
    .update(schema.domains)
    .set({
      status: nextStatus,
      sslStatus: statusRes.sslStatus,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.domains.id, domain.id))
    .returning();

  // If verified and active, mark onboarding checklist step complete
  if (nextStatus === "active") {
    await db.execute(sql`
      UPDATE onboarding_progress
      SET steps = jsonb_set(steps, '{domain_connected}', 'true'::jsonb),
          updated_at = now()
      WHERE tenant_id = ${tenantId};
    `);
  }

  return {
    domain,
    updated: updated as CustomDomainRecord,
    nextStatus,
    statusRes,
  };
}

/**
 * Sets an active domain as the store's primary domain (PLAN §8).
 * INVARIANT: Only domains with status = 'active' can be designated as primary.
 */
export async function setPrimaryDomain(
  rt: Runtime,
  ctxOrTenantId: TenantContext | string,
  domainId: string,
): Promise<{ success: boolean; primaryHostname: string }> {
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "domains.manage");
  }

  return setPrimaryDomainInternal(
    rt,
    tenantId,
    domainId,
    typeof ctxOrTenantId !== "string" ? ctxOrTenantId : undefined,
  );
}

export async function setPrimaryDomainInternal(
  rt: Runtime,
  tenantId: string,
  domainId: string,
  ctx?: TenantContext,
): Promise<{ success: boolean; primaryHostname: string }> {
  const db = rt._db.db;

  const [domain] = await db
    .select()
    .from(schema.domains)
    .where(
      and(
        eq(schema.domains.id, domainId),
        eq(schema.domains.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!domain) {
    throw new Error("Not Found: Domain not found or access denied.");
  }

  // PLAN §8 Invariant: Only active domains can be primary
  if (domain.status !== "active") {
    throw new Error(
      `Cannot set '${domain.hostname}' as primary: domain status is '${domain.status}'. Only active, verified domains can be designated as primary.`,
    );
  }

  // Atomic primary switch
  await withTenant(db, tenantId, async (tx) => {
    // 1. Remove primary status from all other domains for this tenant
    await tx
      .update(schema.domains)
      .set({ isPrimary: false, updatedAt: new Date() })
      .where(eq(schema.domains.tenantId, tenantId));

    // 2. Set this domain as primary
    await tx
      .update(schema.domains)
      .set({ isPrimary: true, updatedAt: new Date() })
      .where(eq(schema.domains.id, domain.id));

    // 3. Write audit log
    if (ctx) {
      await tx.insert(schema.auditLogs).values({
        tenantId,
        actorType: ctx.actor.type,
        actorId: ctx.actor.type === "staff" ? ctx.actor.userId : null,
        action: "domain.set_primary",
        targetType: "custom_domain",
        targetId: domain.id,
        diff: {
          isPrimary: { before: false, after: true },
          hostname: { before: null, after: domain.hostname },
        },
      });
    }
  });

  return { success: true, primaryHostname: domain.hostname };
}

/**
 * Removes a custom domain and reassigns primary if needed (PLAN §8).
 */
export async function removeCustomDomain(
  rt: Runtime,
  ctxOrTenantId: TenantContext | string,
  domainId: string,
  providerOverride?: CustomDomainProvider,
): Promise<{ success: boolean }> {
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "domains.manage");
  }

  const { domain } = await removeCustomDomainInternal(rt, tenantId, domainId, providerOverride);

  await writeDomainAudit(rt, ctxOrTenantId, {
    action: "domain.remove",
    targetId: domain.id,
    diff: {
      hostname: { before: domain.hostname, after: null },
      isPrimary: { before: domain.isPrimary, after: false },
    },
  });

  return { success: true };
}

export async function removeCustomDomainInternal(
  rt: Runtime,
  tenantId: string,
  domainId: string,
  providerOverride?: CustomDomainProvider,
): Promise<{ domain: typeof schema.domains.$inferSelect; success: boolean }> {
  const db = rt._db.db;
  const provider = providerOverride ?? new CloudflareCustomDomainProvider();

  const [domain] = await db
    .select()
    .from(schema.domains)
    .where(
      and(
        eq(schema.domains.id, domainId),
        eq(schema.domains.tenantId, tenantId),
      ),
    )
    .limit(1);

  if (!domain) {
    throw new Error("Not Found: Domain not found or access denied.");
  }

  if (domain.type === "platform_subdomain" || domain.type === "subdomain") {
    throw new Error("Bad Request: Cannot remove the default platform subdomain for the store.");
  }

  // If this was primary, revert primary status back to platform subdomain
  if (domain.isPrimary) {
    const [subdomain] = await db
      .select()
      .from(schema.domains)
      .where(
        and(
          eq(schema.domains.tenantId, tenantId),
          sql`type IN ('platform_subdomain', 'subdomain')`,
        ),
      )
      .limit(1);

    if (subdomain) {
      await db
        .update(schema.domains)
        .set({ isPrimary: true, updatedAt: new Date() })
        .where(eq(schema.domains.id, subdomain.id));
    }
  }

  // Delete from Cloudflare
  if (domain.cfCustomHostnameId) {
    try {
      await provider.deleteCustomHostname(domain.cfCustomHostnameId);
    } catch {
      // Non-fatal if already removed upstream
    }
  }

  // Delete record from domains
  await db.delete(schema.domains).where(eq(schema.domains.id, domain.id));

  return { domain, success: true };
}
