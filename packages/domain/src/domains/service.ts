import { randomUUID } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import { assertCustomDomainQuota } from "../system/quotas.ts";
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

const FQDN_PATTERN = /^(?!:\/\/)([a-zA-Z0-9-_]+\.)+[a-zA-Z]{2,}$/;

/**
 * Normalizes and validates custom hostname input.
 */
export function normalizeCustomHostname(raw: string): string {
  let h = raw.trim().toLowerCase();
  h = h.replace(/^https?:\/\//, "");
  h = h.replace(/\/.*$/, "");
  h = h.replace(/:\d+$/, "");

  if (!FQDN_PATTERN.test(h)) {
    throw new Error(`Invalid domain name format: '${raw}'. Please enter a valid fully-qualified domain name (e.g. store.mydomain.com).`);
  }

  if (h === "gobs.cloud" || h.endsWith(".gobs.cloud")) {
    throw new Error(`Platform root and subdomains (*.gobs.cloud) cannot be added as custom domains.`);
  }

  return h;
}

/**
 * Lists all active and configured domains for a tenant.
 */
export async function listTenantDomains(
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

/**
 * Adds a custom domain to a tenant store (PLAN §8, ADR-007, ADR-017).
 * Enforces custom_domains quota, verifies hostname uniqueness, and registers with Cloudflare for SaaS adapter.
 */
export async function addCustomDomain(
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
    throw new Error(`Domain '${hostname}' is already registered or connected to a store.`);
  }

  // 3. Register with Provider Adapter
  const cfResult = await provider.createCustomHostname(hostname, {
    ...(input.prevalidateTxt !== undefined ? { prevalidate: input.prevalidateTxt } : {}),
  });

  const domainId = randomUUID();
  const verificationPayload = {
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
      status: cfResult.status,
      sslStatus: cfResult.sslStatus,
      isPrimary: false,
      prevalidateTxt: Boolean(input.prevalidateTxt),
      cfCustomHostnameId: cfResult.providerHostnameId,
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
  tenantId: string,
  domainId: string,
  providerOverride?: CustomDomainProvider,
): Promise<CustomDomainRecord> {
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
    throw new Error("Domain not found or access denied.");
  }

  if (domain.type !== "custom" || !domain.cfCustomHostnameId) {
    return domain as CustomDomainRecord;
  }

  const statusRes = await provider.getCustomHostnameStatus(domain.cfCustomHostnameId);

  const [updated] = await db
    .update(schema.domains)
    .set({
      status: statusRes.status,
      sslStatus: statusRes.sslStatus,
      lastCheckedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(schema.domains.id, domain.id))
    .returning();

  // If verified and active, mark onboarding checklist step complete
  if (statusRes.status === "active") {
    await db.execute(sql`
      UPDATE onboarding_progress
      SET steps = jsonb_set(steps, '{domain_connected}', 'true'::jsonb),
          updated_at = now()
      WHERE tenant_id = ${tenantId};
    `);
  }

  return updated as CustomDomainRecord;
}

/**
 * Sets an active domain as the store's primary domain (PLAN §8).
 * INVARIANT: Only domains with status = 'active' can be designated as primary.
 */
export async function setPrimaryDomain(
  rt: Runtime,
  tenantId: string,
  domainId: string,
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
    throw new Error("Domain not found or access denied.");
  }

  // PLAN §8 Invariant: Only active domains can be primary
  if (domain.status !== "active") {
    throw new Error(
      `Cannot set '${domain.hostname}' as primary: domain status is '${domain.status}'. Only active, verified domains can be designated as primary.`,
    );
  }

  // Atomic primary switch
  await db.transaction(async (tx) => {
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
  });

  return { success: true, primaryHostname: domain.hostname };
}

/**
 * Removes a custom domain and reassigns primary if needed (PLAN §8).
 */
export async function removeCustomDomain(
  rt: Runtime,
  tenantId: string,
  domainId: string,
  providerOverride?: CustomDomainProvider,
): Promise<{ success: boolean }> {
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
    throw new Error("Domain not found or access denied.");
  }

  if (domain.type === "platform_subdomain" || domain.type === "subdomain") {
    throw new Error("Cannot remove the default platform subdomain for the store.");
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

  return { success: true };
}
