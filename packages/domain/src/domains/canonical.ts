/**
 * One address per store (ADR-051 follow-up): when a store has several of its own domains (for example `shop.com` and
 * `www.shop.com`), every request on a domain that is not the primary one is redirected to the primary one, so search engines and
 * shoppers see a single address. The store's platform address (`<store>.bcom.si`) is never redirected, because merchants use it to
 * preview and share before their own domain works.
 */
import type { Db } from "@bs/db";
import { schema } from "@bs/db";
import { and, eq } from "drizzle-orm";
import { normalizeHost } from "../host-resolver.ts";

export interface DomainRow {
  hostname: string;
  type: string;
  status: string;
  isPrimary: boolean;
}

const LIVE = new Set(["active", "degraded"]);

/**
 * Pure rule: the hostname `requested` should be redirected to, or null. `all` is every domain of the same store.
 * Needs the requested domain to be one of the store's own live custom domains and a different live custom domain to be primary.
 */
export function canonicalHostFor(requested: string, all: readonly DomainRow[]): string | null {
  const host = normalizeHost(requested);
  const current = all.find((d) => normalizeHost(d.hostname) === host);
  if (!current || current.type !== "custom" || !LIVE.has(current.status)) return null;
  const primary = all.find((d) => d.isPrimary);
  if (!primary || primary.type !== "custom" || !LIVE.has(primary.status)) return null;
  return normalizeHost(primary.hostname) === host ? null : normalizeHost(primary.hostname);
}

const TTL_MS = 30_000;
const cache = new Map<string, { at: number; to: string | null }>();

/** Cached per process for 30 seconds, like the host lookup it sits next to. */
export async function findCanonicalHost(db: Db, requested: string): Promise<string | null> {
  const host = normalizeHost(requested);
  const hit = cache.get(host);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.to;
  const [row] = await db.select({ tenantId: schema.domains.tenantId, type: schema.domains.type }).from(schema.domains).where(eq(schema.domains.hostname, host)).limit(1);
  let to: string | null = null;
  if (row && row.type === "custom") {
    const siblings = await db
      .select({ hostname: schema.domains.hostname, type: schema.domains.type, status: schema.domains.status, isPrimary: schema.domains.isPrimary })
      .from(schema.domains)
      .where(and(eq(schema.domains.tenantId, row.tenantId), eq(schema.domains.type, "custom")));
    to = canonicalHostFor(host, siblings);
  }
  cache.set(host, { at: Date.now(), to });
  return to;
}

export function clearCanonicalHostCache(): void {
  cache.clear();
}
