import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { call } from "@orpc/server";
import { and, eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createLogger, createRuntime, getAdminMe, provisionTenant, type Runtime } from "@bs/domain";
import { platformRouter, type PlatformContext } from "../src/app.ts";

process.env.BETTER_AUTH_SECRET = "test-activate-store-secret-0123456789abcdef";

let env: TestDb;
let rt: Runtime;
let staff: { userId: string; freshSessionAt: Date };
let support: { userId: string; freshSessionAt: Date };

const ctxFor = (s: { userId: string; freshSessionAt: Date }): PlatformContext => ({
  rt,
  log: createLogger("activate-store-test"),
  session: { user: { id: s.userId }, type: "platform_staff", createdAt: s.freshSessionAt },
  meta: { ip: "203.0.113.9", userAgent: "vitest", requestId: "req-activate" },
});
const activate = (s: { userId: string; freshSessionAt: Date }, input: { id: string; days: number; reason: string }) =>
  call(platformRouter.tenants.activate, input as never, { context: ctxFor(s) } as never) as Promise<{ ok: boolean; activeUntil: string }>;

/** A self-service store created with the free trial off: payment required, on the restricted tier. */
async function mkWaitingStore() {
  const slug = `act-${Math.random().toString(36).slice(2, 8)}`;
  const r = await provisionTenant(rt, { storeName: slug, slug, owner: { email: `owner@${slug}.test`, name: "Owner" }, planCode: "growth", source: "platform_admin" });
  const db = rt._db.db;
  await db.update(schema.subscriptions).set({ paymentRequired: true, status: "past_due", currentPeriodEnd: new Date(Date.now() - 86_400_000) }).where(eq(schema.subscriptions.tenantId, r.tenantId));
  await db.update(schema.tenantSizeTiers).set({ tier: "xs" }).where(eq(schema.tenantSizeTiers.tenantId, r.tenantId));
  return r;
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 4 });
  staff = await seedPlatformStaff(rt._db.db, { email: "admin@platform.test", role: "platform_admin" });
  support = await seedPlatformStaff(rt._db.db, { email: "support@platform.test", role: "platform_support" });
}, 240_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("Super Admin: activate a store that is waiting for payment", () => {
  it("opens the store as a timed trial, restores its plan tier and clears the activation screen", async () => {
    const r = await mkWaitingStore();
    expect((await getAdminMe(rt, r.ownerId)).stores.find((s) => s.tenantId === r.tenantId)?.paymentRequired).toBe(true);

    const res = await activate(staff, { id: r.tenantId, days: 30, reason: "test store, platform billing not live" });
    expect(res.ok).toBe(true);

    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, r.tenantId));
    expect(sub).toMatchObject({ paymentRequired: false, status: "trialing", pastDueSince: null, dunningStage: 0 });
    const days = ((sub!.currentPeriodEnd as Date).getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(29.9);
    expect(days).toBeLessThan(30.1);
    expect(res.activeUntil).toBe((sub!.currentPeriodEnd as Date).toISOString());

    const [tier] = await rt._db.db.select().from(schema.tenantSizeTiers).where(eq(schema.tenantSizeTiers.tenantId, r.tenantId));
    expect(tier!.tier).not.toBe("xs");
    expect((await getAdminMe(rt, r.ownerId)).stores.find((s) => s.tenantId === r.tenantId)?.paymentRequired).toBe(false);

    const [audit] = await rt._db.db
      .select()
      .from(schema.platformAuditLogs)
      .where(and(eq(schema.platformAuditLogs.tenantId, r.tenantId), eq(schema.platformAuditLogs.action, "tenant.activate")));
    expect(audit?.actorUserId).toBe(staff.userId);
    expect(audit?.diff).toMatchObject({ days: 30, reason: "test store, platform billing not live" });
  });

  it("refuses a store that is not waiting, so a paying store's billing is never overwritten", async () => {
    const r = await mkWaitingStore();
    await activate(staff, { id: r.tenantId, days: 7, reason: "first activation" });
    await expect(activate(staff, { id: r.tenantId, days: 7, reason: "second try" })).rejects.toThrow(/not waiting for activation/);
  });

  it("is limited to platform admins", async () => {
    const r = await mkWaitingStore();
    await expect(activate(support, { id: r.tenantId, days: 7, reason: "support tries" })).rejects.toThrow();
    const [sub] = await rt._db.db.select().from(schema.subscriptions).where(eq(schema.subscriptions.tenantId, r.tenantId));
    expect(sub!.paymentRequired).toBe(true);
  });
});
