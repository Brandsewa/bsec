import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import {
  cancelTenantPromotion,
  createPromotion,
  endDuePromotions,
  grantPromotion,
  listPromotions,
  listTenantPromotions,
  provisionTenant,
  quotePromotionTerm,
  updatePromotion,
  createRuntime,
  type Runtime,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let owner: string;
let admin: string;
let seq = 0;

const errorOf = async (p: Promise<unknown>) => (await p.then(() => null, (e: Error) => e))?.message ?? null;
const slug = () => `promo-store-${++seq}`;

async function makeStore(planCode: "starter" | "growth" = "starter", promoCode?: string) {
  const s = slug();
  return provisionTenant(rt, { storeName: s, slug: s, owner: { email: `owner-${s}@test.com`, name: "Owner" }, planCode, source: "platform_admin", ...(promoCode ? { promoCode } : {}) });
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  owner = (await seedPlatformStaff(rt._db.db, { email: "promo-owner@platform.test", role: "platform_owner" })).userId;
  admin = (await seedPlatformStaff(rt._db.db, { email: "promo-admin@platform.test", role: "platform_admin" })).userId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("promotions", () => {
  it("only the platform owner creates promotions, and a promotion lasts at most 12 months", async () => {
    const base = { code: "LAUNCH-2026", name: "Launch", kind: "percent_off" as const, percentOff: 25, durationMonths: 6 };
    expect(await errorOf(createPromotion(rt, admin, base))).toMatch(/platform_owner|Forbidden/i);
    expect(await errorOf(createPromotion(rt, owner, { ...base, durationMonths: 13 }))).toMatch(/1 to 12 months/);
    expect(await errorOf(createPromotion(rt, owner, { ...base, percentOff: 0 }))).toMatch(/1 to 100/);
    expect(await errorOf(createPromotion(rt, owner, { ...base, code: "x" }))).toMatch(/3 to 32/);

    const created = await createPromotion(rt, owner, { ...base, code: " launch 2026 " });
    expect(created).toMatchObject({ code: "LAUNCH2026", kind: "percent_off", percentOff: 25, durationMonths: 6, isActive: true, redeemedCount: 0 });
    expect(await errorOf(createPromotion(rt, owner, { ...base, code: "launch2026" }))).toMatch(/already exists/i); // same code, different spelling
    expect((await listPromotions(rt, admin)).map((p) => p.code)).toContain("LAUNCH2026"); // staff can read
  });

  it("grants a free year to a store, one active promotion at a time, and cancels it", async () => {
    const store = await makeStore();
    expect(await errorOf(grantPromotion(rt, admin, { tenantId: store.tenantId, termMonths: 12, custom: { kind: "free_months", durationMonths: 12 } }))).toMatch(/platform_owner|Forbidden/i);
    expect(await errorOf(grantPromotion(rt, owner, { tenantId: store.tenantId, termMonths: 12, custom: { kind: "free_months", durationMonths: 24 } }))).toMatch(/1 to 12 months/);
    expect(await errorOf(grantPromotion(rt, owner, { tenantId: store.tenantId, termMonths: 9 as 12, custom: { kind: "free_months", durationMonths: 12 } }))).toMatch(/6, 12 or 36/);
    expect(await errorOf(grantPromotion(rt, owner, { tenantId: store.tenantId, termMonths: 12 }))).toMatch(/not both|choose a promotion/i);

    const now = new Date("2026-10-17T10:00:00Z");
    const grant = await grantPromotion(rt, owner, { tenantId: store.tenantId, termMonths: 36, custom: { kind: "free_months", durationMonths: 12 }, note: "Partner" }, undefined, now);
    expect(grant).toMatchObject({ status: "active", kind: "free_months", durationMonths: 12, termMonths: 36, source: "staff", note: "Partner", planCode: "starter" });
    expect(grant.endsAt).toBe("2027-10-17T10:00:00.000Z");

    expect(await errorOf(grantPromotion(rt, owner, { tenantId: store.tenantId, termMonths: 12, custom: { kind: "percent_off", percentOff: 10, durationMonths: 3 } }))).toMatch(/already has an active promotion/);

    await expect(cancelTenantPromotion(rt, owner, { id: grant.id })).resolves.toEqual({ ok: true });
    expect((await listTenantPromotions(rt, admin, store.tenantId))[0]).toMatchObject({ status: "cancelled" });
    expect(await errorOf(cancelTenantPromotion(rt, owner, { id: grant.id }))).toMatch(/no longer active/);
    // after cancelling, another can be granted
    await expect(grantPromotion(rt, owner, { tenantId: store.tenantId, termMonths: 12, custom: { kind: "percent_off", percentOff: 10, durationMonths: 3 } })).resolves.toMatchObject({ status: "active" });

    const audit = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, store.tenantId))).map((r) => r.action);
    expect(audit).toEqual(expect.arrayContaining(["promotion.granted", "promotion.cancelled"]));
  });

  it("redeems a promo code while a store is created, and a bad code creates nothing", async () => {
    await createPromotion(rt, owner, { code: "GROWTH-ONLY", name: "Growth only", kind: "free_months", durationMonths: 3, appliesToPlanCodes: ["growth"], maxRedemptions: 1 });

    const ok = await makeStore("growth", "growth-only");
    const grants = await listTenantPromotions(rt, admin, ok.tenantId);
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ source: "code", promotionCode: "GROWTH-ONLY", planCode: "growth", status: "active" });
    expect((await listPromotions(rt, admin)).find((p) => p.code === "GROWTH-ONLY")!.redeemedCount).toBe(1);

    // fully redeemed, wrong plan, unknown, off: each stops provisioning and leaves no store behind
    const failures: Array<[string, "starter" | "growth", RegExp]> = [
      ["GROWTH-ONLY", "growth", /fully redeemed/],
      ["NOPE-CODE", "growth", /not valid/],
    ];
    for (const [code, plan, message] of failures) {
      const s = slug();
      expect(await errorOf(provisionTenant(rt, { storeName: s, slug: s, owner: { email: `o-${s}@test.com`, name: "O" }, planCode: plan, source: "platform_admin", promoCode: code }))).toMatch(message);
      const [row] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.slug, s));
      expect(row).toBeUndefined();
    }
    const wrong = await createPromotion(rt, owner, { code: "STARTER-ONLY", name: "Starter only", kind: "percent_off", percentOff: 50, durationMonths: 2, appliesToPlanCodes: ["starter"] });
    const s2 = slug();
    expect(await errorOf(provisionTenant(rt, { storeName: s2, slug: s2, owner: { email: `o-${s2}@test.com`, name: "O" }, planCode: "growth", source: "platform_admin", promoCode: "STARTER-ONLY" }))).toMatch(/does not apply to the chosen plan/);
    await updatePromotion(rt, owner, { id: wrong.id, isActive: false });
    const s3 = slug();
    expect(await errorOf(provisionTenant(rt, { storeName: s3, slug: s3, owner: { email: `o-${s3}@test.com`, name: "O" }, planCode: "starter", source: "platform_admin", promoCode: "STARTER-ONLY" }))).toMatch(/not active/);
  });

  it("quotes a prepaid term from the plan price, with the promotion on its first months", async () => {
    const [growth] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, "growth"));
    const monthly = Number(growth!.priceMonthlyPaise);
    const q = await quotePromotionTerm(rt, admin, { planCode: "growth", termMonths: 36, custom: { kind: "free_months", durationMonths: 12 } });
    expect(q).toMatchObject({ planName: growth!.name, monthlyPricePaise: monthly, termMonths: 36, totalPaise: monthly * 24, discountPaise: monthly * 12, taxPaise: 0 });
    expect(await errorOf(quotePromotionTerm(rt, admin, { planCode: "nope", termMonths: 12 }))).toMatch(/plan not found/i);
  });

  it("when a free period ends without payment the store is suspended; a discount just ends; a paying store is left alone", async () => {
    const free = await makeStore();
    const discount = await makeStore();
    const paying = await makeStore();
    await rt._db.db.update(schema.subscriptions).set({ providerSubscriptionId: "sub_paid_1" }).where(eq(schema.subscriptions.tenantId, paying.tenantId));

    // Dates in the past so grants made by other tests (at the real time) are never due in this sweep.
    const start = new Date("2020-01-10T00:00:00Z");
    await grantPromotion(rt, owner, { tenantId: free.tenantId, termMonths: 12, custom: { kind: "free_months", durationMonths: 12 } }, undefined, start);
    await grantPromotion(rt, owner, { tenantId: discount.tenantId, termMonths: 12, custom: { kind: "percent_off", percentOff: 40, durationMonths: 3 } }, undefined, start);
    await grantPromotion(rt, owner, { tenantId: paying.tenantId, termMonths: 12, custom: { kind: "free_months", durationMonths: 2 } }, undefined, start);

    // before the end dates nothing changes
    expect(await endDuePromotions(rt, new Date("2020-02-01T00:00:00Z"))).toEqual({ ended: 0, suspended: 0 });
    // the paying store's 2-month promotion and the discount are over; the free year is not
    const mid = await endDuePromotions(rt, new Date("2020-06-01T00:00:00Z"));
    expect(mid).toEqual({ ended: 2, suspended: 0 });

    const after = await endDuePromotions(rt, new Date("2021-02-01T00:00:00Z"));
    expect(after).toEqual({ ended: 1, suspended: 1 });
    const [t] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, free.tenantId));
    expect(t).toMatchObject({ status: "suspended", suspendedReason: expect.stringContaining("Choose a plan") });
    for (const other of [discount, paying]) {
      const [o] = await rt._db.db.select().from(schema.tenants).where(eq(schema.tenants.id, other.tenantId));
      expect(o!.status).not.toBe("suspended");
    }
    expect((await listTenantPromotions(rt, admin, free.tenantId))[0]).toMatchObject({ status: "ended" });
    // running it again finds nothing
    expect(await endDuePromotions(rt, new Date("2021-02-01T00:00:00Z"))).toEqual({ ended: 0, suspended: 0 });
    const actions = (await rt._db.db.select().from(schema.platformAuditLogs).where(eq(schema.platformAuditLogs.tenantId, free.tenantId))).map((r) => r.action);
    expect(actions).toContain("promotion.ended");
  });
});
