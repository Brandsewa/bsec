import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestDb, type TestDb } from "@bs/db/test-env";
import {
  createRuntime,
  getAdminShippingSettings,
  getTenantShippingRates,
  previewShippingRate,
  provisionTenant,
  saveAdminShippingZones,
  type Runtime,
  type TenantContext,
} from "../src/index.ts";

let env: TestDb;
let rt: Runtime;
let ctx: TenantContext;
let otherCtx: TenantContext;

const ctxFor = (tenantId: string, ownerId: string, permissions = ["settings.read", "shipping.manage"]): TenantContext => ({
  tenantId,
  storeStatus: "live",
  actor: { type: "staff", userId: ownerId },
  roles: ["store_owner"],
  permissions,
  requestId: "req_shipping_zones_test",
});

beforeAll(async () => {
  env = await startTestDb();
  rt = createRuntime({ service: "platform", databaseUrl: env.as("app_platform"), poolMax: 5 });
  const a = await provisionTenant(rt, { storeName: "zt-ship-a", slug: "zt-ship-a", owner: { email: "owner-zt-ship-a@test.com", name: "Owner A" }, planCode: "starter", source: "platform_admin" });
  const b = await provisionTenant(rt, { storeName: "zt-ship-b", slug: "zt-ship-b", owner: { email: "owner-zt-ship-b@test.com", name: "Owner B" }, planCode: "starter", source: "platform_admin" });
  ctx = ctxFor(a.tenantId, a.ownerId);
  otherCtx = ctxFor(b.tenantId, b.ownerId);
}, 180_000);

afterAll(async () => {
  await rt?.close();
  await env?.stop();
});

const rate = (over: Record<string, unknown>) => ({
  name: "Standard",
  method: "standard" as const,
  rateType: "flat" as const,
  pricePaise: 5000,
  minDays: 3,
  maxDays: 6,
  ...over,
});

describe("shipping zones and tiers", () => {
  it("keeps the seeded default behaviour: default zone, flat standard and express, no destination needed", async () => {
    const settings = await getAdminShippingSettings(rt, ctx);
    expect(settings.zones).toHaveLength(1);
    expect(settings.zones[0]!.states).toEqual([]);
    const rates = await getTenantShippingRates(rt._db.db, ctx.tenantId, 50_000);
    expect(rates.map((r) => r.method)).toEqual(["standard"]); // a new store is seeded with a flat standard rate and free-above
  });

  it("prices by weight tier and order value tier inside a zone, and by state across zones", async () => {
    const current = await getAdminShippingSettings(rt, ctx);
    const defaultZone = current.zones.find((z) => z.isDefault)!;

    await saveAdminShippingZones(rt, ctx, {
      zones: [
        {
          id: defaultZone.id,
          name: "India",
          countries: ["IN"],
          states: [],
          isDefault: true,
          rates: [
            rate({ name: "Light", rateType: "weight_tier", minWeightGrams: 0, maxWeightGrams: 500, pricePaise: 4000 }),
            rate({ name: "Heavy", rateType: "weight_tier", minWeightGrams: 500, maxWeightGrams: null, pricePaise: 9000 }),
            rate({ name: "Express by value", method: "express", rateType: "price_tier", minSubtotalPaise: 0, maxSubtotalPaise: 100_000, pricePaise: 15_000, minDays: 1, maxDays: 2 }),
            rate({ name: "Express big orders", method: "express", rateType: "price_tier", minSubtotalPaise: 100_000, maxSubtotalPaise: null, pricePaise: 0, minDays: 1, maxDays: 2 }),
          ],
        },
        {
          name: "South",
          countries: ["IN"],
          states: ["Kerala", "Tamil Nadu"],
          isDefault: false,
          rates: [rate({ name: "South flat", pricePaise: 2500 })],
        },
        {
          name: "Gulf",
          countries: ["AE", "QA"],
          states: [],
          isDefault: false,
          rates: [rate({ name: "Gulf flat", pricePaise: 60_000 })],
        },
      ],
    });

    const at = (subtotal: number, weight: number, dest?: { country?: string; state?: string }) =>
      getTenantShippingRates(rt._db.db, ctx.tenantId, subtotal, { weightGrams: weight, destination: dest });

    // default zone, weight tiers (min inclusive, max exclusive)
    expect((await at(10_000, 499)).find((r) => r.method === "standard")).toMatchObject({ title: "Light", amount: 4000 });
    expect((await at(10_000, 500)).find((r) => r.method === "standard")).toMatchObject({ title: "Heavy", amount: 9000 });
    // price tiers decide express
    expect((await at(99_999, 0)).find((r) => r.method === "express")).toMatchObject({ title: "Express by value", amount: 15_000 });
    expect((await at(100_000, 0)).find((r) => r.method === "express")).toMatchObject({ title: "Express big orders", amount: 0, isFree: true });
    // state zone wins for Kerala; a state outside it uses the whole-country default zone
    expect((await at(10_000, 900, { country: "IN", state: "kerala" })).map((r) => r.title)).toEqual(["South flat"]);
    expect((await at(10_000, 900, { country: "IN", state: "Goa" })).find((r) => r.method === "standard")?.title).toBe("Heavy");
    // another country picks its own zone
    expect((await at(10_000, 100, { country: "AE" })).map((r) => r.title)).toEqual(["Gulf flat"]);

    const preview = await previewShippingRate(rt, ctx, { subtotalPaise: 10_000, weightGrams: 900, destinationCountry: "IN", destinationState: "Tamil Nadu" });
    expect(preview.zoneName).toBe("South");
    expect(preview.rates[0]).toMatchObject({ title: "South flat", amountPaise: 2500 });
  });

  it("validates the whole set before writing anything", async () => {
    const before = await getAdminShippingSettings(rt, ctx);
    const base = before.zones.map((z) => ({
      id: z.id,
      name: z.name,
      countries: z.countries,
      states: z.states ?? [],
      isDefault: z.isDefault,
      rates: z.rates.map((r) => ({
        id: r.id,
        name: r.name,
        method: r.method as "standard" | "express",
        rateType: r.rateType as "flat" | "free_above_threshold" | "price_tier" | "weight_tier",
        pricePaise: r.pricePaise,
        thresholdPaise: r.thresholdPaise ?? null,
        minSubtotalPaise: r.minSubtotalPaise ?? null,
        maxSubtotalPaise: r.maxSubtotalPaise ?? null,
        minWeightGrams: r.minWeightGrams ?? null,
        maxWeightGrams: r.maxWeightGrams ?? null,
        minDays: r.minDays ?? null,
        maxDays: r.maxDays ?? null,
      })),
    }));
    const first = base[0]!;

    await expect(saveAdminShippingZones(rt, ctx, { zones: base.map((z) => ({ ...z, isDefault: true })) })).rejects.toThrow(/only one zone can be the default/);
    await expect(saveAdminShippingZones(rt, ctx, { zones: [{ ...first, rates: [] }] })).rejects.toThrow(/needs at least one rate/);
    await expect(
      saveAdminShippingZones(rt, ctx, {
        zones: [
          // zone order from the database is not guaranteed, so pick the zones by name
          base.find((z) => z.name === "India")!,
          base.find((z) => z.name === "South")!,
          { name: "Clash", countries: ["IN"], states: ["Kerala"], isDefault: false, rates: [rate({})] },
        ],
      }),
    ).rejects.toThrow(/Kerala is in both/);
    await expect(
      saveAdminShippingZones(rt, ctx, {
        zones: [
          {
            ...first,
            rates: [
              rate({ name: "A", rateType: "weight_tier", minWeightGrams: 0, maxWeightGrams: 600 }),
              rate({ name: "B", rateType: "weight_tier", minWeightGrams: 500, maxWeightGrams: null }),
            ],
          },
        ],
      }),
    ).rejects.toThrow(/overlapping weights/);
    await expect(saveAdminShippingZones(rt, ctx, { zones: [first, { ...first, id: undefined, name: first.name.toUpperCase(), isDefault: false }] })).rejects.toThrow(/two zones named/);

    // nothing was written by the failed attempts
    const after = await getAdminShippingSettings(rt, ctx);
    expect(after.zones.map((z) => z.name).sort()).toEqual(before.zones.map((z) => z.name).sort());
  });

  it("removes zones left out of the save and keeps a default zone", async () => {
    const current = await getAdminShippingSettings(rt, ctx);
    const def = current.zones.find((z) => z.isDefault)!;
    await saveAdminShippingZones(rt, ctx, {
      zones: [
        {
          id: def.id,
          name: def.name,
          countries: def.countries,
          states: [],
          isDefault: true,
          rates: [rate({ name: "Only flat", pricePaise: 7000 })],
        },
      ],
    });
    const after = await getAdminShippingSettings(rt, ctx);
    expect(after.zones).toHaveLength(1);
    expect(after.zones[0]!.rates).toHaveLength(1);
    const rates = await getTenantShippingRates(rt._db.db, ctx.tenantId, 1000, { destination: { country: "AE" } });
    expect(rates[0]?.title).toBe("Only flat"); // nothing covers the UAE any more: falls back to the default zone
  });

  it("needs shipping.manage and never touches another store's zones", async () => {
    const readOnly = ctxFor(ctx.tenantId, "00000000-0000-0000-0000-000000000000", ["settings.read"]);
    await expect(saveAdminShippingZones(rt, readOnly, { zones: [{ name: "X", countries: ["IN"], states: [], isDefault: true, rates: [rate({})] }] })).rejects.toThrow(/permission|forbidden/i);

    const mine = await getAdminShippingSettings(rt, ctx);
    const theirs = await getAdminShippingSettings(rt, otherCtx);
    expect(theirs.zones.map((z) => z.id)).not.toContain(mine.zones[0]!.id);
    // saving in store B with store A's zone id creates a new zone instead of editing A's
    await saveAdminShippingZones(rt, otherCtx, { zones: [{ id: mine.zones[0]!.id, name: "B zone", countries: ["IN"], states: [], isDefault: true, rates: [rate({ pricePaise: 1 })] }] });
    const mineAfter = await getAdminShippingSettings(rt, ctx);
    expect(mineAfter.zones[0]!.name).toBe(mine.zones[0]!.name);
  });
});
