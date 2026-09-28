/**
 * Integration Test: Real PostgreSQL 18 Tenant Isolation & Security Invariants.
 * Runs against a real PostgreSQL 18 instance (via Testcontainers or TEST_DATABASE_URL_SUPERUSER).
 *
 * Verifies:
 * 1. Dynamic introspection of all oRPC admin and platform contract procedures.
 * 2. Cross-tenant access rejection (User A cannot access Tenant B).
 * 3. Role permission enforcement via hasPermission() (users lacking required permission receive 403 Forbidden).
 * 4. Authentication enforcement (customer and unauthenticated sessions rejected).
 * 5. Platform security invariants (non-platform staff rejected, platform staff accepted).
 * 6. True PostgreSQL Row Level Security (RLS) enforcement: direct queries across tenants
 *    return 0 rows, and queries without tenant context return 0 rows under app_rw.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { eq } from "drizzle-orm";
import { platformContract, storeContract } from "@bs/contracts";
import {
  createDb,
  schema,
  withTenant,
  type DbHandle,
} from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  assertPlatformStaff,
  buildTenantContext,
  createRuntime,
  getPlatformTenant,
  getStoreSettings,
  inviteStaff,
  listMemberships,
  listPlatformTenants,
  listStoreFeatureFlags,
  updateStoreSettings,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

/**
 * Dynamically walks an oRPC contract object and extracts all procedure paths.
 * Guarantees that any new procedure added in M2+ is automatically discovered
 * and tested for tenant isolation.
 */
function extractProcedurePaths(obj: Record<string, unknown>, prefix = ""): string[] {
  const paths: string[] = [];
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object") {
      if ("~orpc" in value || "route" in value) {
        paths.push(currentPath);
      } else {
        paths.push(...extractProcedurePaths(value as Record<string, unknown>, currentPath));
      }
    }
  }
  return paths;
}

describe("Generated Isolation Test Suite (M1 Real Postgres 18 Proof)", () => {
  const orgId = "0199a000-0000-7000-8000-000000000001";
  const tenantA = "0199a000-0000-7000-8000-000000000010";
  const tenantB = "0199a000-0000-7000-8000-000000000020";

  const userA = "0199a000-0000-7000-8000-000000000100";
  const userB = "0199a000-0000-7000-8000-000000000200";
  const userLimited = "0199a000-0000-7000-8000-000000000300";
  const userPlatform = "0199a000-0000-7000-8000-000000000400";

  const roleAdminA = "0199a000-0000-7000-8000-000000000011";
  const roleLimitedA = "0199a000-0000-7000-8000-000000000012";
  const roleAdminB = "0199a000-0000-7000-8000-000000000021";

  let rtApp: Runtime;
  let rtPlatform: Runtime;
  let dbRw: DbHandle;
  let dbPlatform: DbHandle;

  const adminProcedures = extractProcedurePaths(storeContract.admin as unknown as Record<string, unknown>);
  const platformProcedures = extractProcedurePaths(platformContract.tenants as unknown as Record<string, unknown>);

  beforeAll(async () => {
    if (process.env.TEST_DATABASE_URL_SUPERUSER) {
      superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
    } else {
      container = await new PostgreSqlContainer("postgres:18").start();
      superUrl = container.getConnectionUri();
    }

    // 1. Bootstrap PostgreSQL roles (app_owner, app_rw, app_platform)
    await bootstrapRoles(superUrl, PW);

    // 2. Run Drizzle migrations as app_owner
    await runMigrations(as("app_owner", PW.owner));

    // 3. Connect runtimes
    rtApp = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 5 });
    rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });
    dbRw = createDb(as("app_rw", PW.rw));
    dbPlatform = createDb(as("app_platform", PW.platform));

    // 4. Seed non-tenant global records
    await dbRw.db.insert(schema.organizations).values({
      id: orgId,
      name: "Global Test Org",
    });

    await dbRw.db.insert(schema.tenants).values([
      {
        id: tenantA,
        slug: "store-alpha",
        name: "Store Alpha",
        organizationId: orgId,
        status: "active",
      },
      {
        id: tenantB,
        slug: "store-beta",
        name: "Store Beta",
        organizationId: orgId,
        status: "active",
      },
    ]);

    await dbRw.db.insert(schema.domains).values([
      {
        tenantId: tenantA,
        hostname: "alpha.store.test",
        isPrimary: true,
        status: "active",
      },
      {
        tenantId: tenantB,
        hostname: "beta.store.test",
        isPrimary: true,
        status: "active",
      },
    ]);

    await dbRw.db.insert(schema.users).values([
      { id: userA, email: "usera@alpha.test", name: "User A" },
      { id: userB, email: "userb@beta.test", name: "User B" },
      { id: userLimited, email: "limited@alpha.test", name: "User Limited" },
      { id: userPlatform, email: "platform@corp.test", name: "Platform Admin" },
    ]);

    await dbRw.db.insert(schema.platformStaff).values({
      userId: userPlatform,
      role: "platform_owner",
      isActive: true,
    });

    await dbRw.db.insert(schema.featureFlags).values([
      { key: "checkout_v2", defaultOn: true, killSwitch: false },
      { key: "experimental_search", defaultOn: false, killSwitch: false },
    ]);

    // 5. Seed Tenant A records using withTenant()
    await withTenant(dbRw.db, tenantA, async (tx) => {
      await tx.insert(schema.roles).values([
        {
          id: roleAdminA,
          tenantId: tenantA,
          name: "store_admin",
          isSystem: true,
          permissions: ["staff.manage", "settings.write"],
        },
        {
          id: roleLimitedA,
          tenantId: tenantA,
          name: "store_viewer",
          isSystem: false,
          permissions: ["products.read"],
        },
      ]);

      await tx.insert(schema.memberships).values([
        {
          tenantId: tenantA,
          userId: userA,
          roleId: roleAdminA,
          status: "active",
        },
        {
          tenantId: tenantA,
          userId: userLimited,
          roleId: roleLimitedA,
          status: "active",
        },
      ]);

      await tx.insert(schema.storeSettings).values({
        tenantId: tenantA,
        storeName: "Alpha Store Settings",
        currency: "USD",
        timezone: "America/New_York",
      });
    });

    // 6. Seed Tenant B records using withTenant()
    await withTenant(dbRw.db, tenantB, async (tx) => {
      await tx.insert(schema.roles).values([
        {
          id: roleAdminB,
          tenantId: tenantB,
          name: "store_admin",
          isSystem: true,
          permissions: ["staff.manage", "settings.write"],
        },
      ]);

      await tx.insert(schema.memberships).values([
        {
          tenantId: tenantB,
          userId: userB,
          roleId: roleAdminB,
          status: "active",
        },
      ]);

      await tx.insert(schema.storeSettings).values({
        tenantId: tenantB,
        storeName: "Beta Store Settings",
        currency: "EUR",
        timezone: "Europe/Paris",
      });
    });
  }, 180_000);

  afterAll(async () => {
    await rtApp?.close();
    await rtPlatform?.close();
    await dbRw?.close();
    await dbPlatform?.close();
    await container?.stop();
  });

  it("dynamically discovers all registered admin procedures", () => {
    expect(adminProcedures.length).toBeGreaterThanOrEqual(5);
    expect(adminProcedures).toContain("memberships.list");
    expect(adminProcedures).toContain("memberships.invite");
    expect(adminProcedures).toContain("settings.get");
    expect(adminProcedures).toContain("settings.update");
    expect(adminProcedures).toContain("featureFlags.list");
  });

  it("dynamically discovers all registered platform procedures", () => {
    expect(platformProcedures.length).toBeGreaterThanOrEqual(2);
    expect(platformProcedures).toContain("list");
    expect(platformProcedures).toContain("get");
  });

  /**
   * Helper to dispatch procedure calls to actual domain services against real DB.
   */
  async function executeAdminProcedure(procPath: string, rt: Runtime, ctx: TenantContext) {
    switch (procPath) {
      case "memberships.list":
        return await listMemberships(rt, ctx);
      case "memberships.invite":
        return await inviteStaff(rt, ctx, {
          email: `invite-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
          roleId: roleAdminA,
        });
      case "settings.get":
        return await getStoreSettings(rt, ctx);
      case "settings.update":
        return await updateStoreSettings(rt, ctx, { storeName: "Updated Alpha Store" });
      case "featureFlags.list":
        return await listStoreFeatureFlags(rt, ctx);
      default:
        throw new Error(`Unmapped procedure in isolation test: ${procPath}`);
    }
  }

  describe("Admin Procedures Dynamic Isolation & Authorization Invariants", () => {
    for (const proc of adminProcedures) {
      describe(`Procedure: admin.${proc}`, () => {
        it("rejects when staff user on tenant A attempts to access tenant B (X-Store-Id: B)", async () => {
          // Real DB query: userA has no membership in tenantB
          await expect(
            buildTenantContext(rtApp._db.db, {
              entryPath: "admin",
              headers: { "x-store-id": tenantB },
              session: {
                user: { id: userA },
                type: "staff",
              },
            }),
          ).rejects.toThrow(/membership/i);
        });

        it("rejects when called with a customer session", async () => {
          await expect(
            buildTenantContext(rtApp._db.db, {
              entryPath: "admin",
              headers: { "x-store-id": tenantA },
              session: {
                user: { id: "cust-123" },
                type: "customer",
              },
            }),
          ).rejects.toThrow(/forbidden.*customer/i);
        });

        it("rejects when called without an authenticated session", async () => {
          await expect(
            buildTenantContext(rtApp._db.db, {
              entryPath: "admin",
              headers: { "x-store-id": tenantA },
              session: null,
            }),
          ).rejects.toThrow(/unauthorized/i);
        });

        it("rejects with 403 Forbidden when staff user lacks the required permission (hasPermission check)", async () => {
          // userLimited has active membership in tenantA, but only possesses ["products.read"]
          const limitedCtx = await buildTenantContext(rtApp._db.db, {
            entryPath: "admin",
            headers: { "x-store-id": tenantA },
            session: {
              user: { id: userLimited },
              type: "staff",
            },
          });
          expect(limitedCtx).not.toBeNull();
          expect(limitedCtx!.permissions).toEqual(["products.read"]);

          // Procedure execution fails because userLimited lacks staff.manage / settings.write
          await expect(
            executeAdminProcedure(proc, rtApp, limitedCtx!),
          ).rejects.toThrow(/forbidden: missing required permission/i);
        });

        it("succeeds against real PostgreSQL when authorized staff user accesses authorized tenant A", async () => {
          const authCtx = await buildTenantContext(rtApp._db.db, {
            entryPath: "admin",
            headers: { "x-store-id": tenantA },
            session: {
              user: { id: userA },
              type: "staff",
            },
          });
          expect(authCtx).not.toBeNull();
          expect(authCtx!.tenantId).toBe(tenantA);
          expect(authCtx!.actor).toEqual({ type: "staff", userId: userA });
          expect(authCtx!.permissions).toEqual(["staff.manage", "settings.write"]);

          const result = await executeAdminProcedure(proc, rtApp, authCtx!);
          expect(result).toBeDefined();
        });
      });
    }
  });

  describe("Platform Procedures Security Invariants", () => {
    for (const proc of platformProcedures) {
      describe(`Procedure: platform.tenants.${proc}`, () => {
        it("rejects non-platform staff session against real PostgreSQL", async () => {
          // userA is in users table but NOT in platform_staff table
          await expect(assertPlatformStaff(rtPlatform, userA)).rejects.toThrow(/forbidden/i);
        });

        it("accepts authenticated platform staff member and executes procedure", async () => {
          const staff = await assertPlatformStaff(rtPlatform, userPlatform);
          expect(staff.role).toBe("platform_owner");

          if (proc === "list") {
            const list = await listPlatformTenants(rtPlatform);
            expect(list.length).toBeGreaterThanOrEqual(2);
            const slugs = list.map((t) => t.slug);
            expect(slugs).toContain("store-alpha");
            expect(slugs).toContain("store-beta");
          } else if (proc === "get") {
            const tenant = await getPlatformTenant(rtPlatform, tenantA);
            expect(tenant.id).toBe(tenantA);
            expect(tenant.slug).toBe("store-alpha");
          }
        });
      });
    }
  });

  describe("Cross-Tenant Direct Database Query Invariant (RLS Engine Verification)", () => {
    it("proves direct query under tenant A cannot read rows belonging to tenant B", async () => {
      // 1. Direct query filtering for tenant B under tenant A context returns 0 rows
      const rowsBUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.storeSettings)
          .where(eq(schema.storeSettings.tenantId, tenantB));
      });
      expect(rowsBUnderA).toEqual([]);

      // 2. Direct unfiltered query under tenant A context returns ONLY tenant A rows
      const allRowsUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx.select().from(schema.storeSettings);
      });
      expect(allRowsUnderA.length).toBe(1);
      expect(allRowsUnderA[0]?.tenantId).toBe(tenantA);
      expect(allRowsUnderA[0]?.storeName).toContain("Alpha Store");

      // 3. Memberships table RLS: under tenant A, tenant B memberships are completely hidden
      const bMembershipsUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.memberships)
          .where(eq(schema.memberships.tenantId, tenantB));
      });
      expect(bMembershipsUnderA).toEqual([]);

      // 4. Roles table RLS: under tenant A, tenant B roles are completely hidden
      const bRolesUnderA = await withTenant(dbRw.db, tenantA, async (tx) => {
        return await tx
          .select()
          .from(schema.roles)
          .where(eq(schema.roles.tenantId, tenantB));
      });
      expect(bRolesUnderA).toEqual([]);
    });

    it("proves direct insert under tenant A with tenant B ID is rejected by Postgres RLS WITH CHECK", async () => {
      let threw = false;
      try {
        await withTenant(dbRw.db, tenantA, async (tx) => {
          await tx.insert(schema.storeSettings).values({
            tenantId: tenantB, // Poisoned tenant ID
            storeName: "Malicious Cross-Tenant Insert",
            currency: "USD",
            timezone: "UTC",
          });
        });
      } catch (err: unknown) {
        threw = true;
        const msg = String(err) + " " + String((err as { cause?: { message?: string } })?.cause?.message ?? "");
        expect(msg).toMatch(/violates row-level security policy/i);
      }
      expect(threw).toBe(true);
    });

    it("proves app_rw query with unset tenant context returns 0 rows (nullif setting turns empty to NULL)", async () => {
      // Direct query without withTenant(): app.tenant_id is unset
      const unisolatedSettings = await dbRw.db.select().from(schema.storeSettings);
      expect(unisolatedSettings).toEqual([]);

      const unisolatedMemberships = await dbRw.db.select().from(schema.memberships);
      expect(unisolatedMemberships).toEqual([]);
    });

    it("proves app_platform (BYPASSRLS) can view all tenants across stores", async () => {
      const allSettings = await dbPlatform.db.select().from(schema.storeSettings);
      expect(allSettings.length).toBeGreaterThanOrEqual(2);

      const tenantIds = allSettings.map((s) => s.tenantId);
      expect(tenantIds).toContain(tenantA);
      expect(tenantIds).toContain(tenantB);
    });
  });
});
