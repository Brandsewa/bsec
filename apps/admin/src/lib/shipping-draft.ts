import type { SaveShippingZone, SaveShippingZonesInput, ShippingSettings } from "@bs/contracts";
import { type WeightUnit, gramsToUnit, unitToGrams } from "@bs/contracts/units";

/** Editable form state for the shipping zones page. Money is kept as major units and weight in the zone's active unit while typing. */
export type RateType = "flat" | "free_above_threshold" | "price_tier" | "weight_tier";

export interface RateDraft {
  key: string;
  id?: string | undefined;
  name: string;
  method: "standard" | "express";
  rateType: RateType;
  price: string;
  threshold: string;
  minSubtotal: string;
  maxSubtotal: string;
  minWeight: string;
  maxWeight: string;
  minDays: string;
  maxDays: string;
}

export interface ZoneDraft {
  key: string;
  id?: string | undefined;
  name: string;
  marketId?: string | null | undefined;
  countries: string[];
  states: string[];
  isDefault: boolean;
  rates: RateDraft[];
}

let counter = 0;
export const newKey = () => `k${(counter += 1)}`;

const majorUnits = (minor: number | null | undefined) => (minor == null ? "" : String(minor / 100));
const text = (n: number | null | undefined) => (n == null ? "" : String(n));

export function emptyRate(method: "standard" | "express" = "standard", rateType: RateType = "flat"): RateDraft {
  return {
    key: newKey(),
    name: method === "express" ? "Express Shipping" : "Standard Shipping",
    method,
    rateType,
    price: "0",
    threshold: "",
    minSubtotal: "",
    maxSubtotal: "",
    minWeight: "",
    maxWeight: "",
    minDays: method === "express" ? "2" : "4",
    maxDays: method === "express" ? "3" : "7",
  };
}

export function emptyZone(name = "New zone", marketId?: string | null): ZoneDraft {
  return {
    key: newKey(),
    name,
    marketId: marketId ?? null,
    countries: ["IN"],
    states: [],
    isDefault: false,
    rates: [emptyRate("standard")],
  };
}

export function draftsFromSettings(
  settings: ShippingSettings,
  getZoneWeightUnit?: (marketId?: string | null) => WeightUnit,
): ZoneDraft[] {
  return settings.zones.map((z) => {
    const unit = getZoneWeightUnit ? getZoneWeightUnit(z.marketId) : "g";
    return {
      key: newKey(),
      id: z.id,
      name: z.name,
      marketId: z.marketId ?? null,
      countries: [...z.countries],
      states: [...(z.states ?? [])],
      isDefault: z.isDefault,
      rates: z.rates.map((r) => {
        const minW = r.minWeightGrams != null
          ? (unit === "g" ? text(r.minWeightGrams) : String(gramsToUnit(r.minWeightGrams, unit)))
          : "";
        const maxW = r.maxWeightGrams != null
          ? (unit === "g" ? text(r.maxWeightGrams) : String(gramsToUnit(r.maxWeightGrams, unit)))
          : "";
        return {
          key: newKey(),
          id: r.id,
          name: r.name,
          method: r.method === "express" ? "express" : "standard",
          rateType: (["flat", "free_above_threshold", "price_tier", "weight_tier"].includes(r.rateType) ? r.rateType : "flat") as RateType,
          price: majorUnits(r.pricePaise),
          threshold: majorUnits(r.thresholdPaise),
          minSubtotal: majorUnits(r.minSubtotalPaise),
          maxSubtotal: majorUnits(r.maxSubtotalPaise),
          minWeight: minW,
          maxWeight: maxW,
          minDays: text(r.minDays),
          maxDays: text(r.maxDays),
        };
      }),
    };
  });
}

/** A string that changes only when a value the owner can edit changes (ignores the internal keys). */
export function draftSignature(zones: ZoneDraft[]): string {
  return JSON.stringify(zones.map((z) => ({ ...z, key: undefined, rates: z.rates.map((r) => ({ ...r, key: undefined })) })));
}

const toMinorUnits = (v: string) => Math.round(Number(v) * 100);
const isMoney = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
const isNumber = (v: string) => v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0;
const isWhole = (v: string) => v.trim() !== "" && Number.isInteger(Number(v)) && Number(v) >= 0;

/** Turns the form into the API payload, or a plain-language reason it cannot be saved yet. */
export function draftsToPayload(
  zones: ZoneDraft[],
  getZoneWeightUnit?: (marketId?: string | null) => WeightUnit,
): { payload: SaveShippingZonesInput; error: null } | { payload: null; error: string } {
  const out: SaveShippingZone[] = [];
  for (const z of zones) {
    if (!z.name.trim()) return { payload: null, error: "Every zone needs a name." };
    if (z.countries.length === 0) return { payload: null, error: `"${z.name}" needs at least one country.` };
    if (z.rates.length === 0) return { payload: null, error: `"${z.name}" needs at least one rate.` };
    const rates: SaveShippingZone["rates"] = [];
    const unit = getZoneWeightUnit ? getZoneWeightUnit(z.marketId) : "g";

    for (const r of z.rates) {
      const label = `${z.name}: ${r.name || "a rate"}`;
      if (!r.name.trim()) return { payload: null, error: `${z.name}: every rate needs a name.` };
      if (!isMoney(r.price)) return { payload: null, error: `${label}: enter the price (0 or more).` };
      if (r.rateType === "free_above_threshold" && !(isMoney(r.threshold) && Number(r.threshold) > 0)) {
        return { payload: null, error: `${label}: enter the order value above which shipping is free.` };
      }
      if (r.rateType === "price_tier") {
        if (r.minSubtotal !== "" && !isMoney(r.minSubtotal)) return { payload: null, error: `${label}: the minimum order value is not a valid amount.` };
        if (r.maxSubtotal !== "" && !isMoney(r.maxSubtotal)) return { payload: null, error: `${label}: the maximum order value is not a valid amount.` };
        if (r.maxSubtotal !== "" && toMinorUnits(r.maxSubtotal) <= toMinorUnits(r.minSubtotal || "0")) return { payload: null, error: `${label}: the maximum order value must be above the minimum.` };
      }
      if (r.rateType === "weight_tier") {
        if (r.minWeight !== "" && !isNumber(r.minWeight)) return { payload: null, error: `${label}: the minimum weight must be a valid number.` };
        if (r.maxWeight !== "" && !isNumber(r.maxWeight)) return { payload: null, error: `${label}: the maximum weight must be a valid number.` };
        const minGrams = r.minWeight !== "" ? (unit === "g" ? Math.round(Number(r.minWeight)) : unitToGrams(Number(r.minWeight), unit)) : 0;
        const maxGrams = r.maxWeight !== "" ? (unit === "g" ? Math.round(Number(r.maxWeight)) : unitToGrams(Number(r.maxWeight), unit)) : null;
        if (maxGrams !== null && maxGrams <= minGrams) return { payload: null, error: `${label}: the maximum weight must be above the minimum.` };
      }
      if ((r.minDays !== "" && !isWhole(r.minDays)) || (r.maxDays !== "" && !isWhole(r.maxDays))) {
        return { payload: null, error: `${label}: delivery days must be whole numbers.` };
      }

      const minWeightGrams = r.rateType === "weight_tier"
        ? (r.minWeight !== "" ? (unit === "g" ? Math.round(Number(r.minWeight)) : unitToGrams(Number(r.minWeight), unit)) : 0)
        : null;
      const maxWeightGrams = r.rateType === "weight_tier" && r.maxWeight !== ""
        ? (unit === "g" ? Math.round(Number(r.maxWeight)) : unitToGrams(Number(r.maxWeight), unit))
        : null;

      rates.push({
        ...(r.id ? { id: r.id } : {}),
        name: r.name.trim(),
        method: r.method,
        rateType: r.rateType,
        pricePaise: toMinorUnits(r.price),
        thresholdPaise: r.rateType === "free_above_threshold" ? toMinorUnits(r.threshold) : r.rateType === "flat" && r.threshold !== "" ? toMinorUnits(r.threshold) : null,
        minSubtotalPaise: r.rateType === "price_tier" ? toMinorUnits(r.minSubtotal || "0") : null,
        maxSubtotalPaise: r.rateType === "price_tier" && r.maxSubtotal !== "" ? toMinorUnits(r.maxSubtotal) : null,
        minWeightGrams,
        maxWeightGrams,
        minDays: r.minDays === "" ? null : Number(r.minDays),
        maxDays: r.maxDays === "" ? null : Number(r.maxDays),
      });
    }
    out.push({
      ...(z.id ? { id: z.id } : {}),
      name: z.name.trim(),
      marketId: z.marketId ?? null,
      countries: z.countries,
      states: z.countries.length === 1 && z.countries[0] === "IN" ? z.states : [],
      isDefault: z.isDefault,
      rates,
    });
  }
  if (out.filter((z) => z.isDefault).length !== 1) return { payload: null, error: "Choose exactly one default zone." };
  return { payload: { zones: out }, error: null };
}

/** Countries offered for a zone. Shoppers are matched by two-letter code. */
export const COUNTRY_OPTIONS: Array<{ value: string; label: string }> = [
  ["IN", "India"], ["US", "United States"], ["GB", "United Kingdom"], ["AE", "United Arab Emirates"], ["SG", "Singapore"],
  ["CA", "Canada"], ["AU", "Australia"], ["DE", "Germany"], ["FR", "France"], ["NL", "Netherlands"], ["SA", "Saudi Arabia"],
  ["QA", "Qatar"], ["KW", "Kuwait"], ["OM", "Oman"], ["BH", "Bahrain"], ["NP", "Nepal"], ["BD", "Bangladesh"], ["LK", "Sri Lanka"],
  ["MY", "Malaysia"], ["JP", "Japan"], ["IT", "Italy"], ["ES", "Spain"], ["NZ", "New Zealand"], ["ZA", "South Africa"],
].map(([value, label]) => ({ value: value as string, label: label as string }));
