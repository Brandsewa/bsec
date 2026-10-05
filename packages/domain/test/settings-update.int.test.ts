import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { SYSTEM_STORE_ROLES } from "@bs/auth";
import { schema, withTenant } from "@bs/db";
import {
  applySettingsUpdate,
  createRuntime,
  FeatureDisabledError,
  getSettingsUpdate,
  isFeatureEnabled,
  provisionTenant,
  SETTINGS_UPDATE_FEATURES,
  SETTINGS_UPDATE_OFFER_FLAG,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { enableTenantFlags } from "./helpers/feature-flags.ts";

// "Update available" prompt: the owner opts a store in to the new Settings features, one bundle, this store only.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let tenantA: string;
let tenantB: string;
let owner: TenantContext;
let manager: TenantContext;

async function mkStore(prefix: string) {
  const slug = `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await provisionTenant(rtPlatform, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  return t;
}
const ctxFor = (tenantId: string, userId: string, role: "store_owner" | "store_admin"): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId },
  roles: [role],
  permissions: [...SYSTEM_STORE_ROLES[role]],
  requestId: "req-settings-update",
});

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const a = await mkStore("upd-a");
  const b = await mkStore("upd-b");
  tenantA = a.tenantId;
  tenantB = b.tenantId;
  owner = ctxFor(tenantA, a.ownerId, "store_owner");
  manager = ctxFor(tenantA, a.ownerId, "store_admin");
});

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("Settings update offer", () => {
  it("offers nothing, and refuses to apply, until the platform opens the offer", async () => {
    expect(await getSettingsUpdate(rtWeb, owner)).toEqual({ available: false, canApply: false, features: [] });
    await expect(applySettingsUpdate(rtWeb, owner)).rejects.toBeInstanceOf(FeatureDisabledError);
    for (const f of SETTINGS_UPDATE_FEATURES) expect(await isFeatureEnabled(rtWeb._db.db, tenantA, f.key)).toBe(false);
  });

  it("shows the bundle to the owner only, and only the owner can apply it", async () => {
    await enableTenantFlags(rtPlatform._db.db, tenantA, [SETTINGS_UPDATE_OFFER_FLAG]);

    const view = await getSettingsUpdate(rtWeb, owner);
    expect(view.available).toBe(true);
    expect(view.canApply).toBe(true);
    expect(view.features.map((f) => f.key)).toEqual(SETTINGS_UPDATE_FEATURES.map((f) => f.key));

    // A Manager is told nothing and cannot apply.
    expect(await getSettingsUpdate(rtWeb, manager)).toEqual({ available: false, canApply: false, features: [] });
    await expect(applySettingsUpdate(rtWeb, manager)).rejects.toThrow(/only the store owner/i);
    // A role without settings.manage is refused before anything else.
    await expect(applySettingsUpdate(rtWeb, { ...owner, permissions: ["settings.read"] })).rejects.toThrow(/settings\.manage/);
  });

  it("Update now turns every feature on for this store only, audits it, and is then idempotent", async () => {
    const after = await applySettingsUpdate(rtWeb, owner);
    expect(after).toEqual({ available: false, canApply: false, features: [] });
    for (const f of SETTINGS_UPDATE_FEATURES) {
      expect(await isFeatureEnabled(rtWeb._db.db, tenantA, f.key), f.key).toBe(true);
      expect(await isFeatureEnabled(rtWeb._db.db, tenantB, f.key), `${f.key} for the other store`).toBe(false);
    }

    const audits = await withTenant(rtWeb._db.db, tenantA, (tx) =>
      tx.select({ diff: schema.auditLogs.diff }).from(schema.auditLogs).where(eq(schema.auditLogs.action, "settings.update_applied")),
    );
    expect(audits).toHaveLength(1);

    await applySettingsUpdate(rtWeb, owner);
    const again = await withTenant(rtWeb._db.db, tenantA, (tx) =>
      tx.select({ id: schema.auditLogs.id }).from(schema.auditLogs).where(eq(schema.auditLogs.action, "settings.update_applied")),
    );
    expect(again).toHaveLength(1);
  });
});
