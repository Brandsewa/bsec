import type { Db } from "@bs/db";
import { schema } from "@bs/db";
import { eq } from "drizzle-orm";
import type { StoreStatus } from "./context.ts";

export interface HostResolution {
  tenantId: string;
  storeStatus: StoreStatus;
}

interface CacheEntry {
  resolution: HostResolution;
  expiresAt: number;
}

const CACHE_TTL_MS = 60_000; // 60s cached host->tenant map per PLAN §4
const hostCache = new Map<string, CacheEntry>();

export function normalizeHost(host: string): string {
  const colonIndex = host.indexOf(":");
  const hostname = colonIndex === -1 ? host : host.slice(0, colonIndex);
  return hostname.trim().toLowerCase();
}

/**
 * Invalidates the in-memory host resolution cache.
 * If host is specified, only that host entry is removed.
 * If omitted, the entire host cache is cleared.
 */
export function invalidateHostCache(host?: string): void {
  if (host) {
    hostCache.delete(normalizeHost(host));
  } else {
    hostCache.clear();
  }
}

/**
 * Resolves a hostname (from Host header) to an active tenant (PLAN §4, §5.1).
 * Uses a 60s in-memory cache to minimize database roundtrips.
 */
export async function resolveHostToTenant(
  db: Db,
  rawHost: string,
): Promise<HostResolution | null> {
  const host = normalizeHost(rawHost);
  const now = Date.now();
  const cached = hostCache.get(host);
  if (cached && cached.expiresAt > now) {
    return cached.resolution;
  }

  const rows = await db
    .select({
      tenantId: schema.domains.tenantId,
      domainStatus: schema.domains.status,
      tenantStatus: schema.tenants.status,
    })
    .from(schema.domains)
    .innerJoin(schema.tenants, eq(schema.domains.tenantId, schema.tenants.id))
    .where(eq(schema.domains.hostname, host))
    .limit(1);

  const row = rows[0];
  if (!row || row.domainStatus !== "active") {
    return null;
  }

  let storeStatus: StoreStatus = "live";
  if (row.tenantStatus === "suspended") {
    storeStatus = "maintenance";
  } else if (row.tenantStatus !== "active" && row.tenantStatus !== "trial") {
    return null;
  }

  const resolution: HostResolution = {
    tenantId: row.tenantId,
    storeStatus,
  };

  hostCache.set(host, {
    resolution,
    expiresAt: now + CACHE_TTL_MS,
  });

  return resolution;
}
