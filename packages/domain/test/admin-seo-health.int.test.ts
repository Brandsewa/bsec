/**
 * getSeoHealth on real Postgres: counts are this store's only, permissions are enforced, and the report reflects real rows.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { STORE_PERMISSIONS } from "@bs/auth";
import { createRuntime, getSeoHealth, provisionTenant, type Runtime, type TenantContext } from "../src/index.ts";
import { createActiveProduct } from "./helpers/factories.ts";

let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let a: TenantContext;
let b: TenantContext;
const rand = Math.random().toString(36).slice(2, 7);

async function mk(name: string): Promise<TenantContext> {
  const slug = `${name}-${rand}`;
  const t = await provisionTenant(rtPlatform, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return { tenantId: t.tenantId, storeStatus: "live", actor: { type: "staff", userId: t.ownerId }, roles: ["store_owner"], permissions: [...STORE_PERMISSIONS], requestId: `req-${name}` };
}

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  a = await mk("seohealth-a");
  b = await mk("seohealth-b");
}, 240_000);

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("getSeoHealth", () => {
  it("counts products without a description or picture for this store only", async () => {
    await createActiveProduct(rtWeb, a, { title: "Plain tea", sku: `SH-A1-${rand}` });
    await createActiveProduct(rtWeb, a, { title: "Other tea", sku: `SH-A2-${rand}` });
    const ha = await getSeoHealth(rtWeb, a);
    const byId = Object.fromEntries(ha.checks.map((c) => [c.id, c]));
    expect(byId["product-description"]).toMatchObject({ status: "warn", count: 2 });
    expect(byId["product-image"]).toMatchObject({ status: "warn", count: 2 });
    // The other store has no products: nothing leaks across.
    const hb = await getSeoHealth(rtWeb, b);
    const byIdB = Object.fromEntries(hb.checks.map((c) => [c.id, c]));
    expect(byIdB["product-description"]).toMatchObject({ status: "ok" });
    expect(byIdB["product-description"]!.count).toBeUndefined();
  });

  it("reports a store that is not live as failing visibility", async () => {
    const h = await getSeoHealth(rtWeb, a);
    // A freshly provisioned store has not gone live.
    expect(h.checks.find((c) => c.id === "visibility")?.status).toBe("fail");
    expect(h.indexablePageCount).toBeGreaterThanOrEqual(0);
  });

  it("requires settings.read", async () => {
    await expect(getSeoHealth(rtWeb, { ...a, permissions: [] })).rejects.toThrow();
  });
});
