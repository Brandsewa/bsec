import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { createDb, type DbHandle } from "@bs/db";
import { hasPermission, STORE_PERMISSIONS, SYSTEM_STORE_ROLES } from "@bs/auth";
import { readFileSync } from "node:fs";
import pg from "pg";
import { eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { bootstrapRoles } from "@bs/db/bootstrap";
import { runMigrations } from "@bs/db/migrate";
import {
  createRuntime,
  provisionTenant,
  type Runtime,
  type TenantContext,
  SUPPORT_READ_PERMISSIONS,
  SUPPORT_WRITE_PERMISSIONS,
} from "../src/index.ts";

const PW = { owner: "o_test", rw: "rw_test", platform: "p_test" };
let container: StartedPostgreSqlContainer | undefined;
let superUrl: string;
let rwDb: DbHandle;
let rt: Runtime;
let rtPlatform: Runtime;

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

let tenantIdA: string;
let managerUserIdA: string;

beforeAll(async () => {
  if (process.env.TEST_DATABASE_URL_SUPERUSER) {
    superUrl = process.env.TEST_DATABASE_URL_SUPERUSER;
  } else {
    container = await new PostgreSqlContainer("postgres:18").withReuse().start();
    superUrl = container.getConnectionUri();
  }
  await bootstrapRoles(superUrl, PW);
  await runMigrations(as("app_owner", PW.owner));
  rwDb = createDb(as("app_rw", PW.rw), { max: 10 });
  rt = createRuntime({ service: "web", databaseUrl: as("app_rw", PW.rw), poolMax: 10 });
  rtPlatform = createRuntime({ service: "platform", databaseUrl: as("app_platform", PW.platform), poolMax: 5 });

  // Provision Tenant A
  const pA = await provisionTenant(rtPlatform, {
    storeName: "Settings Auth Tenant A",
    slug: "settings-auth-a",
    owner: { email: "owner-a@test.example", name: "Owner A" },
    planCode: "starter",
  });
  tenantIdA = pA.tenantId;


  managerUserIdA = crypto.randomUUID();
});

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("Slice 8C: Settings Authorization (role definitions and owner-only runtime)", () => {
  // The per-procedure permission and denial proof lives in isolation.int.test.ts, which runs every admin
  // procedure through the real service as a permission-less user and as an authorised one. This suite adds
  // what that cannot: the capability model itself (ADR-020) and owner-only enforcement that needs a role,
  // not just a permission.
  const SETTINGS_FAMILIES = STORE_PERMISSIONS.filter(
    (p) =>
      p === "settings.read" ||
      p === "settings.manage" ||
      p.endsWith(".manage") ||
      p === "audit.read",
  );

  it("store_owner holds every permission", () => {
    expect([...SYSTEM_STORE_ROLES.store_owner].sort()).toEqual([...STORE_PERMISSIONS].sort());
  });

  it("store_admin holds everything except payments.manage", () => {
    const missing = STORE_PERMISSIONS.filter((p) => !SYSTEM_STORE_ROLES.store_admin.includes(p));
    expect(missing).toEqual(["payments.manage"]);
  });

  it("legacy settings.write satisfies the migrated families but never payments.manage or staff.manage", () => {
    for (const fam of SETTINGS_FAMILIES) {
      const expected = fam !== "payments.manage" && fam !== "staff.manage";
      expect(hasPermission(["settings.write"], fam), fam).toBe(expected);
    }
    expect(hasPermission(["settings.write"], "staff.manage")).toBe(false);
  });

  it("a provisioned store's store_admin role lacks payments.manage, and migration 0039 repairs older stores", async () => {
    const adminPerms = async () => {
      const [row] = await withTenant(rtPlatform._db.db, tenantIdA, (tx) =>
        tx.select({ p: schema.roles.permissions }).from(schema.roles).where(eq(schema.roles.name, "store_admin")),
      );
      return row?.p ?? [];
    };
    expect(await adminPerms()).not.toContain("payments.manage");
    expect(await adminPerms()).toContain("shipping.manage");

    // Recreate the old seed (full list), then run the migration exactly as the deploy does: as app_owner.
    await withTenant(rtPlatform._db.db, tenantIdA, (tx) =>
      tx.update(schema.roles).set({ permissions: [...STORE_PERMISSIONS] }).where(eq(schema.roles.name, "store_admin")),
    );
    expect(await adminPerms()).toContain("payments.manage");
    const client = new pg.Client({ connectionString: as("app_owner", PW.owner) });
    await client.connect();
    try {
      await client.query(readFileSync(new URL("../../db/migrations/0039_store_admin_no_payments.sql", import.meta.url), "utf8"));
    } finally {
      await client.end();
    }
    expect(await adminPerms()).not.toContain("payments.manage");
    expect(await adminPerms()).toContain("shipping.manage");
  });

  it("a role with only analytics.read holds no settings family", () => {
    for (const fam of SETTINGS_FAMILIES) expect(hasPermission(["analytics.read"], fam), fam).toBe(false);
  });

  it("platform support sessions (read and write) hold no settings family (ADR-020 section 4)", () => {
    for (const set of [SUPPORT_READ_PERMISSIONS, SUPPORT_WRITE_PERMISSIONS]) {
      for (const fam of SETTINGS_FAMILIES) {
        if (fam === "settings.read") continue; // read-only visibility is a separate documented grant
        expect(hasPermission([...set], fam), fam).toBe(false);
      }
    }
  });

  describe("Owner-Only Invariant Enforcement", () => {
    it("confirms owner-only procedures are strictly denied to Manager at runtime", async () => {
      const managerCtx: TenantContext = {
        tenantId: tenantIdA,
        storeStatus: "live",
        actor: { type: "staff", userId: managerUserIdA },
        roles: ["store_admin"],
        permissions: ["storefront.manage", "payments.manage", "settings.read"],
        requestId: crypto.randomUUID(),
      };

      // 1. Maintenance mutations denied to Manager
      const { scheduleMaintenance, cancelScheduledMaintenance, endMaintenance } = await import(
        "../src/storefront/lifecycle.ts"
      );

      const startsAt = new Date(Date.now() + 10 * 60 * 1000).toISOString();
      const endsAt = new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString();

      await expect(
        scheduleMaintenance(rt, managerCtx, { startsAt, endsAt }),
      ).rejects.toThrow(/only store owners can schedule maintenance/i);

      await expect(
        cancelScheduledMaintenance(rt, managerCtx),
      ).rejects.toThrow(/only store owners can manage maintenance mode/i);

      await expect(
        endMaintenance(rt, managerCtx),
      ).rejects.toThrow(/only store owners can manage maintenance mode/i);

      // 2. Plan change request denied to Manager
      const { requestPlanChange, cancelPlanChangeRequest } = await import(
        "../src/admin/plan-and-billing.ts"
      );

      await expect(
        requestPlanChange(rt, managerCtx, { toPlanId: "plan_growth", interval: "monthly" }),
      ).rejects.toThrow(/only the store owner/i);

      await expect(
        cancelPlanChangeRequest(rt, managerCtx, { id: "0199a000-0000-7000-8000-000000000001" }),
      ).rejects.toThrow(/only the store owner/i);
    });
  });
});
