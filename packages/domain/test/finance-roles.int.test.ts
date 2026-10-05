/**
 * Finance access by role (owner decisions 2026-10-05, D10 and D14), on real PostgreSQL:
 * - store owner, store admin and the new store_finance role can use the books;
 * - CSV export is for the owner and admin roles only;
 * - stores that predate the Finance section still get finance.* for their system roles;
 * - the finance role exists for old stores, and only owners/admins can hand it out.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { createDb, schema, withTenant, type DbHandle } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { createRuntime, type Runtime } from "../src/runtime.ts";
import { buildTenantContext, type TenantContext } from "../src/context.ts";
import { provisionTenant } from "../src/saas/provisioning.ts";
import { inviteStaff, listStoreRoles } from "../src/admin/team.ts";
import { getAdminMe } from "../src/admin/me.ts";
import { assertCanExportFinance, getFinanceOverview } from "../src/finance/index.ts";

let env: TestDb;
let dbRw: DbHandle;
let rt: Runtime;
let tenantId: string;
let ownerId: string;
const financeUserId = crypto.randomUUID();

async function ctxFor(userId: string): Promise<TenantContext> {
  const ctx = await buildTenantContext(rt._db.db, {
    entryPath: "admin",
    headers: { "x-store-id": tenantId },
    session: { user: { id: userId }, type: "staff" },
  });
  return ctx!;
}

beforeAll(async () => {
  env = await startTestDb();
  dbRw = createDb(env.as("app_rw"), { applicationName: "bsec-test-rw" });
  rt = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const rand = Math.random().toString(36).slice(2, 7);
  const t = await provisionTenant(rtPlatform, {
    storeName: "Finance Roles Store",
    slug: `fin-roles-${rand}`,
    owner: { email: `owner-${rand}@finance-roles.test`, name: "Owner", password: `Pw-${rand}-long-enough-1` },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
  ownerId = t.ownerId;

  // A finance staff member on the finance system role.
  await withTenant(dbRw.db, tenantId, async (tx) => {
    await tx.insert(schema.users).values({ id: financeUserId, email: `fin-${rand}@finance-roles.test`, name: "Finance Person", emailVerified: true } as never);
    const [role] = await tx.select({ id: schema.roles.id }).from(schema.roles).where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_finance")));
    await tx.insert(schema.memberships).values({ tenantId, userId: financeUserId, roleId: role!.id, status: "active" });
  });
}, 180_000);

afterAll(async () => {
  await dbRw?.close();
  await rt?.close();
});

describe("Finance roles", () => {
  it("a provisioned store has the finance system role holding only finance.read and finance.write", async () => {
    const roles = await withTenant(dbRw.db, tenantId, (tx) => tx.select().from(schema.roles).where(eq(schema.roles.tenantId, tenantId)));
    const finance = roles.find((r) => r.name === "store_finance");
    expect(finance?.isSystem).toBe(true);
    expect([...(finance?.permissions ?? [])].sort()).toEqual(["finance.read", "finance.write"]);
  });

  it("the finance role can read and write the books but cannot export or reach anything else", async () => {
    const ctx = await ctxFor(financeUserId);
    expect(ctx.roles).toEqual(["store_finance"]);
    expect([...ctx.permissions].sort()).toEqual(["finance.read", "finance.write"]);
    await expect(getFinanceOverview(dbRw, ctx, { named: "all" })).resolves.toBeDefined();
    expect(() => assertCanExportFinance(ctx)).toThrow(/exports\.run/);
    // even with exports.run, the role itself is not allowed to export
    const withExports = { ...ctx, permissions: [...ctx.permissions, "exports.run"] } as TenantContext;
    expect(() => assertCanExportFinance(withExports)).toThrow(/only the store owner and store admin/);
  });

  it("the owner can export; a custom role holding both permissions still cannot", async () => {
    const owner = await ctxFor(ownerId);
    expect(() => assertCanExportFinance(owner)).not.toThrow();
    const custom = { ...owner, roles: ["bookkeeper"], permissions: ["finance.read", "exports.run"] } as TenantContext;
    expect(() => assertCanExportFinance(custom)).toThrow(/only the store owner and store admin/);
    const admin = { ...owner, roles: ["store_admin"] } as TenantContext;
    expect(() => assertCanExportFinance(admin)).not.toThrow();
  });

  it("stores that predate the Finance section: stale role arrays still get finance.* from the system role", async () => {
    await withTenant(dbRw.db, tenantId, (tx) =>
      tx.update(schema.roles).set({ permissions: ["products.read"] }).where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_owner"))),
    );
    const owner = await ctxFor(ownerId);
    expect(owner.permissions).toContain("finance.read");
    expect(owner.permissions).toContain("finance.write");
    // only finance.* is granted by definition: nothing else is invented
    expect(owner.permissions).not.toContain("payments.manage");
    expect(owner.permissions).toContain("products.read");
  });

  it("the signed-in profile (nav) also shows finance for a store with a stale owner role", async () => {
    const me = await getAdminMe(rt, ownerId);
    const store = me.stores.find((x) => x.tenantId === tenantId);
    expect(store?.permissions).toContain("finance.read");
    expect(store?.permissions).toContain("finance.write");
  });

  it("listing roles creates the finance role for a store that does not have it yet", async () => {
    await withTenant(dbRw.db, tenantId, async (tx) => {
      await tx.delete(schema.memberships).where(eq(schema.memberships.userId, financeUserId));
      await tx.delete(schema.roles).where(and(eq(schema.roles.tenantId, tenantId), eq(schema.roles.name, "store_finance")));
    });
    const owner = await ctxFor(ownerId);
    const roles = await listStoreRoles(rt, { ...owner, permissions: [...owner.permissions, "staff.manage"] } as TenantContext);
    expect(roles.map((r) => r.name)).toContain("store_finance");
    // idempotent
    const again = await listStoreRoles(rt, { ...owner, permissions: [...owner.permissions, "staff.manage"] } as TenantContext);
    expect(again.filter((r) => r.name === "store_finance").length).toBe(1);
  });

  it("only owners and admins can invite someone to the finance role", async () => {
    const owner = await ctxFor(ownerId);
    const roles = await listStoreRoles(rt, { ...owner, permissions: [...owner.permissions, "staff.manage"] } as TenantContext);
    const financeRole = roles.find((r) => r.name === "store_finance")!;

    const bookkeeper = { ...owner, roles: ["bookkeeper"], permissions: ["staff.manage"] } as TenantContext;
    await expect(inviteStaff(rt, bookkeeper, { email: "x1@finance-roles.test", roleId: financeRole.id })).rejects.toThrow(/only store owners and admins/);

    const admin = { ...owner, roles: ["store_admin"], permissions: [...owner.permissions, "staff.manage"] } as TenantContext;
    const invite = await inviteStaff(rt, admin, { email: "x2@finance-roles.test", roleId: financeRole.id });
    expect(invite).toBeDefined();
  });
});
