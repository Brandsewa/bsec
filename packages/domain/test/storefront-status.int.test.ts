import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { schema, withTenant } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  evaluateStorefrontAccess,
  getStoreStatus,
  invalidateHostCache,
  listSettingsActivity,
  needsStorePasswordRehash,
  provisionTenant,
  tenantTag,
  updateStoreStatus,
  verifyStorefrontPassword,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime; // platform service: provisions the stores
let rtWeb: Runtime; // tenant runtime (app_rw), like apps/web
let storeA: { tenantId: string; ownerId: string; host: string };
let storeB: { tenantId: string; ownerId: string; host: string };
const invalidatedTags: string[][] = [];

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

const ctxFor = (s: { tenantId: string; ownerId: string }, permissions = ["settings.write"]): TenantContext => ({
  tenantId: s.tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: s.ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req-test",
});

async function mkStore(slug: string) {
  const r = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "starter", source: "platform_admin" });
  const [d] = await rt._db.db.select({ hostname: schema.domains.hostname }).from(schema.domains).where(eq(schema.domains.tenantId, r.tenantId)).limit(1);
  if (!d) throw new Error("provisioning created no domain");
  return { tenantId: r.tenantId, ownerId: r.ownerId, host: d.hostname };
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  rtWeb = createRuntime({
    service: "web",
    databaseUrl: env.as("app_rw"),
    poolMax: 5,
    revalidateTags: (tags) => {
      invalidatedTags.push(tags);
    },
  });
  storeA = await mkStore("status-a");
  storeB = await mkStore("status-b");
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await rtWeb?.close();
  await env?.stop();
});

describe("storefront mode (going live)", () => {
  it("a new store starts hidden behind the coming-soon page", async () => {
    const status = await getStoreStatus(rtWeb, ctxFor(storeA));
    expect(status).toMatchObject({ mode: "coming_soon", hasPassword: false, collectEmails: true });
    invalidateHostCache();
    const access = await evaluateStorefrontAccess(rt._db.db, storeA.host);
    expect(access).toMatchObject({ allowed: false, reason: "coming_soon" });
  });

  it("switching to live opens the public storefront, and only that store", async () => {
    invalidatedTags.length = 0;
    await updateStoreStatus(rtWeb, ctxFor(storeA), { mode: "live" });
    expect((await getStoreStatus(rtWeb, ctxFor(storeA))).mode).toBe("live");
    expect(invalidatedTags.length).toBeGreaterThan(0);
    expect(invalidatedTags[0]).toContain(tenantTag(storeA.tenantId, "store-shell"));
    expect(invalidatedTags[0]).toContain(tenantTag(storeA.tenantId, "seo"));
    invalidateHostCache();
    expect(await evaluateStorefrontAccess(rt._db.db, storeA.host)).toMatchObject({ allowed: true, httpStatus: 200 });
    // the other store is untouched
    expect((await getStoreStatus(rtWeb, ctxFor(storeB))).mode).toBe("coming_soon");
    expect(await evaluateStorefrontAccess(rt._db.db, storeB.host)).toMatchObject({ allowed: false, reason: "coming_soon" });
  });

  it("records who changed it and can put the store back to coming soon with a headline", async () => {
    await updateStoreStatus(rtWeb, ctxFor(storeA), { mode: "coming_soon", headline: "Back soon" });
    const status = await getStoreStatus(rtWeb, ctxFor(storeA));
    expect(status).toMatchObject({ mode: "coming_soon", headline: "Back soon" });
    const [row] = await rt._db.db.select().from(schema.storeStatus).where(eq(schema.storeStatus.tenantId, storeA.tenantId));
    expect(row?.changedBy).toBe(storeA.ownerId);
  });

  it("password mode needs a password first", async () => {
    expect(await errorOf(updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "password" }))).toMatch(/set a password/);
    await updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "password", password: "open-sesame-1" });
    expect(await getStoreStatus(rtWeb, ctxFor(storeB))).toMatchObject({ mode: "password", hasPassword: true });
    // an existing password is enough when only the mode changes back
    await updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "live" });
    await updateStoreStatus(rtWeb, ctxFor(storeB), { mode: "password" });
    expect((await getStoreStatus(rtWeb, ctxFor(storeB))).mode).toBe("password");
  });

  it("lazy re-hashes a legacy SHA-256 password upon successful verification", async () => {
    const legacyPlain = "legacy-pass-123";
    const legacyHash = createHash("sha256").update(legacyPlain).digest("hex");
    await rt._db.db
      .update(schema.storeStatus)
      .set({ passwordHash: legacyHash, mode: "password" })
      .where(eq(schema.storeStatus.tenantId, storeB.tenantId));

    expect(needsStorePasswordRehash(legacyHash)).toBe(true);

    const result = await verifyStorefrontPassword(rtWeb, ctxFor(storeB), legacyPlain);
    expect(result.success).toBe(true);

    const [row] = await rt._db.db
      .select({ passwordHash: schema.storeStatus.passwordHash })
      .from(schema.storeStatus)
      .where(eq(schema.storeStatus.tenantId, storeB.tenantId));

    expect(row?.passwordHash).toBeTruthy();
    expect(row!.passwordHash!.startsWith("$scrypt$")).toBe(true);
    expect(needsStorePasswordRehash(row!.passwordHash!)).toBe(false);
  });

  it("needs settings.read to read and storefront.manage to change it", async () => {
    const nobody = ctxFor(storeA, ["products.read"]);
    expect(await errorOf(getStoreStatus(rtWeb, nobody))).toMatch(/Forbidden/);
    expect(await errorOf(updateStoreStatus(rtWeb, nobody, { mode: "live" }))).toMatch(/Forbidden/);

    const reader = ctxFor(storeA, ["settings.read"]);
    const status = await getStoreStatus(rtWeb, reader);
    expect(status).toBeDefined();
    expect(await errorOf(updateStoreStatus(rtWeb, reader, { mode: "live" }))).toMatch(/Forbidden/);

    const manager = ctxFor(storeA, ["storefront.manage"]);
    const updateResult = await updateStoreStatus(rtWeb, manager, { headline: "Updated by manager" });
    expect(updateResult.success).toBe(true);
  });

  it("writes a store_status.update audit log with sanitized diff", async () => {
    const adminCtx = ctxFor(storeA, ["storefront.manage", "audit.read"]);
    await updateStoreStatus(rtWeb, adminCtx, {
      mode: "coming_soon",
      headline: "Audit test headline",
      password: "secret-password-123",
    });

    // Verify stored DB audit log row
    const [rawAudit] = await withTenant(rtWeb._db.db, storeA.tenantId, (tx) =>
      tx
        .select()
        .from(schema.auditLogs)
        .where(eq(schema.auditLogs.tenantId, storeA.tenantId))
        .orderBy(desc(schema.auditLogs.createdAt), desc(schema.auditLogs.id))
        .limit(1),
    );

    expect(rawAudit?.action).toBe("store_status.update");
    expect(rawAudit?.targetType).toBe("store_status");
    const rawDiff = rawAudit!.diff as Record<string, { before: unknown; after: unknown }>;
    expect(rawDiff.headline?.after).toBe("Audit test headline");
    // Verify password is stored in audit log ONLY as "set", never plaintext or hash
    expect(rawDiff.password?.after).toBe("set");
    expect(JSON.stringify(rawDiff)).not.toContain("secret-password-123");
    expect(JSON.stringify(rawDiff)).not.toContain("$scrypt$");

    // Verify listSettingsActivity also returns this under area Storefront
    const activity = await listSettingsActivity(rtWeb, adminCtx, { area: "Storefront" });
    expect(activity.total).toBeGreaterThanOrEqual(1);

    const latest = activity.items[0];
    expect(latest?.action).toBe("store_status.update");
    expect(latest?.area).toBe("Storefront");
    // listSettingsActivity additionally sanitizes all secret-like keys to [REDACTED]
    const activityDiff = latest!.diff as Record<string, { before: unknown; after: unknown }>;
    expect(activityDiff.password?.after).toBe("[REDACTED]");
    expect(JSON.stringify(activity)).not.toContain("secret-password-123");
    expect(JSON.stringify(activity)).not.toContain("$scrypt$");
  });
});

