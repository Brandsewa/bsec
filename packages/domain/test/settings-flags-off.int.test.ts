import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { SYSTEM_STORE_ROLES } from "@bs/auth";
import { schema, withTenant } from "@bs/db";
import {
  createRuntime,
  FeatureDisabledError,
  getStorageUsage,
  isSignInMethodBlocked,
  provisionTenant,
  scheduleMaintenance,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";
import { enableTenantFlags } from "./helpers/feature-flags.ts";

// Settings rebuild flags seed default-off (ADR-011) and must fail closed to the behaviour stores had before the
// feature existed. These tests lock that: a tenant with no override sees no change, and turning a flag on is
// what activates the new behaviour.
let env: TestDb;
let rtPlatform: Runtime;
let rtWeb: Runtime;
let tenantId: string;
let ctx: TenantContext;

beforeAll(async () => {
  env = await startTestDb();
  rtPlatform = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({ service: "web", databaseUrl: env.as("app_rw"), poolMax: 5 });
  const slug = `flags-off-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const t = await provisionTenant(rtPlatform, {
    storeName: slug,
    slug,
    owner: { email: `owner@${slug}.test`, name: "Owner" },
    planCode: "starter",
    source: "platform_admin",
  });
  tenantId = t.tenantId;
  ctx = {
    tenantId,
    storeStatus: "live",
    actor: { type: "staff", userId: t.ownerId },
    roles: ["store_owner"],
    permissions: [...SYSTEM_STORE_ROLES.store_owner],
    requestId: "req-flags-off",
  };
});

afterAll(async () => {
  await rtWeb?.close();
  await rtPlatform?.close();
  await env?.stop();
});

describe("settings flags fail closed", () => {
  it("settings.maintenance off: scheduling is refused; on: it is accepted", async () => {
    const win = { startsAt: new Date(Date.now() + 3_600_000).toISOString(), endsAt: new Date(Date.now() + 7_200_000).toISOString() };
    await expect(scheduleMaintenance(rtWeb, ctx, win)).rejects.toBeInstanceOf(FeatureDisabledError);
    await enableTenantFlags(rtPlatform._db.db, tenantId, ["settings.maintenance"]);
    await expect(scheduleMaintenance(rtWeb, ctx, win)).resolves.toBeDefined();
  });

  it("settings.storage off: the usage view is refused; on: it loads", async () => {
    await expect(getStorageUsage(rtWeb, ctx)).rejects.toBeInstanceOf(FeatureDisabledError);
    await enableTenantFlags(rtPlatform._db.db, tenantId, ["settings.storage"]);
    await expect(getStorageUsage(rtWeb, ctx)).resolves.toBeDefined();
  });

  it("settings.customer_accounts off: a method switched off in settings is still allowed; on: it is blocked", async () => {
    await withTenant(rtPlatform._db.db, tenantId, async (tx) => {
      await tx
        .insert(schema.customerAccountSettings)
        .values({ tenantId, emailPasswordEnabled: false, phoneOtpEnabled: true })
        .onConflictDoUpdate({ target: schema.customerAccountSettings.tenantId, set: { emailPasswordEnabled: false } });
    });
    expect(await isSignInMethodBlocked(rtWeb._db.db, tenantId, "emailPasswordEnabled")).toBe(false);
    await enableTenantFlags(rtPlatform._db.db, tenantId, ["settings.customer_accounts"]);
    expect(await isSignInMethodBlocked(rtWeb._db.db, tenantId, "emailPasswordEnabled")).toBe(true);
  });
});
