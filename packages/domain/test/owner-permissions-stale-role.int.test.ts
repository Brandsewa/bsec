import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, getAdminMe, provisionTenant, type Runtime } from "../src/index.ts";

/**
 * Stores created before `payments.manage` existed keep an owner role row without it, and `settings.write` can never
 * stand in for that permission. The owner must still see Payments: the system role definition tops the stored array up.
 */
describe("store owner with a stale stored role (real Postgres)", () => {
  let env: TestDb;
  let rtPlatform: Runtime;
  let rt: Runtime;
  let tenantId: string;
  let ownerId: string;

  beforeAll(async () => {
    env = await startTestDb();
    rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
    rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 4 });
    const t = await provisionTenant(rtPlatform, {
      storeName: "Stale Owner Store",
      slug: `stale-owner-${Date.now()}`,
      owner: { email: `owner-${Date.now()}@stale-owner.test`, name: "Owner" },
      planCode: "starter",
      source: "platform_admin",
    });
    tenantId = t.tenantId;
    ownerId = t.ownerId;
    // Simulate the older store: the stored owner role has no payments.manage
    await withTenant(rtPlatform._db.db, tenantId, (tx) =>
      tx
        .update(schema.roles)
        .set({ permissions: sql`array_remove(permissions, 'payments.manage')` })
        .where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_owner"))),
    );
  });

  afterAll(async () => {
    await rt?.close();
    await rtPlatform?.close();
  });

  it("still reports payments.manage to the admin app", async () => {
    const me = await getAdminMe(rt, ownerId);
    const store = me.stores.find((s) => s.tenantId === tenantId);
    expect(store?.role).toBe("store_owner");
    expect(store?.permissions).toContain("payments.manage");
  });
});
