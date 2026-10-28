import { and, eq, inArray, isNotNull, min, notInArray, sql } from "drizzle-orm";
import { type Db, schema, shippingZones, shippingRates, withTenant } from "@bs/db";
import type {
  SaveShippingZonesInput,
  ShippingSettings,
  UpdateShippingInput,
  ShippingPreviewInput,
  ShippingPreviewResult,
} from "@bs/contracts";
import { pickShippingZone, rateProblem, tierApplies, tierOverlap, type ShippingDestination } from "./shipping-rules.ts";

export { toCountryCode } from "./shipping-rules.ts";
import { normalizeState } from "./tax-engine.ts";
import { assertPermission, type TenantContext } from "../context.ts";
import type { Runtime } from "../runtime.ts";
import { invalidateCache } from "../cache-invalidation.ts";

export type ShippingMethod = "standard" | "express" | string;

export interface ShippingRateCalculation {
  id?: string | undefined;
  method: ShippingMethod;
  title: string;
  amount: number; // in paise
  isFree: boolean;
  estimatedDays: string;
  description: string;
  /** False for a "free above threshold" rate whose threshold the cart has not reached: it is not offered. */
  applicable: boolean;
}

/**
 * Calculates effective rate from a tenant's shipping rate rule (PLAN §5.4 / M7).
 * Zero platform price constants: pure evaluation of database rules against cart subtotal.
 */
export function calculateRateFromRule(
  rate: {
    id?: string | undefined;
    pricePaise: number;
    thresholdPaise?: number | null | undefined;
    name: string;
    method: string;
    rateType?: string | null | undefined;
    minDays?: number | null | undefined;
    maxDays?: number | null | undefined;
    minSubtotalPaise?: number | null | undefined;
    maxSubtotalPaise?: number | null | undefined;
    minWeightGrams?: number | null | undefined;
    maxWeightGrams?: number | null | undefined;
  },
  subtotalPaise: number = 0,
  weightGrams: number = 0,
): ShippingRateCalculation {
  // A pure "free above threshold" rule (price 0, as a new store is seeded with) only applies once the cart reaches the
  // threshold. One that has its own price (what the admin's shipping settings write: "₹70, free above ₹1200") is always
  // offered and simply becomes free at the threshold. Price and weight tiers apply only inside their own range.
  const applicable =
    rate.rateType === "free_above_threshold" && rate.pricePaise === 0
      ? rate.thresholdPaise != null && subtotalPaise >= rate.thresholdPaise
      : tierApplies(rate, subtotalPaise, weightGrams);
  const isFree =
    rate.pricePaise === 0 ||
    (rate.thresholdPaise != null && subtotalPaise >= rate.thresholdPaise);

  const amount = isFree ? 0 : rate.pricePaise;
  const estimatedDays =
    rate.minDays && rate.maxDays
      ? `${rate.minDays}-${rate.maxDays} business days`
      : "Standard delivery";

  let description = `${rate.name} within ${estimatedDays}`;
  if (isFree && rate.thresholdPaise != null) {
    description = `Free delivery on orders over ₹${(rate.thresholdPaise / 100).toFixed(0)}`;
  } else if (isFree && rate.pricePaise === 0) {
    description = "Free standard delivery";
  }

  return {
    id: rate.id,
    method: rate.method as ShippingMethod,
    title: rate.name,
    amount,
    isFree,
    estimatedDays,
    description,
    applicable,
  };
}

export interface ShippingContextOptions {
  /** Total weight of the cart in grams (variants without a weight count as 0), for weight-based rates. */
  weightGrams?: number | undefined;
  /** Where the order ships. Without it the store's default zone is used. */
  destination?: ShippingDestination | undefined;
  /**
   * The market the order is in (ADR-040). Only that market's zones apply (the base market also keeps zones with no market).
   * Without it every zone is considered, as before markets existed.
   */
  market?: { id: string; isBase: boolean } | undefined;
}

type TenantTx = Parameters<Parameters<typeof withTenant>[2]>[0];

/** Total weight in grams of cart or order lines; variants without a weight count as 0. */
export async function cartWeightGrams(tx: TenantTx, lines: Array<{ variantId: string; quantity: number }>): Promise<number> {
  const ids = [...new Set(lines.map((l) => l.variantId))];
  if (ids.length === 0) return 0;
  const rows = await tx
    .select({ id: schema.variants.id, weight: schema.variants.weightGrams })
    .from(schema.variants)
    .where(inArray(schema.variants.id, ids));
  const byId = new Map(rows.map((r) => [r.id, r.weight ?? 0]));
  return lines.reduce((sum, l) => sum + (byId.get(l.variantId) ?? 0) * l.quantity, 0);
}

async function loadZones(tx: TenantTx, tenantId: string, market?: ShippingContextOptions["market"]) {
  let zones = await tx
    .select()
    .from(shippingZones)
    .where(
      market
        ? and(
            eq(shippingZones.tenantId, tenantId),
            market.isBase ? sql`(${shippingZones.marketId} = ${market.id} OR ${shippingZones.marketId} IS NULL)` : eq(shippingZones.marketId, market.id),
          )
        : eq(shippingZones.tenantId, tenantId),
    )
    .orderBy(sql`${shippingZones.isDefault} DESC, ${shippingZones.createdAt} ASC`);

  // A market that is not the base market never gets a zone invented for it: no zone means we do not ship there.
  if (market && !market.isBase) return zones;

  // Self-healing provisioning if tenant has no shipping zones yet
  if (zones.length === 0) {
    const [newZone] = await tx
      .insert(shippingZones)
      .values({
        tenantId,
        name: "Domestic (India)",
        countries: ["IN"],
        isDefault: true,
      })
      .returning();

    if (newZone) {
      await tx.insert(shippingRates).values([
        {
          tenantId,
          zoneId: newZone.id,
          name: "Standard Shipping",
          method: "standard",
          rateType: "flat",
          pricePaise: 0,
          thresholdPaise: null,
          minDays: 4,
          maxDays: 7,
        },
        {
          tenantId,
          zoneId: newZone.id,
          name: "Express Shipping",
          method: "express",
          rateType: "flat",
          pricePaise: 15000,
          thresholdPaise: null,
          minDays: 2,
          maxDays: 3,
        },
      ]);
      zones = [newZone];
    }
  }
  return zones;
}

/** Picks the zone for the destination and prices its rates for the cart. */
async function resolveZoneRates(
  tx: TenantTx,
  tenantId: string,
  subtotalPaise: number,
  opts: ShippingContextOptions,
): Promise<{ zone: { id: string; name: string } | null; rates: ShippingRateCalculation[] }> {
  const zones = await loadZones(tx, tenantId, opts.market);
  const zone = pickShippingZone(zones, opts.destination);
  if (!zone) return { zone: null, rates: [] };

  const rows = await tx
    .select()
    .from(shippingRates)
    .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.zoneId, zone.id)))
    .orderBy(shippingRates.createdAt);

  // Offer only the rules that apply to this cart, and one option per method (the cheapest one that applies), so a
  // store with "Standard: flat 99" and "Free above 999" shows 99 below the threshold and Free from 999 up.
  const offered: ShippingRateCalculation[] = [];
  for (const r of rows.map((row) => calculateRateFromRule(row, subtotalPaise, opts.weightGrams ?? 0))) {
    if (!r.applicable) continue;
    const at = offered.findIndex((o) => o.method === r.method);
    const existing = at === -1 ? undefined : offered[at];
    if (!existing) offered.push(r);
    else if (r.amount < existing.amount) offered[at] = r;
  }
  return { zone: { id: zone.id, name: zone.name }, rates: offered };
}

/**
 * Resolves configured shipping rates for a tenant from the database (PLAN §5.4 / M7).
 * Both cart estimation and checkout placeOrder call this canonical function to ensure 100% agreement. Pass the cart's
 * weight and the shipping destination (country and state) to get the matching zone and tiers; without them the
 * default zone is used.
 */
export async function getTenantShippingRates(
  db: Db,
  tenantId: string,
  subtotalPaise: number = 0,
  opts: ShippingContextOptions = {},
): Promise<ShippingRateCalculation[]> {
  return withTenant(db, tenantId, async (tx) => (await resolveZoneRates(tx, tenantId, subtotalPaise, opts)).rates);
}

/**
 * Admin: fetches configured shipping zones and rates for a tenant.
 */
export async function getAdminShippingSettings(
  rtOrDb: Runtime | Db,
  ctxOrTenantId: TenantContext | string,
): Promise<ShippingSettings> {
  const db = "service" in rtOrDb ? rtOrDb._db.db : rtOrDb;
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "settings.read");
  }
  return withTenant(db, tenantId, async (tx) => {
    let zones = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.tenantId, tenantId))
      .orderBy(sql`${shippingZones.isDefault} DESC, ${shippingZones.createdAt} ASC`);

    if (zones.length === 0) {
      // Seed initial default zone and rates for tenant
      await getTenantShippingRates(tx, tenantId, 0);
      zones = await tx
        .select()
        .from(shippingZones)
        .where(eq(shippingZones.tenantId, tenantId))
        .orderBy(sql`${shippingZones.isDefault} DESC, ${shippingZones.createdAt} ASC`);
    }

    const resultZones = [];
    for (const zone of zones) {
      const rates = await tx
        .select()
        .from(shippingRates)
        .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.zoneId, zone.id)))
        .orderBy(shippingRates.createdAt);

      resultZones.push({
        id: zone.id,
        name: zone.name,
        countries: zone.countries,
        states: zone.states,
        isDefault: zone.isDefault,
        rates: rates.map((r) => ({
          id: r.id,
          name: r.name,
          method: r.method,
          rateType: r.rateType,
          pricePaise: r.pricePaise,
          thresholdPaise: r.thresholdPaise,
          minSubtotalPaise: r.minSubtotalPaise,
          maxSubtotalPaise: r.maxSubtotalPaise,
          minWeightGrams: r.minWeightGrams,
          maxWeightGrams: r.maxWeightGrams,
          minDays: r.minDays,
          maxDays: r.maxDays,
        })),
      });
    }

    return { zones: resultZones };
  });
}

/**
 * Admin: updates shipping zone name, standard rate, express rate, and optional free shipping threshold.
 */
export async function updateAdminShippingSettings(
  rtOrDb: Runtime | Db,
  ctxOrTenantId: TenantContext | string,
  input: UpdateShippingInput,
): Promise<{ success: boolean; message: string }> {
  const db = "service" in rtOrDb ? rtOrDb._db.db : rtOrDb;
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  const ctx = typeof ctxOrTenantId === "string" ? null : ctxOrTenantId;
  if (ctx) {
    assertPermission(ctx, "shipping.manage");
  }
  const result = await withTenant(db, tenantId, async (tx) => {
    let [defaultZone] = await tx
      .select()
      .from(shippingZones)
      .where(and(eq(shippingZones.tenantId, tenantId), eq(shippingZones.isDefault, true)))
      .limit(1);

    if (!defaultZone) {
      const [created] = await tx
        .insert(shippingZones)
        .values({
          tenantId,
          name: input.zoneName,
          countries: ["IN"],
          isDefault: true,
        })
        .returning();
      defaultZone = created;
    } else {
      await tx
        .update(shippingZones)
        .set({
          name: input.zoneName,
          updatedAt: sql`now()`,
        })
        .where(and(eq(shippingZones.tenantId, tenantId), eq(shippingZones.id, defaultZone.id)));
    }

    if (!defaultZone) {
      throw new Error("Failed to find or create default shipping zone");
    }

    // Upsert Standard Rate
    const [existingStandard] = await tx
      .select()
      .from(shippingRates)
      .where(
        and(
          eq(shippingRates.tenantId, tenantId),
          eq(shippingRates.zoneId, defaultZone.id),
          eq(shippingRates.method, "standard"),
        ),
      )
      .limit(1);

    const standardRateType = input.freeShippingThresholdPaise != null ? "free_above_threshold" : "flat";

    if (existingStandard) {
      await tx
        .update(shippingRates)
        .set({
          pricePaise: input.standardRatePaise,
          thresholdPaise: input.freeShippingThresholdPaise ?? null,
          rateType: standardRateType,
          updatedAt: sql`now()`,
        })
        .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.id, existingStandard.id)));
    } else {
      await tx.insert(shippingRates).values({
        tenantId,
        zoneId: defaultZone.id,
        name: "Standard Shipping",
        method: "standard",
        rateType: standardRateType,
        pricePaise: input.standardRatePaise,
        thresholdPaise: input.freeShippingThresholdPaise ?? null,
        minDays: 4,
        maxDays: 7,
      });
    }

    // Upsert Express Rate
    const [existingExpress] = await tx
      .select()
      .from(shippingRates)
      .where(
        and(
          eq(shippingRates.tenantId, tenantId),
          eq(shippingRates.zoneId, defaultZone.id),
          eq(shippingRates.method, "express"),
        ),
      )
      .limit(1);

    if (existingExpress) {
      await tx
        .update(shippingRates)
        .set({
          pricePaise: input.expressRatePaise,
          updatedAt: sql`now()`,
        })
        .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.id, existingExpress.id)));
    } else {
      await tx.insert(shippingRates).values({
        tenantId,
        zoneId: defaultZone.id,
        name: "Express Shipping",
        method: "express",
        rateType: "flat",
        pricePaise: input.expressRatePaise,
        thresholdPaise: null,
        minDays: 2,
        maxDays: 3,
      });
    }

    // Audit log
    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorType: ctx && ctx.actor.type === "staff" ? "staff" : "system",
      actorId: ctx && ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "shipping.update",
      targetType: "shipping_settings",
      targetId: defaultZone.id,
      diff: {
        after: {
          zoneName: input.zoneName,
          standardRatePaise: input.standardRatePaise,
          expressRatePaise: input.expressRatePaise,
          freeShippingThresholdPaise: input.freeShippingThresholdPaise ?? null,
        },
      },
    });

    return {
      success: true,
      message: "Shipping settings updated successfully",
    };
  });

  if (ctx && "service" in rtOrDb) {
    await invalidateCache(rtOrDb, ctx, { type: "store_or_seo_updated" });
  }

  return result;
}

/**
 * Admin preview: evaluates shipping rates against a hypothetical subtotal and destination,
 * returning the exact rate list and human-readable explanation trace.
 */
export async function previewShippingRate(
  rtOrDb: Runtime | Db,
  ctxOrTenantId: TenantContext | string,
  input: ShippingPreviewInput,
): Promise<ShippingPreviewResult> {
  const db = "service" in rtOrDb ? rtOrDb._db.db : rtOrDb;
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "settings.read");
  }

  return withTenant(db, tenantId, async (tx) => {
    const resolved = await resolveZoneRates(tx, tenantId, input.subtotalPaise, {
      weightGrams: input.weightGrams ?? 0,
      destination: { country: input.destinationCountry, state: input.destinationState },
    });
    const zoneName = resolved.zone?.name ?? "Domestic (India)";

    const previewRates = resolved.rates.map((r) => {
      let trace = `Zone: ${zoneName}; Rate: ${r.title} ₹${(r.amount / 100).toFixed(0)}`;
      if (r.isFree) {
        trace += ` (Free delivery applied)`;
      } else if (!r.applicable) {
        trace += ` (Threshold not reached; rate not offered)`;
      } else {
        trace += ` (Standard flat fee)`;
      }

      return {
        method: r.method,
        title: r.title,
        amountPaise: r.amount,
        isFree: r.isFree,
        estimatedDays: r.estimatedDays,
        applicable: r.applicable,
        trace,
      };
    });

    return {
      zoneName,
      rates: previewRates,
    };
  });
}

/**
 * Admin: replaces the store's shipping zones and rates (the zones page). Validated in full before anything is written:
 * one default zone, unique zone names, a state in only one zone, every zone has a rate, tiers of one method never
 * overlap. Zones and rates that are not in the input are removed (orders keep the shipping amount they were charged).
 */
export async function saveAdminShippingZones(
  rtOrDb: Runtime | Db,
  ctxOrTenantId: TenantContext | string,
  input: SaveShippingZonesInput,
): Promise<{ success: boolean; message: string }> {
  const db = "service" in rtOrDb ? rtOrDb._db.db : rtOrDb;
  const tenantId = typeof ctxOrTenantId === "string" ? ctxOrTenantId : ctxOrTenantId.tenantId;
  const ctx = typeof ctxOrTenantId === "string" ? null : ctxOrTenantId;
  if (ctx) assertPermission(ctx, "shipping.manage");

  // ---- validate everything first
  const defaults = input.zones.filter((z) => z.isDefault);
  if (defaults.length > 1) throw new Error("Bad Request: only one zone can be the default");
  const zones = input.zones.map((z, i) => ({ ...z, isDefault: defaults.length === 0 ? i === 0 : z.isDefault }));
  const names = new Set<string>();
  const stateOwner = new Map<string, string>();
  for (const z of zones) {
    if (names.has(z.name.toLowerCase())) throw new Error(`Bad Request: there are two zones named "${z.name}"`);
    names.add(z.name.toLowerCase());
    if (z.states.length > 0 && z.countries.length !== 1) throw new Error(`Bad Request: "${z.name}" lists states, so it can cover only one country`);
    for (const st of z.states) {
      const key = `${z.countries[0]}:${normalizeState(st)}`;
      const owner = stateOwner.get(key);
      if (owner && owner !== z.name) throw new Error(`Bad Request: ${st} is in both "${owner}" and "${z.name}"`);
      stateOwner.set(key, z.name);
    }
    if (z.rates.length === 0) throw new Error(`Bad Request: "${z.name}" needs at least one rate`);
    for (const r of z.rates) {
      const problem = rateProblem(r);
      if (problem) throw new Error(`Bad Request: ${problem}`);
    }
    const overlap = tierOverlap(z.rates);
    if (overlap) throw new Error(`Bad Request: in "${z.name}", ${overlap}`);
  }

  const result = await withTenant(db, tenantId, async (tx) => {
    const existingZones = await tx.select({ id: shippingZones.id }).from(shippingZones).where(eq(shippingZones.tenantId, tenantId));
    const existingIds = new Set(existingZones.map((z) => z.id));

    const keepZoneIds: string[] = [];
    for (const z of zones) {
      const values = { name: z.name, countries: z.countries.map((c) => c.toUpperCase()), states: z.states, isDefault: z.isDefault, updatedAt: sql`now()` };
      let zoneId = z.id;
      if (zoneId && existingIds.has(zoneId)) {
        await tx.update(shippingZones).set(values).where(and(eq(shippingZones.tenantId, tenantId), eq(shippingZones.id, zoneId)));
      } else {
        const [created] = await tx.insert(shippingZones).values({ tenantId, ...values }).returning({ id: shippingZones.id });
        if (!created) throw new Error("Failed to create shipping zone");
        zoneId = created.id;
      }
      keepZoneIds.push(zoneId);

      const existingRates = await tx
        .select({ id: shippingRates.id })
        .from(shippingRates)
        .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.zoneId, zoneId)));
      const existingRateIds = new Set(existingRates.map((r) => r.id));
      const keepRateIds: string[] = [];
      for (const r of z.rates) {
        const rv = {
          name: r.name,
          method: r.method,
          rateType: r.rateType,
          pricePaise: r.pricePaise,
          thresholdPaise: r.rateType === "free_above_threshold" || r.rateType === "flat" ? (r.thresholdPaise ?? null) : null,
          minSubtotalPaise: r.rateType === "price_tier" ? (r.minSubtotalPaise ?? 0) : null,
          maxSubtotalPaise: r.rateType === "price_tier" ? (r.maxSubtotalPaise ?? null) : null,
          minWeightGrams: r.rateType === "weight_tier" ? (r.minWeightGrams ?? 0) : null,
          maxWeightGrams: r.rateType === "weight_tier" ? (r.maxWeightGrams ?? null) : null,
          minDays: r.minDays ?? null,
          maxDays: r.maxDays ?? null,
          updatedAt: sql`now()`,
        };
        if (r.id && existingRateIds.has(r.id)) {
          await tx.update(shippingRates).set(rv).where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.id, r.id)));
          keepRateIds.push(r.id);
        } else {
          const [created] = await tx.insert(shippingRates).values({ tenantId, zoneId, ...rv }).returning({ id: shippingRates.id });
          if (created) keepRateIds.push(created.id);
        }
      }
      await tx
        .delete(shippingRates)
        .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.zoneId, zoneId), notInArray(shippingRates.id, keepRateIds)));
    }
    await tx.delete(shippingZones).where(and(eq(shippingZones.tenantId, tenantId), notInArray(shippingZones.id, keepZoneIds)));

    await tx.insert(schema.auditLogs).values({
      tenantId,
      actorType: ctx && ctx.actor.type === "staff" ? "staff" : "system",
      actorId: ctx && ctx.actor.type === "staff" ? ctx.actor.userId : null,
      action: "shipping.zones_saved",
      targetType: "shipping_settings",
      targetId: keepZoneIds[0] ?? tenantId,
      diff: {
        after: zones.map((z) => ({
          name: z.name,
          countries: z.countries,
          states: z.states,
          isDefault: z.isDefault,
          rates: z.rates.map((r) => ({ name: r.name, method: r.method, rateType: r.rateType, pricePaise: r.pricePaise })),
        })),
      },
    });
    return { success: true, message: "Shipping zones saved" };
  });

  if (ctx && "service" in rtOrDb) {
    await invalidateCache(rtOrDb, ctx, { type: "store_or_seo_updated" });
  }
  return result;
}

/**
 * The cart value (paise) at which the store's own shipping rules turn free, or null when it has no
 * such rule. Read-only: the storefront cart uses it for a progress bar; checkout still prices
 * shipping from the rates themselves (getTenantShippingRates).
 */
export async function getFreeShippingThresholdPaise(db: Db, tenantId: string): Promise<number | null> {
  return withTenant(db, tenantId, async (tx) => {
    const [row] = await tx
      .select({ threshold: min(shippingRates.thresholdPaise) })
      .from(shippingRates)
      .where(and(eq(shippingRates.tenantId, tenantId), isNotNull(shippingRates.thresholdPaise)));
    const t = row?.threshold;
    return t != null && Number(t) > 0 ? Number(t) : null;
  });
}
