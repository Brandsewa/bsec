import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  addCustomDomain,
  buildTenantContext,
  createRuntime,
  evaluateStorefrontAccess,
  invalidateHostCache,
  LIFECYCLE_MATRIX,
  placeOrder,
  provisionTenant,
  suspendPlatformTenant,
  restorePlatformTenant,
  TENANT_LIFECYCLE_STATES,
  type Runtime,
  type TenantLifecycleState,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let rtWeb: Runtime;
let staffId: string;
let store: { tenantId: string; ownerId: string; slug: string };

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const setStatus = async (status: string) => {
  await rt._db.db.execute(sql`UPDATE tenants SET status = ${status} WHERE id = ${store.tenantId}`);
  invalidateHostCache(); // the host->tenant map is cached for up to 60 s per process; tests want the answer now
};

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  staffId = (await seedPlatformStaff(rt._db.db, { email: "owner@platform.test", role: "platform_owner" })).userId;
  const slug = "lifecycle-shop";
  const r = await provisionTenant(rt, { storeName: "Lifecycle Shop", slug, owner: { email: "owner@lifecycle.test", name: "Owner", password: "a long password 123" }, planCode: "starter", source: "self_service" });
  store = { tenantId: r.tenantId, ownerId: r.ownerId, slug };
  // make the owner a working store owner (an active membership)
  await rt._db.db.execute(sql`UPDATE memberships SET status = 'active' WHERE tenant_id = ${store.tenantId}`);
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

const host = () => `${store.slug}.gobs.cloud`;

/** Expected behaviour per state, written out from PLAN §6.4 (not derived from the code under test). */
const EXPECTED: Record<TenantLifecycleState, { storefront: number; checkout: boolean; admin: "none" | "full" | "read_only"; domains: boolean; marketing: boolean }> = {
  provisioning: { storefront: 503, checkout: false, admin: "none", domains: false, marketing: false },
  trial: { storefront: 200, checkout: true, admin: "full", domains: true, marketing: true },
  active: { storefront: 200, checkout: true, admin: "full", domains: true, marketing: true },
  past_due: { storefront: 200, checkout: true, admin: "full", domains: true, marketing: true },
  suspended: { storefront: 503, checkout: false, admin: "read_only", domains: false, marketing: false },
  archived: { storefront: 404, checkout: false, admin: "none", domains: false, marketing: false },
  deletion_requested: { storefront: 404, checkout: false, admin: "none", domains: false, marketing: false },
  deleted: { storefront: 404, checkout: false, admin: "none", domains: false, marketing: false },
};

describe("tenant lifecycle is enforced at runtime, in a real database, for every state", () => {
  it("covers every state in the matrix", () => {
    expect(Object.keys(EXPECTED).sort()).toEqual([...TENANT_LIFECYCLE_STATES].sort());
    expect(Object.keys(LIFECYCLE_MATRIX).sort()).toEqual([...TENANT_LIFECYCLE_STATES].sort());
  });

  for (const state of TENANT_LIFECYCLE_STATES) {
    it(`state '${state}': storefront, checkout, admin, domains behave as PLAN §6.4 says`, async () => {
      const want = EXPECTED[state];
      await setStatus(state);

      // Storefront
      const access = await evaluateStorefrontAccess(rtWeb, host());
      expect(access.httpStatus, "storefront status").toBe(want.storefront === 200 ? 200 : want.storefront);

      // Checkout: refused with a lifecycle message when not allowed (the check runs before any cart or stock logic)
      const order = await errorOf(
        placeOrder(rtWeb, { tenantId: store.tenantId, storeStatus: "live", actor: { type: "anonymous" }, roles: [], permissions: [], requestId: "r" }, {
          cartToken: "no-such-cart", idempotencyKey: `idem-${state}`, email: "b@x.test", phone: "9876543210", fullName: "Buyer", addressLine1: "1 Street", city: "City", state: "Karnataka", pincode: "560001", paymentMethod: "cod",
        } as never),
      );
      if (want.checkout) expect(order ?? "", "checkout passes the lifecycle gate").not.toMatch(/Checkout is not available for store/);
      else expect(order, "checkout blocked").toMatch(/Checkout is not available for store/);

      // Admin (a real staff login with an active membership)
      const adminAttempt = buildTenantContext(rtWeb, {
        entryPath: "admin",
        headers: new Headers({ "x-store-id": store.tenantId }),
        session: { user: { id: store.ownerId }, type: "staff" },
      });
      if (want.admin === "none") {
        expect(await errorOf(adminAttempt)).toMatch(/not accessible in admin/);
      } else {
        const ctx = await adminAttempt;
        expect(ctx!.permissions.length).toBeGreaterThan(0);
        const writes = ctx!.permissions.filter((p) => !p.endsWith(".read"));
        if (want.admin === "read_only") expect(writes, "no write permission while read-only").toEqual([]);
        else expect(writes.length, "full access has write permissions").toBeGreaterThan(0);
      }

      // Custom domains can only be added while the store is fully live
      const domainErr = await errorOf(addCustomDomain(rt, store.tenantId, { hostname: `shop-${state.replace(/_/g, "-")}.example.in`, provider: { isConfigured: () => false, createCustomHostname: async () => ({ providerHostnameId: null, hostname: "x", cnameTarget: "c", status: "requested", sslStatus: "not_configured" }), getCustomHostnameStatus: async () => ({ status: "requested", sslStatus: "not_configured" }), deleteCustomHostname: async () => ({ deleted: true }) } as never }));
      if (want.domains) expect(domainErr ?? "", "domain add allowed").not.toMatch(/cannot be added while the store is/);
      else expect(domainErr, "domain add blocked").toMatch(/cannot be added while the store is/);
    });
  }

  it("suspending through the platform takes effect immediately for the storefront and restores cleanly", async () => {
    await setStatus("active");
    expect((await evaluateStorefrontAccess(rtWeb, host())).httpStatus).toBe(200);
    await suspendPlatformTenant(rt, staffId, store.tenantId, "non-payment");
    invalidateHostCache();
    const down = await evaluateStorefrontAccess(rtWeb, host());
    expect(down).toMatchObject({ httpStatus: 503, reason: "suspended" });
    await restorePlatformTenant(rt, staffId, store.tenantId);
    invalidateHostCache();
    expect((await evaluateStorefrontAccess(rtWeb, host())).httpStatus).toBe(200);
    const [t] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, store.tenantId));
    expect(t!.status).toBe("active");
  });

  it("refuses transitions the state machine forbids", async () => {
    await setStatus("deleted");
    expect(await errorOf(restorePlatformTenant(rt, staffId, store.tenantId))).toMatch(/Invalid tenant lifecycle transition/);
    await setStatus("active");
  });
});
