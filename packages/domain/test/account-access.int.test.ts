import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, getAccountProfile, provisionTenant, type Runtime } from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let web: Runtime;

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
  web = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 3 });
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await web?.close();
  await env?.stop();
});

async function addMember(tenantId: string, roleName: string, label: string) {
  const [u] = await rt._db.db.insert(schema.users).values({ email: `${label}@acc-access.test`, name: label }).returning();
  await withTenant(rt._db.db, tenantId, async (tx) => {
    const [role] = await tx.select().from(schema.roles).where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, roleName)));
    await tx.insert(schema.memberships).values({ tenantId, userId: u!.id, roleId: role!.id, status: "active" });
  });
  return u!;
}

describe("account access summary", () => {
  it("gives a staff member the store owner to ask, and the owner nobody", async () => {
    const t = await provisionTenant(rt, { storeName: "acc-a", slug: "acc-a", owner: { email: "owner@acc-a.test", name: "Olive Owner" }, planCode: "starter", source: "platform_admin" });
    const staff = await addMember(t.tenantId, "store_admin", "stan");
    const mine = await getAccountProfile(web, staff.id);
    expect(mine.access).toHaveLength(1);
    expect(mine.access[0]).toMatchObject({ storeName: "acc-a", role: "store_admin", owner: { name: "Olive Owner", email: "owner@acc-a.test" } });
    expect(mine.access[0]?.permissions).not.toContain("payments.manage");
    const owner = await getAccountProfile(web, t.ownerId);
    expect(owner.access[0]).toMatchObject({ role: "store_owner", owner: null });
  });

  it("shows only the caller's own stores, never another store's owner", async () => {
    const a = await provisionTenant(rt, { storeName: "acc-b", slug: "acc-b", owner: { email: "owner@acc-b.test", name: "Bea" }, planCode: "starter", source: "platform_admin" });
    const b = await provisionTenant(rt, { storeName: "acc-c", slug: "acc-c", owner: { email: "owner@acc-c.test", name: "Cy" }, planCode: "starter", source: "platform_admin" });
    const staffA = await addMember(a.tenantId, "store_finance", "fin");
    const p = await getAccountProfile(web, staffA.id);
    expect(p.access.map((x) => x.storeName)).toEqual(["acc-b"]);
    expect(JSON.stringify(p)).not.toContain(b.tenantId);
    expect(JSON.stringify(p)).not.toContain("owner@acc-c.test");
  });

  it("asks the owner who granted the access when there are several owners", async () => {
    const t = await provisionTenant(rt, { storeName: "acc-d", slug: "acc-d", owner: { email: "first@acc-d.test", name: "First Owner" }, planCode: "starter", source: "platform_admin" });
    const second = await addMember(t.tenantId, "store_owner", "second-owner");
    const staff = await addMember(t.tenantId, "store_admin", "stella");
    await withTenant(rt._db.db, t.tenantId, (tx) =>
      tx.update(schema.memberships).set({ invitedBy: second.id }).where(and(eq(schema.memberships.tenantId, t.tenantId), eq(schema.memberships.userId, staff.id))),
    );
    const p = await getAccountProfile(web, staff.id);
    expect(p.access[0]?.owner?.email).toBe("second-owner@acc-access.test");
    expect(p.access[0]?.invitedBy).toBe("second-owner");
  });
});
