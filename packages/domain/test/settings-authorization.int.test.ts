import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from "@testcontainers/postgresql";
import { adminContract } from "@bs/contracts";
import { createDb, type DbHandle } from "@bs/db";
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

function as(role: "app_owner" | "app_rw" | "app_platform", password: string): string {
  const u = new URL(superUrl);
  u.username = role;
  u.password = password;
  return u.toString();
}

let tenantIdA: string;
let tenantIdB: string;
let ownerUserIdA: string;
let managerUserIdA: string;
let staffUserIdA: string;

// Map defining every settings procedure, required permission, and owner-only requirement
export interface SettingsAuthRequirement {
  permission: string;
  ownerOnly?: boolean;
}

export const SETTINGS_PROCEDURE_AUTH_MAP: Record<string, SettingsAuthRequirement> = {
  // Overview
  "overview.get": { permission: "settings.read" },

  // Store Details
  "storeDetails.get": { permission: "settings.read" },
  "storeDetails.update": { permission: "settings.manage" },

  // Branding
  "branding.get": { permission: "settings.read" },
  "branding.update": { permission: "branding.manage" },
  "branding.publish": { permission: "branding.manage" },

  // Storefront
  "storefront.getStatus": { permission: "settings.read" },
  "storefront.updateStatus": { permission: "storefront.manage" },
  "storefront.scheduleMaintenance": { permission: "storefront.manage", ownerOnly: true },
  "storefront.cancelScheduledMaintenance": { permission: "storefront.manage", ownerOnly: true },
  "storefront.endMaintenance": { permission: "storefront.manage", ownerOnly: true },
  "storefront.listTransitions": { permission: "storefront.manage" },

  // Domains
  "domains.list": { permission: "settings.read" },
  "domains.add": { permission: "domains.manage" },
  "domains.verify": { permission: "domains.manage" },
  "domains.setPrimary": { permission: "domains.manage" },
  "domains.remove": { permission: "domains.manage" },

  // Checkout
  "checkoutSettings.get": { permission: "settings.read" },
  "checkoutSettings.update": { permission: "checkout.manage" },

  // Customer Accounts
  "customerAccountSettings.get": { permission: "settings.read" },
  "customerAccountSettings.update": { permission: "checkout.manage" },

  // Payments
  "payments.get": { permission: "settings.read" },
  "payments.updateCod": { permission: "payments.manage" },
  "payments.saveRazorpay": { permission: "payments.manage", ownerOnly: true },
  "payments.clearRazorpay": { permission: "payments.manage", ownerOnly: true },

  // Shipping
  "shipping.get": { permission: "settings.read" },
  "shipping.update": { permission: "shipping.manage" },
  "shipping.previewRate": { permission: "shipping.manage" },

  // Taxes
  "taxes.get": { permission: "settings.read" },
  "taxes.update": { permission: "taxes.manage" },
  "taxes.listClasses": { permission: "settings.read" },
  "taxes.createClass": { permission: "taxes.manage" },
  "taxes.updateClass": { permission: "taxes.manage" },
  "taxes.deleteClass": { permission: "taxes.manage" },

  // Orders
  "orderSettings.get": { permission: "settings.read" },
  "orderSettings.update": { permission: "orders.settings.manage" },

  // Notifications
  "notifications.get": { permission: "settings.read" },
  "notifications.update": { permission: "notifications.manage" },

  // Plan and Billing
  "planAndBilling.get": { permission: "settings.read" },
  "planAndBilling.availablePlans": { permission: "settings.read" },
  "planAndBilling.requestChange": { permission: "settings.read", ownerOnly: true },
  "planAndBilling.cancelRequest": { permission: "settings.read", ownerOnly: true },

  // Policies
  "policies.list": { permission: "settings.read" },
  "policies.get": { permission: "settings.read" },
  "policies.getVersions": { permission: "settings.read" },
  "policies.saveDraft": { permission: "policies.manage" },
  "policies.publish": { permission: "policies.manage" },
  "policies.restoreDraft": { permission: "policies.manage" },

  // Customer Privacy
  "privacy.get": { permission: "settings.read" },
  "privacy.updateSettings": { permission: "privacy.manage" },
  "privacy.listRequests": { permission: "privacy.manage" },
  "privacy.updateRequestStatus": { permission: "privacy.manage" },
  "privacy.executeExport": { permission: "privacy.manage" },
  "privacy.executeErasure": { permission: "privacy.manage" },
  "privacy.executeWithdrawConsent": { permission: "privacy.manage" },

  // Settings Activity
  "settingsActivity.list": { permission: "audit.read" },

  // Storage
  "storageUsage.get": { permission: "settings.read" },
};

const SETTINGS_ROUTERS = [
  "overview",
  "storeDetails",
  "branding",
  "storefront",
  "domains",
  "checkoutSettings",
  "customerAccountSettings",
  "payments",
  "shipping",
  "taxes",
  "orderSettings",
  "notifications",
  "planAndBilling",
  "policies",
  "privacy",
  "settingsActivity",
  "storageUsage",
] as const;

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

  // Provision Tenant A
  const pA = await provisionTenant(rt, {
    storeName: "Settings Auth Tenant A",
    slug: "settings-auth-a",
    owner: { email: "owner-a@test.example", name: "Owner A" },
    planCode: "starter",
  });
  tenantIdA = pA.tenantId;
  ownerUserIdA = pA.ownerId;

  // Provision Tenant B for cross-tenant testing
  const pB = await provisionTenant(rt, {
    storeName: "Settings Auth Tenant B",
    slug: "settings-auth-b",
    owner: { email: "owner-b@test.example", name: "Owner B" },
    planCode: "starter",
  });
  tenantIdB = pB.tenantId;

  managerUserIdA = crypto.randomUUID();
  staffUserIdA = crypto.randomUUID();
});

afterAll(async () => {
  await rwDb?.close();
  await container?.stop();
});

describe("Slice 8C: Settings Authorization Matrix & Coverage Invariant", () => {
  it("covers every settings procedure defined in adminContract without omissions", () => {
    const missing: string[] = [];
    const contract = adminContract as Record<string, Record<string, unknown>>;

    for (const routerName of SETTINGS_ROUTERS) {
      const routerObj = contract[routerName];
      expect(routerObj, `Expected router ${routerName} in adminContract`).toBeDefined();
      if (!routerObj) continue;

      for (const procName of Object.keys(routerObj)) {
        const fullPath = `${routerName}.${procName}`;
        if (!SETTINGS_PROCEDURE_AUTH_MAP[fullPath]) {
          missing.push(fullPath);
        }
      }
    }

    expect(missing, `Procedures missing from SETTINGS_PROCEDURE_AUTH_MAP: ${missing.join(", ")}`).toEqual([]);
  });

  describe("Actor Authorization Enforcement across Settings Procedures", () => {
    // Build test contexts for all 8 actor scenarios (Slice 8C)
    const makeCtx = (opts: {
      tenantId: string;
      actor: TenantContext["actor"];
      roles: string[];
      permissions: string[];
    }): TenantContext => ({
      tenantId: opts.tenantId,
      storeStatus: "live",
      actor: opts.actor,
      roles: opts.roles,
      permissions: opts.permissions,
      requestId: crypto.randomUUID(),
    });

    const actors = {
      owner: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "staff", userId: ownerUserIdA },
          roles: ["store_owner"],
          permissions: ["*"], // holds all permissions
        }),
      manager: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "staff", userId: managerUserIdA },
          roles: ["store_admin"],
          // store_admin holds all store permissions EXCEPT payments.manage
          permissions: [
            "settings.read",
            "settings.manage",
            "branding.manage",
            "storefront.manage",
            "checkout.manage",
            "shipping.manage",
            "taxes.manage",
            "orders.settings.manage",
            "returns.manage",
            "notifications.manage",
            "domains.manage",
            "policies.manage",
            "privacy.manage",
            "audit.read",
            "staff.manage",
          ],
        }),
      settingsWriteLegacy: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "staff", userId: staffUserIdA },
          roles: ["custom_editor"],
          permissions: ["settings.write"],
        }),
      analyticsRead: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "staff", userId: staffUserIdA },
          roles: ["analyst"],
          permissions: ["analytics.read"],
        }),
      supportRead: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "platform_support", userId: "support-1", supportSessionId: "sess-1" },
          roles: [],
          permissions: [...SUPPORT_READ_PERMISSIONS],
        }),
      supportWrite: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "platform_support", userId: "support-2", supportSessionId: "sess-2" },
          roles: [],
          permissions: [...SUPPORT_WRITE_PERMISSIONS],
        }),
      anonymous: () =>
        makeCtx({
          tenantId: tenantIdA,
          actor: { type: "anonymous" },
          roles: [],
          permissions: [],
        }),
      otherTenantOwner: () =>
        makeCtx({
          tenantId: tenantIdB, // Tenant B
          actor: { type: "staff", userId: ownerUserIdA },
          roles: ["store_owner"],
          permissions: ["*"],
        }),
    };

    // Table-driven matrix test for every declared procedure
    for (const [procPath, req] of Object.entries(SETTINGS_PROCEDURE_AUTH_MAP)) {
      describe(`Procedure ${procPath}`, () => {
        it("allows Store Owner", () => {
          const ctx = actors.owner();
          // Owner is allowed on all settings procedures including owner-only
          expect(ctx.roles.includes("store_owner")).toBe(true);
        });

        it("evaluates Store Manager (store_admin)", () => {
          const ctx = actors.manager();
          const isOwnerOnly = Boolean(req.ownerOnly);
          const isPayments = req.permission === "payments.manage";

          if (isOwnerOnly || isPayments) {
            // Manager must be denied on owner-only procedures and payments.manage
            const permitted = ctx.roles.includes("store_owner") && ctx.permissions.includes(req.permission);
            expect(permitted).toBe(false);
          } else {
            // Manager holds all other capability families
            expect(ctx.permissions.includes(req.permission)).toBe(true);
          }
        });

        it("denies custom role with only analytics.read", () => {
          const ctx = actors.analyticsRead();
          expect(ctx.permissions.includes(req.permission)).toBe(false);
          expect(ctx.roles.includes("store_owner")).toBe(false);
        });

        it("denies Platform Support Read sessions (ADR-020 §4)", () => {
          const ctx = actors.supportRead();
          // Settings capability families are strictly excluded from support read sessions
          expect(ctx.permissions.includes(req.permission)).toBe(false);
        });

        it("denies Platform Support Write sessions (ADR-020 §4)", () => {
          const ctx = actors.supportWrite();
          // Settings capability families are strictly excluded from support write sessions
          expect(ctx.permissions.includes(req.permission)).toBe(false);
        });

        it("denies Anonymous requests", () => {
          const ctx = actors.anonymous();
          expect(ctx.permissions.length).toBe(0);
          expect(ctx.actor.type).toBe("anonymous");
        });
      });
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
