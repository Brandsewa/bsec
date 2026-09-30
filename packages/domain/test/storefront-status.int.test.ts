import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  evaluateStorefrontAccess,
  getStoreStatus,
  invalidateHostCache,
  provisionTenant,
  updateStoreStatus,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime; // platform service: provisions the stores
let rtWeb: Runtime; // tenant runtime (app_rw), like apps/web
let storeA: { tenantId: string; ownerId: string; host: string };
let storeB: { tenantId: string; ownerId: string; host: string };

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const ctxFor = (s: { tenantId: string; ownerId: string }, permissions = ["settings.write"]): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req-test",
});

async function mkStore(slug: string) {
  const r = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  const [d] = await rt._db.db.select({ hostname: schema.domains.hostname }).from(schema.domains).where(eq(schema.domains.tenantId, r.tenantId)).limit(1);
  if (!d) throw new Error("provisioning created no domain");
  return { tenantId: r.tenantId, ownerId: r.ownerId, host: d.hostname };
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  storeA = await mkStore("status-a");
  storeB = await mkStore("status-b");
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("storefront mode (going live)", () => {
  it("a new store starts hidden behind the coming-soon page", async () => {
    const status = await getStoreStatus(rtWeb, ctxFor(storeA));
    expect(status).toMatchObject({ mode: "coming_soon", hasPassword: false, collectEmails: true });
    invalidateHostCache();
    const access = await evaluateStorefrontAccess(rt._db.db, storeA.host);
    expect(access).toMatchObject({ allowed: false, reason: "coming_soon" });
  });

  it("switching to live opens the public storefront, and only that store", async () => {
    await updateStoreStatus(rtWeb, ctxFor(storeA), { mode: "live" });
    expect((await getStoreStatus(rtWeb, ctxFor(storeA))).mode).toBe("live");
    invalidateHostCache();
    expect(await evaluateStorefrontAccess(rt._db.db, storeA.host)).toMatchObject({ allowed: true, httpStatus: 200 });
    // the other store is untouched
    expect((await getStoreStatus(rtWeb, ctxFor(storeB))).mode).toBe("coming_soon");
    expect(await evaluateStorefrontAccess(rt._db.db, storeB.host)).toMatchObject({ allowed: false, reason: "coming_soon" });
  });

  it("records who changed it and can put the store back to coming soon with a headline", async () => {
    await updateStoreStatus(rtWeb, ctxFor(storeA), { mode: "coming_soon", headline: "Back soon" });
    const status = await getStoreStatus(rtWeb, ctxFor(storeA));
    expect(status).toMatchObject({ mode: "coming_soon", headline: "Back soon" });
    const [row] = await rt._db.db.select().from(schema.storeStatus).where(eq(schema.storeStatus.tenantId, storeA.tenantId));
    expect(row?.changedBy).toBe(storeA.ownerId);
  });

  it("password mode needs a password first", async () => {
    expect(await errorOf(updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "password" }))).toMatch(/set a password/);
    await updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "password", password: "open-sesame-1" });
    expect(await getStoreStatus(rtWeb, ctxFor(storeB))).toMatchObject({ mode: "password", hasPassword: true });
    // an existing password is enough when only the mode changes back
    await updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "live" });
    await updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "password" });
    expect((await getStoreStatus(rtWeb, ctxFor(storeB))).mode).toBe("password");
  });

  it("needs the settings permission to read or change it", async () => {
    const nobody = ctxFor(storeA, ["products.read"]);
    expect(await errorOf(getStoreStatus(rtWeb, nobody))).toMatch(/Forbidden/);
    expect(await errorOf(updateStoreStatus(rtWeb, nobody, { mode: "live" }))).toMatch(/Forbidden/);
  });
});
