import { describe, expect, it } from "vitest";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "../src/schema/index.ts";
import { tenantTableNames } from "../src/tenant-table.ts";

describe("M1 Schema Definitions", () => {
  it("exports all expected platform tables", () => {
    expect(schema.tenants).toBeDefined();
    expect(schema.organizations).toBeDefined();
    expect(schema.domains).toBeDefined();
    expect(schema.featureFlags).toBeDefined();
    expect(schema.tenantFeatureOverrides).toBeDefined();
    expect(schema.platformStaff).toBeDefined();
  });

  it("exports all expected identity tables", () => {
    expect(schema.users).toBeDefined();
    expect(schema.sessions).toBeDefined();
    expect(schema.accounts).toBeDefined();
    expect(schema.verifications).toBeDefined();
    expect(schema.roles).toBeDefined();
    expect(schema.memberships).toBeDefined();
    expect(schema.staffInvitations).toBeDefined();
    expect(schema.auditLogs).toBeDefined();
    expect(schema.customerSessions).toBeDefined();
  });

  it("exports all expected settings tables", () => {
    expect(schema.storeSettings).toBeDefined();
  });

  it("registers all tenant tables in tenantTableNames", () => {
    const expected = [
      "tenant_feature_overrides",
      "roles",
      "memberships",
      "staff_invitations",
      "audit_logs",
      "customer_sessions",
      "store_settings",
    ];
    for (const name of expected) {
      expect(tenantTableNames.has(name), `Missing registration for ${name}`).toBe(true);
    }
  });

  it("enforces tenant-scoped unique constraints and composite FKs on memberships", () => {
    const cfg = getTableConfig(schema.memberships);
    expect(cfg.enableRLS).toBe(true);
    const uniq = cfg.uniqueConstraints.find((u) => u.name === "memberships_tenant_user_uniq");
    expect(uniq).toBeDefined();

    const roleFk = cfg.foreignKeys.find((f) => f.getName() === "memberships_role_fk");
    expect(roleFk).toBeDefined();
    expect(roleFk?.onDelete).toBe("restrict");
    const ref = roleFk?.reference();
    expect(ref?.columns.map((c) => c.name)).toEqual(["tenant_id", "role_id"]);
    expect(ref?.foreignColumns.map((c) => c.name)).toEqual(["tenant_id", "id"]);
  });

  it("enforces tenant-scoped unique constraint on store_settings", () => {
    const cfg = getTableConfig(schema.storeSettings);
    expect(cfg.enableRLS).toBe(true);
    const uniq = cfg.uniqueConstraints.find((u) => u.name === "store_settings_tenant_id_uniq");
    expect(uniq).toBeDefined();
    expect(uniq?.columns.map((c) => c.name)).toEqual(["tenant_id"]);
  });

  it("enforces tenant-scoped unique constraint on roles", () => {
    const cfg = getTableConfig(schema.roles);
    expect(cfg.enableRLS).toBe(true);
    const uniq = cfg.uniqueConstraints.find((u) => u.name === "roles_tenant_name_uniq");
    expect(uniq).toBeDefined();
    expect(uniq?.columns.map((c) => c.name)).toEqual(["tenant_id", "name"]);
  });
});
