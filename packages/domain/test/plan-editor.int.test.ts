import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { schema } from "@bs/db";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import { seedPlatformStaff } from "@bs/db/test-fixtures";
import { createRuntime, getPlanEditor, listPlatformStoreTransactions, listPublicPlanCompare, listPublicPlans, resolveEffectiveQuota, savePlanCompareRows, updatePlan, type Runtime } from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let admin: string;

/** Plans and the compare table are platform-wide and shared by every test file: put back what a test changed. */
async function snapshotPlan(code: string) {
  const [p] = await rt._db.db.select().from(schema.plans).where(eq(schema.plans.code, code)).limit(1);
  const limits = await rt._db.db.execute<{ tier_code: string; quota_key: string; value: number }>(
    sql`SELECT tier_code, quota_key, value FROM quota_tier_limits WHERE tier_code = 'S'`,
  );
  return { plan: p!, limits: limits.rows };
}
async function restorePlan(snap: Awaited<ReturnType<typeof snapshotPlan>>) {
  const p = snap.plan;
  await rt._db.db
    .update(schema.plans)
    .set({ priceMonthlyPaise: p.priceMonthlyPaise, priceYearlyPaise: p.priceYearlyPaise, limits: p.limits, tagline: p.tagline, cardBullets: p.cardBullets })
    .where(eq(schema.plans.id, p.id));
  for (const l of snap.limits) {
    await rt._db.db.execute(sql`UPDATE quota_tier_limits SET value = ${l.value} WHERE tier_code = ${l.tier_code} AND quota_key = ${l.quota_key}`);
  }
}

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  admin = (await seedPlatformStaff(rt._db.db, { email: "plan-editor-admin@platform.test", role: "platform_admin" })).userId;
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

describe("plan editor", () => {
  it("returns the seeded plans with enforced limits and the compare table", async () => {
    const view = await getPlanEditor(rt);
    const starter = view.plans.find((p) => p.code === "starter");
    expect(starter?.tier).toBe("S");
    expect(typeof starter?.limits.products).toBe("number");
    expect(starter?.cardBullets.length).toBeGreaterThan(0);
    expect(view.compareRows.some((r) => r.limitKey === "products")).toBe(true);
  });

  it("writes a limit to the plan's size tier, so enforcement and the displayed number agree", async () => {
    const snap = await snapshotPlan("starter");
    try {
      await updatePlan(rt, admin, { code: "starter", limits: { products: 1234, variants: 4321, emails_month: 2000, max_extra_markets: 0 } });
      const [row] = (await rt._db.db.execute<{ value: number }>(sql`SELECT value FROM quota_tier_limits WHERE tier_code = 'S' AND quota_key = 'products'`)).rows;
      expect(row?.value).toBe(1234);

      // Enforcement reads the same number: a store on tier S now has the new limit.
      const org = await rt._db.db.insert(schema.organizations).values({ name: "Plan editor org" }).returning({ id: schema.organizations.id });
      const [tenant] = await rt._db.db
        .insert(schema.tenants)
        .values({ organizationId: org[0]!.id, slug: `pe-${Date.now()}`, name: "PE store" })
        .returning({ id: schema.tenants.id });
      await rt._db.db.insert(schema.tenantSizeTiers).values({ tenantId: tenant!.id, tier: "S" });
      const quota = await resolveEffectiveQuota(rt._db.db, tenant!.id, "products");
      expect(quota.limit).toBe(1234);

      // The public listing prints the enforced limit inside the saved bullet text.
      const pub = (await listPublicPlans(rt._db.db)).find((p) => p.code === "starter");
      expect(pub?.bullets.join(" | ")).toContain("1,234");
      expect(pub?.limits.max_extra_markets).toBe(0);
    } finally {
      await restorePlan(snap);
    }
  });

  it("flags a price change and audits the edit with before and after values", async () => {
    const snap = await snapshotPlan("growth");
    try {
      const same = await updatePlan(rt, admin, { code: "growth", priceMonthlyPaise: Number(snap.plan.priceMonthlyPaise) });
      expect(same.priceChanged).toBe(false);
      const changed = await updatePlan(rt, admin, { code: "growth", priceMonthlyPaise: 499900 });
      expect(changed.priceChanged).toBe(true);
      const [log] = (
        await rt._db.db.execute<{ diff: { before: { priceMonthlyPaise: number }; after: { priceMonthlyPaise: number } } }>(
          sql`SELECT diff FROM platform_audit_logs WHERE action = 'plan.update' AND target_id = ${snap.plan.id} ORDER BY created_at DESC LIMIT 1`,
        )
      ).rows;
      expect(log?.diff.after.priceMonthlyPaise).toBe(499900);
      expect(log?.diff.before.priceMonthlyPaise).toBe(Number(snap.plan.priceMonthlyPaise));
    } finally {
      await restorePlan(snap);
    }
  });

  it("refuses to edit limits of a plan that has no size tier of its own, and an unknown plan", async () => {
    const [custom] = await rt._db.db
      .insert(schema.plans)
      .values({ code: `custom-${Date.now()}`, name: "Custom", priceMonthlyPaise: 1, priceYearlyPaise: 1, isPublic: false })
      .returning({ code: schema.plans.code, id: schema.plans.id });
    try {
      await expect(updatePlan(rt, admin, { code: custom!.code, limits: { products: 1 } })).rejects.toThrow(/size tier of its own/);
      await expect(updatePlan(rt, admin, { code: "nope" })).rejects.toThrow(/not found/i);
    } finally {
      await rt._db.db.delete(schema.plans).where(eq(schema.plans.id, custom!.id));
    }
  });

  it("saves the compare table and renders limit rows with the enforced value for every public plan", async () => {
    const before = await rt._db.db.select().from(schema.planCompareRows);
    try {
      await savePlanCompareRows(rt, admin, [
        { groupName: "Limits", label: "Products", limitKey: "products", cells: {}, isVisible: true },
        { groupName: "Core store", label: "Themes", cells: { starter: { k: "tick" }, growth: { k: "tick" }, pro: { k: "text", t: "Custom" } }, isVisible: true },
        { groupName: "Core store", label: "Hidden row", cells: {}, isVisible: false },
      ]);
      const compare = await listPublicPlanCompare(rt._db.db);
      expect(compare.groups.map((g) => g.groupName)).toEqual(["Limits", "Core store"]);
      const products = compare.groups[0]!.rows[0]!;
      expect(products.cells.starter?.k).toBe("text");
      const themes = compare.groups[1]!.rows;
      expect(themes).toHaveLength(1); // the hidden row is not shown to merchants
      expect(themes[0]!.cells.pro).toEqual({ k: "text", t: "Custom" });
    } finally {
      await rt._db.db.delete(schema.planCompareRows);
      if (before.length) await rt._db.db.insert(schema.planCompareRows).values(before);
    }
  });
});

describe("platform ledger", () => {
  it("lists store transactions across stores, filtered by a tenant-name search", async () => {
    const org = await rt._db.db.insert(schema.organizations).values({ name: "Ledger org" }).returning({ id: schema.organizations.id });
    const [tenant] = await rt._db.db
      .insert(schema.tenants)
      .values({ organizationId: org[0]!.id, slug: `ledger-${Date.now()}`, name: "Ledger Lane Store" })
      .returning({ id: schema.tenants.id });
    const rows = await listPlatformStoreTransactions(rt, { search: "Ledger Lane Store" });
    // No payments exist for this store yet, and the query must not leak any other store's rows into the search.
    expect(rows.filter((r) => r.tenantId !== tenant!.id)).toEqual([]);
  });
});
