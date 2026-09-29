import { and, eq, sql } from "drizzle-orm";
import { type Db, shippingZones, shippingRates, withTenant } from "@bs/db";
import type { ShippingSettings, UpdateShippingInput } from "@bs/contracts";
import { assertPermission, type TenantContext } from "../context.ts";
import type { Runtime } from "../runtime.ts";

export type ShippingMethod = "standard" | "express" | string;

export interface ShippingRateCalculation {
  id?: string | undefined;
  method: ShippingMethod;
  title: string;
  amount: number; // in paise
  isFree: boolean;
  estimatedDays: string;
  description: string;
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
    minDays?: number | null | undefined;
    maxDays?: number | null | undefined;
  },
  subtotalPaise: number = 0,
): ShippingRateCalculation {
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
  };
}

/**
 * Resolves configured shipping rates for a tenant from the database (PLAN §5.4 / M7).
 * Both cart estimation and checkout placeOrder call this canonical function to ensure 100% agreement.
 */
export async function getTenantShippingRates(
  db: Db,
  tenantId: string,
  subtotalPaise: number = 0,
): Promise<ShippingRateCalculation[]> {
  return withTenant(db, tenantId, async (tx) => {
    let zones = await tx
      .select()
      .from(shippingZones)
      .where(eq(shippingZones.tenantId, tenantId))
      .orderBy(sql`${shippingZones.isDefault} DESC, ${shippingZones.createdAt} ASC`);

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

    const defaultZone = zones.find((z) => z.isDefault) ?? zones[0];
    if (!defaultZone) {
      return [];
    }

    const rates = await tx
      .select()
      .from(shippingRates)
      .where(and(eq(shippingRates.tenantId, tenantId), eq(shippingRates.zoneId, defaultZone.id)))
      .orderBy(shippingRates.createdAt);

    return rates.map((r) => calculateRateFromRule(r, subtotalPaise));
  });
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
    assertPermission(ctxOrTenantId, "settings.write");
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
        isDefault: zone.isDefault,
        rates: rates.map((r) => ({
          id: r.id,
          name: r.name,
          method: r.method,
          rateType: r.rateType,
          pricePaise: r.pricePaise,
          thresholdPaise: r.thresholdPaise,
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
  if (typeof ctxOrTenantId !== "string") {
    assertPermission(ctxOrTenantId, "settings.write");
  }
  return withTenant(db, tenantId, async (tx) => {
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

    return {
      success: true,
      message: "Shipping settings updated successfully",
    };
  });
}
