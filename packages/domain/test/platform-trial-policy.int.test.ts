import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createRuntime, getPlatformBillingSettings, loadTrialPolicy, provisionTenant, updatePlatformBillingSettings, type Runtime } from "../src/index.ts";

/** The free trial is a platform setting: on or off, and how many days. Real database. */
let env: TestDb;
let rt: Runtime;
let owner: string;
let admin: string;
let seq = 0;
const DAY = 24 * 60 * 60 * 1000;
const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;

async function trialOfNewStore() {
  const slug = `trial-store-${++seq}`;
  const r = await provisionTenant(rt, { storeName: slug, slug, planCode: "starter", owner: { email: `owner-${slug}@test.com`, name: "Owner" }, source: "platform_admin" });
  const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, r.tenantId));
  return sub!;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "trial-owner@platform.test", role: "platform_owner" })).userId;
  admin = (await seedPlatformStaff(rt._db.db, { email: "trial-admin@platform.test", role: "platform_admin" })).userId;
  await rt._db.db.execute(sql`DELETE FROM platform_billing_settings`);
}, 180_000);

afterAll(async () => {
  await rt._db.db.execute(sql`DELETE FROM platform_billing_settings`);
  await rt?.close();
  await env?.stop();
});

describe("platform free trial setting", () => {
  it("defaults to 14 days, and a new store gets exactly that", async () => {
    expect(await loadTrialPolicy(rt._db.db)).toEqual({ enabled: true, days: 14, effectiveDays: 14 });
    expect((await getPlatformBillingSettings(rt, owner)).trial).toEqual({ enabled: true, days: 14 });
    const sub = await trialOfNewStore();
    expect(sub.status).toBe("trialing");
    expect(Math.round((sub.currentPeriodEnd!.getTime() - Date.now()) / DAY)).toBe(14);
  });

  it("changes the days for new stores, audits it, and refuses what is out of range or not the owner", async () => {
    await updatePlatformBillingSettings(rt, owner, { trial: { days: 30 } });
    expect(Math.round(((await trialOfNewStore()).currentPeriodEnd!.getTime() - Date.now()) / DAY)).toBe(30);
    const audits = await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.action, "platform_billing.updated"));
    expect(JSON.stringify(audits)).toContain("trial.days");

    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { trial: { days: 0 } }))).toMatch(/1 to 90 days/);
    expect(await errorOf(updatePlatformBillingSettings(rt, owner, { trial: { days: 91 } }))).toMatch(/1 to 90 days/);
    expect(await errorOf(updatePlatformBillingSettings(rt, admin, { trial: { days: 5 } }))).toMatch(/platform_owner|Forbidden/i);
  });

  it("with the trial off a new store's trial has already ended, so it starts restricted until it pays; turning it on restores the days", async () => {
    await updatePlatformBillingSettings(rt, owner, { trial: { enabled: false } });
    expect(await loadTrialPolicy(rt._db.db)).toMatchObject({ enabled: false, days: 30, effectiveDays: 0 });
    const off = await trialOfNewStore();
    expect(off.currentPeriodEnd!.getTime()).toBeLessThanOrEqual(Date.now() + 1000);

    await updatePlatformBillingSettings(rt, owner, { trial: { enabled: true } });
    expect(Math.round(((await trialOfNewStore()).currentPeriodEnd!.getTime() - Date.now()) / DAY)).toBe(30);
  });
});
