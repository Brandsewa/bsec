/**
 * IndexNow sweep (docs/SEO-GEO-AEO-PLAN.md Phase 2) on real Postgres: enrolment sends nothing, a later change is sent once and only
 * for the store that changed, a failure keeps the watermark, and a hidden or non-live store is never contacted.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import pg from "pg";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import { indexNowKey, runIndexNowSweep } from "../src/storefront/indexnow.ts";
import { createActiveProduct } from "./helpers/factories.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let su: pg.Client;
const rand = Math.random().toString(36).slice(2, 7);
const hostLive = `indexnow-live-${rand}.example.test`;
const hostHidden = `indexnow-hidden-${rand}.example.test`;
const ENV = { INDEXNOW_ENABLED: "true", TENANT_SECRETS_KEY: "test-secret-for-indexnow" };
let live: { tenantId: string; ctx: TenantContext };
let hidden: { tenantId: string; ctx: TenantContext };

async function mkStore(name: string, host: string, mode: string) {
  const slug = `${name}-${rand}`;
  const t = await provisionTenant(rtPlatform, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  const ctx: TenantContext = { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
  await su.query("UPDATE domains SET is_primary = false WHERE tenant_id = $1", [t.tenantId]);
  await su.query("INSERT INTO domains (tenant_id, hostname, is_primary, status) VALUES ($1, $2, true, 'active')", [t.tenantId, host]);
  await su.query("INSERT INTO store_status (tenant_id, mode) VALUES ($1, $2) ON CONFLICT (tenant_id) DO UPDATE SET mode = EXCLUDED.mode", [t.tenantId, mode]);
  return { tenantId: t.tenantId, ctx };
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  su = new pg.Client({ connectionString: env.superUrl });
  await su.connect();
  live = await mkStore("inlive", hostLive, "live");
  hidden = await mkStore("inhidden", hostHidden, "coming_soon");
}, 240_000);

afterAll(async () => {
  await su?.end();
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

interface Call { url: string; body: { host: string; key: string; keyLocation: string; urlList: string[] } }

function fakeFetch(status = 200) {
  const calls: Call[] = [];
  const fn = (async (url: string, init: { body: string }) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(null, { status });
  }) as unknown as typeof fetch;
  return { calls, fn };
}

const tick = () => new Promise((r) => setTimeout(r, 25));
const mine = (calls: Call[], host: string) => calls.filter((c) => c.body.host === host);
const pingedAt = async (tenantId: string) => (await withTenant(rtWeb._db.db, tenantId, (tx) => tx.select({ at: schema.seoSettings.indexnowPingedAt }).from(schema.seoSettings).where(eq(schema.seoSettings.tenantId, tenantId))))[0]?.at ?? null;

describe("runIndexNowSweep", () => {
  it("does nothing unless INDEXNOW_ENABLED is true", async () => {
    const f = fakeFetch();
    const r = await runIndexNowSweep(rtWeb._db.db, { fetchFn: f.fn, env: { TENANT_SECRETS_KEY: "x" } });
    expect(r.stores).toBe(0);
    expect(f.calls).toHaveLength(0);
  });

  it("enrols a live store on its first sweep without sending anything, and never contacts a store that is not live", async () => {
    const f = fakeFetch();
    const r = await runIndexNowSweep(rtWeb._db.db, { fetchFn: f.fn, env: ENV });
    expect(r.enrolled).toBeGreaterThanOrEqual(1);
    expect(mine(f.calls, hostLive)).toHaveLength(0);
    expect(await pingedAt(live.tenantId)).not.toBeNull();
    expect(await pingedAt(hidden.tenantId)).toBeNull();
    expect(mine(f.calls, hostHidden)).toHaveLength(0);
  });

  it("sends only the pages that changed since the last sweep, with the store's own key, then stays quiet", async () => {
    await tick();
    await createActiveProduct(rtWeb, live.ctx, { title: "Indexnow Tea", sku: `IN-${rand}` });
    const f = fakeFetch();
    const r = await runIndexNowSweep(rtWeb._db.db, { fetchFn: f.fn, env: ENV });
    const sent = mine(f.calls, hostLive);
    expect(sent).toHaveLength(1);
    const key = indexNowKey(live.tenantId, ENV)!;
    expect(sent[0]!.body.key).toBe(key);
    expect(sent[0]!.body.keyLocation).toBe(`https://${hostLive}/${key}.txt`);
    expect(sent[0]!.body.urlList.some((u) => u.startsWith(`https://${hostLive}/products/`))).toBe(true);
    expect(sent[0]!.body.urlList.every((u) => u.startsWith(`https://${hostLive}`))).toBe(true);
    expect(r.notified).toBeGreaterThanOrEqual(1);
    expect(mine(f.calls, hostHidden)).toHaveLength(0);

    await tick();
    const again = fakeFetch();
    await runIndexNowSweep(rtWeb._db.db, { fetchFn: again.fn, env: ENV });
    expect(mine(again.calls, hostLive)).toHaveLength(0);
  });

  it("keeps the watermark when the search engine rejects the request, so the same pages are retried", async () => {
    await tick();
    await createActiveProduct(rtWeb, live.ctx, { title: "Indexnow Retry", sku: `INR-${rand}` });
    const before = await pingedAt(live.tenantId);
    const bad = fakeFetch(429);
    const r = await runIndexNowSweep(rtWeb._db.db, { fetchFn: bad.fn, env: ENV });
    expect(r.failed).toBeGreaterThanOrEqual(1);
    expect((await pingedAt(live.tenantId))?.getTime()).toBe(before?.getTime());
    const ok = fakeFetch();
    await runIndexNowSweep(rtWeb._db.db, { fetchFn: ok.fn, env: ENV });
    expect(mine(ok.calls, hostLive)[0]?.body.urlList.some((u) => u.includes("/products/"))).toBe(true);
  });
});
