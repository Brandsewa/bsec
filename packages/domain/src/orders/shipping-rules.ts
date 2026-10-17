import { normalizeState } from "./tax-engine.ts";

/**
 * Pure shipping rules (owner request 2026-10-17): which zone serves a destination and whether a rate applies to a
 * cart's value and weight. No database access, so these can be tested on their own. Store-level rates only: nothing
 * here talks to a courier.
 */

export type ShippingRateType = "flat" | "free_above_threshold" | "price_tier" | "weight_tier";
export const SHIPPING_RATE_TYPES: readonly ShippingRateType[] = ["flat", "free_above_threshold", "price_tier", "weight_tier"];

/**
 * A two-letter country code from what a shopper or admin entered: "IN", "in" and "India" give "IN"; a name this does
 * not know gives undefined (the zone is then chosen by state, or falls back to the default zone).
 */
export function toCountryCode(value: string | null | undefined): string | undefined {
  const v = (value ?? "").trim();
  if (!v) return undefined;
  if (/^[a-z]{2}$/i.test(v)) return v.toUpperCase();
  if (/^india$/i.test(v)) return "IN";
  return undefined;
}

export interface ZoneLike {
  id: string;
  countries: string[];
  /** Empty means the whole country. Otherwise only these states (names as shoppers enter them). */
  states?: string[] | null | undefined;
  isDefault: boolean;
}

export interface ShippingDestination {
  country?: string | null | undefined;
  state?: string | null | undefined;
}

/**
 * Picks the zone that serves a destination: a zone listing the shopper's state wins, then a zone covering the whole
 * country, then the store's default zone. With no destination (for example a cart estimate before an address is known)
 * the default zone is used, exactly as before zones had regions.
 */
export function pickShippingZone<T extends ZoneLike>(zones: T[], dest?: ShippingDestination): T | undefined {
  const fallback = zones.find((z) => z.isDefault) ?? zones[0];
  const country = (dest?.country ?? "").trim().toUpperCase();
  const state = normalizeState(dest?.state);
  if (!country && !state) return fallback;

  const coversCountry = (z: T) => !country || z.countries.map((c) => c.toUpperCase()).includes(country);
  if (state) {
    const byState = zones.find((z) => coversCountry(z) && (z.states ?? []).some((s) => normalizeState(s) === state));
    if (byState) return byState;
  }
  const wholeCountry = zones.filter((z) => coversCountry(z) && (z.states ?? []).length === 0);
  // Prefer a non-default zone that names the country (for example "International"), else the default if it covers it.
  const specific = wholeCountry.find((z) => !z.isDefault) ?? wholeCountry[0];
  return specific ?? fallback;
}

export interface TierBounds {
  rateType?: string | null | undefined;
  minSubtotalPaise?: number | null | undefined;
  maxSubtotalPaise?: number | null | undefined;
  minWeightGrams?: number | null | undefined;
  maxWeightGrams?: number | null | undefined;
}

/** True when the rate's own range (price or weight tier) contains the cart. Other rate types have no range. */
export function tierApplies(rate: TierBounds, subtotalPaise: number, weightGrams: number): boolean {
  if (rate.rateType === "price_tier") {
    return subtotalPaise >= (rate.minSubtotalPaise ?? 0) && (rate.maxSubtotalPaise == null || subtotalPaise < rate.maxSubtotalPaise);
  }
  if (rate.rateType === "weight_tier") {
    return weightGrams >= (rate.minWeightGrams ?? 0) && (rate.maxWeightGrams == null || weightGrams < rate.maxWeightGrams);
  }
  return true;
}

export interface RateInput extends TierBounds {
  name: string;
  method: string;
  pricePaise: number;
  thresholdPaise?: number | null | undefined;
}

/** Problems with one rate, in plain words, or null when it is fine. */
export function rateProblem(rate: RateInput): string | null {
  if (!rate.name.trim()) return "Every rate needs a name";
  if (!Number.isInteger(rate.pricePaise) || rate.pricePaise < 0) return `"${rate.name}": the price must be zero or more`;
  if (rate.rateType === "free_above_threshold" && (rate.thresholdPaise == null || rate.thresholdPaise <= 0)) {
    return `"${rate.name}": free-above rates need an order value`;
  }
  if (rate.rateType === "price_tier") {
    const min = rate.minSubtotalPaise ?? 0;
    if (min < 0) return `"${rate.name}": the minimum order value cannot be negative`;
    if (rate.maxSubtotalPaise != null && rate.maxSubtotalPaise <= min) return `"${rate.name}": the maximum order value must be above the minimum`;
  }
  if (rate.rateType === "weight_tier") {
    const min = rate.minWeightGrams ?? 0;
    if (min < 0) return `"${rate.name}": the minimum weight cannot be negative`;
    if (rate.maxWeightGrams != null && rate.maxWeightGrams <= min) return `"${rate.name}": the maximum weight must be above the minimum`;
  }
  return null;
}

/**
 * Overlap check for tiers of the same method inside one zone, so two tiers never both claim the same cart.
 * Returns a message for the first overlap found, or null.
 */
export function tierOverlap(rates: Array<RateInput & { name: string }>): string | null {
  for (const type of ["price_tier", "weight_tier"] as const) {
    const byMethod = new Map<string, Array<{ name: string; min: number; max: number }>>();
    for (const r of rates.filter((x) => x.rateType === type)) {
      const min = (type === "price_tier" ? r.minSubtotalPaise : r.minWeightGrams) ?? 0;
      const max = (type === "price_tier" ? r.maxSubtotalPaise : r.maxWeightGrams) ?? Number.POSITIVE_INFINITY;
      const list = byMethod.get(r.method) ?? [];
      for (const other of list) {
        if (min < other.max && other.min < max) return `"${r.name}" and "${other.name}" cover overlapping ${type === "price_tier" ? "order values" : "weights"}`;
      }
      list.push({ name: r.name, min, max });
      byMethod.set(r.method, list);
    }
  }
  return null;
}
