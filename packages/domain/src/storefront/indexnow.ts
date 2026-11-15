/**
 * IndexNow (docs/SEO-GEO-AEO-PLAN.md Phase 2): tells Bing and the other IndexNow search engines which of a store's pages changed,
 * so new and edited products, posts and pages are crawled in minutes instead of days. Bing's index also feeds ChatGPT search.
 *
 * How it stays safe:
 * - Off unless INDEXNOW_ENABLED=true, so staging, preview and local stacks never contact anyone. Production turns it on explicitly.
 * - Only stores that are live and indexable are notified, only for URLs the sitemap already lists, and only pages that changed
 *   since the last sweep (a store is "enrolled" on its first sweep without sending its whole catalogue).
 * - The key is derived from the server's secret and the tenant id: nothing is stored, nothing is shared between stores, and the
 *   key file is served by the store's own host (the protocol proves ownership that way).
 * - A failure leaves the watermark where it was, so the next sweep retries the same pages.
 */
import { createHmac } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { schema, withTenant, type Db } from "@bs/db";
import type { Runtime } from "../runtime.ts";
import type { TenantContext } from "../context.ts";
import { evaluateStorefrontAccess } from "./lifecycle.ts";
import { getStorefrontSitemapUrls } from "./seo.ts";

export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/IndexNow";
/** The protocol allows 10,000 URLs per request; a sweep sends at most this many per store. */
export const INDEXNOW_MAX_URLS = 500;

export function indexNowEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env["INDEXNOW_ENABLED"] === "true";
}

/** A tenant's IndexNow key: 32 hex characters derived from the server secret, or null when no secret is configured. */
export function indexNowKey(tenantId: string, env: Record<string, string | undefined> = process.env): string | null {
  const secret = env["TENANT_SECRETS_KEY"] ?? env["ENCRYPTION_KEY"];
  if (!secret) return null;
  return createHmac("sha256", secret).update(`indexnow:${tenantId}`).digest("hex").slice(0, 32);
}

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/** URLs of the sitemap items that changed after `since`. Items with no known modification time are never sent. */
export function changedUrls(items: Array<{ loc: string; lastmod?: string | undefined }>, since: Date, host: string): string[] {
  const out: string[] = [];
  for (const i of items) {
    if (!i.lastmod) continue;
    const t = Date.parse(i.lastmod);
    if (!Number.isFinite(t) || t <= since.getTime()) continue;
    let u: URL;
    try {
      u = new URL(i.loc);
    } catch {
      continue;
    }
    if (u.hostname !== host) continue; // the protocol only accepts URLs on the host being notified
    out.push(i.loc);
  }
  return [...new Set(out)].slice(0, INDEXNOW_MAX_URLS);
}

export function buildIndexNowPayload(host: string, key: string, urls: string[]): IndexNowPayload {
  return { host, key, keyLocation: `https://${host}/${key}.txt`, urlList: urls };
}

export interface IndexNowSweepResult {
  stores: number;
  enrolled: number;
  notified: number;
  urls: number;
  skipped: number;
  failed: number;
}

/**
 * One pass over every store. `fetchFn` is injectable for tests. Never throws for a single store's failure: that store is counted
 * as failed and keeps its watermark, so it is retried on the next sweep while the others carry on.
 */
export async function runIndexNowSweep(
  db: Db,
  opts: { fetchFn?: typeof fetch; now?: Date; env?: Record<string, string | undefined>; log?: { warn: (o: object, m: string) => void } } = {},
): Promise<IndexNowSweepResult> {
  const env = opts.env ?? process.env;
  const result: IndexNowSweepResult = { stores: 0, enrolled: 0, notified: 0, urls: 0, skipped: 0, failed: 0 };
  if (!indexNowEnabled(env)) return result;
  const fetchFn = opts.fetchFn ?? fetch;
  const now = opts.now ?? new Date();
  const rt = { _db: { db } } as unknown as Runtime;

  const stores = await db
    .select({ tenantId: schema.domains.tenantId, hostname: schema.domains.hostname })
    .from(schema.domains)
    .where(sql`${schema.domains.isPrimary} = true AND ${schema.domains.status} = 'active'`);

  for (const store of stores) {
    result.stores++;
    try {
      const key = indexNowKey(store.tenantId, env);
      if (!key) {
        result.skipped++;
        continue;
      }
      const access = await evaluateStorefrontAccess(db, store.hostname, { headers: new Headers() });
      if (!access.tenantId || access.tenantId !== store.tenantId || access.noindex === true || (access.mode && access.mode !== "live")) {
        result.skipped++;
        continue;
      }

      const since = await withTenant(db, store.tenantId, async (tx) => {
        const [row] = await tx.select({ at: schema.seoSettings.indexnowPingedAt }).from(schema.seoSettings).where(eq(schema.seoSettings.tenantId, store.tenantId)).limit(1);
        return row ? { exists: true, at: row.at } : { exists: false, at: null };
      });
      const save = (at: Date) =>
        withTenant(db, store.tenantId, async (tx) => {
          await tx
            .insert(schema.seoSettings)
            .values({ tenantId: store.tenantId, indexnowPingedAt: at })
            .onConflictDoUpdate({ target: schema.seoSettings.tenantId, set: { indexnowPingedAt: at } });
        });

      if (!since.at) {
        // First sweep for this store: remember the moment, send nothing (the sitemap already tells engines what exists).
        await save(now);
        result.enrolled++;
        continue;
      }

      const ctx: TenantContext = { tenantId: store.tenantId, storeStatus: "live", actor: { type: "system" }, roles: ["store_admin"], permissions: ["products.read", "content.write"], requestId: crypto.randomUUID() };
      const items = await getStorefrontSitemapUrls(rt, ctx, store.hostname);
      const urls = changedUrls(items, since.at, store.hostname);
      if (urls.length === 0) {
        await save(now);
        continue;
      }

      const res = await fetchFn(env["INDEXNOW_ENDPOINT"] ?? INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(buildIndexNowPayload(store.hostname, key, urls)),
        signal: AbortSignal.timeout(10_000),
      });
      // 200 and 202 are success (202: accepted, key validation pending).
      if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow answered ${res.status}`);
      await save(now);
      result.notified++;
      result.urls += urls.length;
    } catch (err) {
      result.failed++;
      opts.log?.warn({ err, tenantId: store.tenantId }, "indexnow: store notification failed, will retry on the next sweep");
    }
  }
  return result;
}
