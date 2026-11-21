/**
 * Buy X get Y and bundle pricing for the discount engine (ADR-045, docs/DISCOUNTS-PLAN.md phase 3). Pure: it works on
 * cart lines expanded into single items ("units"), so "the cheapest one is free" and "any 3 for 999" are exact.
 */
import type { DiscountAppliesTo, DiscountRules } from "@bs/contracts/discount-rules";
import type { EngineLine } from "./engine.ts";
import { splitProportionally } from "./split.ts";

type Bxgy = NonNullable<DiscountRules["bxgy"]>;
type Bundle = NonNullable<DiscountRules["bundle"]>;

/** Which cart lines a scope covers (the engine passes its own, which also leaves out sale items when asked). */
export type LinePicker = (scope: DiscountAppliesTo, lines: EngineLine[]) => EngineLine[];

interface Unit {
  lineId: string;
  price: number;
}

export interface UnitDiscount {
  amount: number;
  lineAmounts: Record<string, number>;
}

/** One entry per single item, cheapest first (ties by line, so the result never depends on row order). */
function expand(lines: EngineLine[]): Unit[] {
  return lines
    .flatMap((l) => Array.from({ length: Math.min(Math.max(0, l.quantity), 1000) }, () => ({ lineId: l.id, price: l.unitPrice })))
    .sort((a, b) => a.price - b.price || a.lineId.localeCompare(b.lineId));
}

function toResult(parts: Array<{ lineId: string; amount: number }>): UnitDiscount {
  const lineAmounts: Record<string, number> = {};
  let amount = 0;
  for (const p of parts) {
    if (p.amount <= 0) continue;
    lineAmounts[p.lineId] = (lineAmounts[p.lineId] ?? 0) + p.amount;
    amount += p.amount;
  }
  return { amount, lineAmounts };
}

/**
 * "Buy X, get Y": the cheapest eligible items in the get scope are the ones that come cheaper, as many times as the buy
 * condition and the limit allow. An item cannot be both the one that was bought and the one that comes cheaper.
 */
export function bxgyDiscount(bxgy: Bxgy, lines: EngineLine[], pick: LinePicker): UnitDiscount {
  const buyLines = pick(bxgy.buy.appliesTo, lines);
  const getUnits = expand(pick(bxgy.get.appliesTo, lines));
  const g = bxgy.get.quantity;
  const buyIds = new Set(buyLines.map((l) => l.id));
  const buyUnitCount = expand(buyLines).length;
  const buyAmount = buyLines.reduce((sum, l) => sum + l.lineTotal, 0);
  const limit = bxgy.maxUsesPerOrder ?? (bxgy.buy.trigger === "amount" ? 1 : 1000);

  let sets = 0;
  for (let s = Math.min(Math.floor(getUnits.length / g), limit); s >= 1; s--) {
    const picked = getUnits.slice(0, s * g);
    const alsoBought = picked.filter((u) => buyIds.has(u.lineId));
    const enough =
      bxgy.buy.trigger === "quantity"
        ? buyUnitCount - alsoBought.length >= s * bxgy.buy.value
        : buyAmount - alsoBought.reduce((sum, u) => sum + u.price, 0) >= s * bxgy.buy.value;
    if (enough) {
      sets = s;
      break;
    }
  }
  if (sets === 0) return { amount: 0, lineAmounts: {} };

  const value = bxgy.get.value ?? 0;
  return toResult(
    getUnits.slice(0, sets * g).map((u) => ({
      lineId: u.lineId,
      amount:
        bxgy.get.effect === "free"
          ? u.price
          : bxgy.get.effect === "percent"
            ? Math.round((u.price * Math.min(100, Math.max(0, value))) / 100)
            : Math.max(0, u.price - value),
    })),
  );
}

/** "Any N for a price": every complete group of N items in the scope costs `price`, never more than it would have. Cheapest items group first. */
export function bundleDiscount(bundle: Bundle, lines: EngineLine[], pick: LinePicker): UnitDiscount {
  const units = expand(pick(bundle.appliesTo, lines));
  const parts: Array<{ lineId: string; amount: number }> = [];
  for (let start = 0; start + bundle.quantity <= units.length; start += bundle.quantity) {
    const group = units.slice(start, start + bundle.quantity);
    const full = group.reduce((sum, u) => sum + u.price, 0);
    const off = Math.max(0, full - bundle.price);
    const shares = splitProportionally(group.map((u) => u.price), off);
    group.forEach((u, i) => parts.push({ lineId: u.lineId, amount: shares[i] ?? 0 }));
  }
  return toResult(parts);
}

/**
 * How many times the buy part of an offer is met by the shopper's own items (not the free ones the store adds), and whether
 * the buy and get parts are the same items. Used to work out how many free items to add to the cart.
 */
export function autoFreeSets(bxgy: Bxgy, lines: EngineLine[], pick: LinePicker): { sets: number; sameScope: boolean } {
  const sameScope = JSON.stringify(bxgy.buy.appliesTo) === JSON.stringify(bxgy.get.appliesTo);
  const limit = bxgy.maxUsesPerOrder ?? (bxgy.buy.trigger === "amount" ? 1 : 1000);
  const buyLines = pick(bxgy.buy.appliesTo, lines);
  const have = bxgy.buy.trigger === "quantity" ? buyLines.reduce((sum, l) => sum + l.quantity, 0) : buyLines.reduce((sum, l) => sum + l.lineTotal, 0);
  return { sets: Math.min(Math.floor(have / bxgy.buy.value), limit), sameScope };
}
