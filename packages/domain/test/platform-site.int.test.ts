import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  archivePlatformTenant,
  bulkSuspendPlatformTenants,
  changePlatformTenantPlan,
  createRuntime,
  enablePlatformSite,
  evaluateStorefrontAccess,
  getPlatformOverviewMetrics,
  getPlatformTenant,
  getPlatformTenantDetail,
  getPlatformSiteId,
  grantPromotion,
  listPages,
  listPlatformTenants,
  platformSiteContext,
  previewPlatformReset,
  provisionTenant,
  publishDueBlogPosts,
  runBillingDunningSweep,
  scheduleTenantDeletion,
  startSupportSession,
  suspendPlatformTenant,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtRw: Runtime;
let staffId: string;
let siteId: string;
let store: { tenantId: string; ownerId: string; slug: string };

const page = (tenantId: string, slug: string) => ({ tenantId, title: slug, slug, status: "published" as const });

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtRw = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 2 });
  staffId = (await seedPlatformStaff(rt._db.db, { email: "site-owner@platform.test", role: "platform_owner" })).userId;
  const slug = "real-store";
  const r = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  store = { tenantId: r.tenantId, ownerId: r.ownerId, slug };
  siteId = (await enablePlatformSite(rt, staffId)).siteId;
}, 120_000);

afterAll(async () => {
  await rt?.close?.();
  await rtRw?.close?.();
  await env?.stop();
});

describe("platform site record", () => {
  it("is created once, with no owner, plan or trial", async () => {
    expect((await enablePlatformSite(rt, staffId)).siteId).toBe(siteId);
    const rows = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.kind, "platform_site"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ ownerUserId: null, planId: null, trialEndsAt: null, status: "active" });
    expect(await getPlatformSiteId(rt._db.db)).toBe(siteId);
  });

  it("the database refuses a second one", async () => {
    await expect(rt._db.db.insert(schema.tenants).values({ slug: "second-site", name: "x", kind: "platform_site" })).rejects.toThrow();
  });

  it("writes one audit row", async () => {
    const rows = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_site.create"));
    expect(rows).toHaveLength(1);
  });

  it("is not reachable by host: it has no domain row", async () => {
    const domains = await rt._db.db.select().from(schema.domains).where(eq(schema.domains.tenantId, siteId));
    expect(domains).toHaveLength(0);
    expect((await evaluateStorefrontAccess(rt, "bcom-platform-site.bcom.si")).tenantId).toBeUndefined();
  });
});

describe("hidden from store screens", () => {
  it("does not appear in lists, detail or the reset preview", async () => {
    const listed = await listPlatformTenants(rt);
    expect(listed.some((t) => t.id === siteId)).toBe(false);
    expect(listed.some((t) => t.id === store.tenantId)).toBe(true);
    await expect(getPlatformTenant(rt, siteId)).rejects.toThrow(/not found/i);
    await expect(getPlatformTenantDetail(rt, staffId, siteId)).rejects.toThrow(/not found/i);
    expect((await previewPlatformReset(rt, staffId)).stores.some((s) => s.id === siteId)).toBe(false);
  });

  it("does not count in overview metrics", async () => {
    const before = await getPlatformOverviewMetrics(rt, staffId);
    await rt._db.db.update(schema.tenants).set({ kind: "store" }).where(eq(schema.tenants.id, siteId));
    const counted = await getPlatformOverviewMetrics(rt, staffId);
    await rt._db.db.update(schema.tenants).set({ kind: "platform_site" }).where(eq(schema.tenants.id, siteId));
    expect(JSON.stringify(counted)).not.toEqual(JSON.stringify(before));
  });
});

describe("store actions refuse it", () => {
  const refused = /platform's own website/;

  it("suspend, archive, plan change and bulk actions", async () => {
    await expect(suspendPlatformTenant(rt, staffId, siteId, "x")).rejects.toThrow(refused);
    await expect(archivePlatformTenant(rt, staffId, siteId)).rejects.toThrow(refused);
    await expect(changePlatformTenantPlan(rt, staffId, siteId, "starter")).rejects.toThrow(refused);
    await expect(bulkSuspendPlatformTenants(rt, staffId, [store.tenantId, siteId], "x", "SUSPEND 2")).rejects.toThrow(refused);
    expect((await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, store.tenantId)))[0]?.status).not.toBe("suspended");
  });

  it("deletion, promotions and support sessions", async () => {
    await expect(scheduleTenantDeletion(rt, staffId, { tenantId: siteId, confirmSlug: "bcom-platform-site" })).rejects.toThrow(refused);
    await expect(grantPromotion(rt, staffId, { tenantId: siteId, custom: { name: "x", percentOff: 10 }, termMonths: 6 } as never)).rejects.toThrow(refused);
    await expect(startSupportSession(rt, staffId, { tenantId: siteId, reason: "x", ticketRef: "T-1", consent: "standing_consent" } as never)).rejects.toThrow(refused);
  });
});

describe("jobs", () => {
  it("the dunning sweep leaves it untouched", async () => {
    await runBillingDunningSweep(rt);
    expect((await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, siteId)))[0]?.status).toBe("active");
  });

  it("the scheduled post job still publishes its posts", async () => {
    await withTenant(rtRw._db.db, siteId, (tx) =>
      tx.insert(schema.blogPosts).values({ tenantId: siteId, title: "Due", slug: "due", contentHtml: "<p>x</p>", contentText: "x", status: "scheduled", publishedAt: new Date(Date.now() - 60_000) }),
    );
    await publishDueBlogPosts(rtRw._db.db);
    const rows = await withTenant(rtRw._db.db, siteId, (tx) => tx.select().from(schema.blogPosts));
    expect(rows.find((r) => r.slug === "due")?.status).toBe("published");
  });
});

describe("Marketing runs under RLS", () => {
  it("the unfiltered pages service returns only the website's rows on app_rw", async () => {
    await withTenant(rtRw._db.db, siteId, (tx) => tx.insert(schema.pages).values(page(siteId, "site-only") as never));
    await withTenant(rtRw._db.db, store.tenantId, (tx) => tx.insert(schema.pages).values(page(store.tenantId, "store-only") as never));
    const rows = (await listPages(rtRw, platformSiteContext(siteId, staffId))) as Array<{ slug: string }>;
    expect(rows.some((r) => r.slug === "site-only")).toBe(true);
    expect(rows.some((r) => r.slug === "store-only")).toBe(false);
  });

  it("the same service on the bypass role would leak, which is why it is not used", async () => {
    const rows = (await listPages(rt, platformSiteContext(siteId, staffId))) as Array<{ slug: string }>;
    expect(rows.some((r) => r.slug === "store-only")).toBe(true);
  });

  it("the context holds only what content needs", () => {
    expect(platformSiteContext(siteId, staffId).permissions).toEqual(["content.write", "theme.publish"]);
  });
});
