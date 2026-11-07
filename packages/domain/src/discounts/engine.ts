/**
 * The discount engine (ADR-045, docs/DISCOUNTS-PLAN.md). A pure function: no database, no clock, no I/O. The cart, the
 * checkout and draft orders all call it with the same facts, so the discount a shopper sees is the one they are charged.
 * All amounts are minor units (paise for INR).
 *
 * Phase 0 covers the order and shipping classes (percent, fixed, free shipping) and adds what was stored but never
 * enforced: automatic discounts, per-customer limits, the base-currency rule for fixed amounts, and stacking.
 */
import { formatMoney } from "@bs/contracts/money";

/** A discount row, reduced to what the rules need. */
export interface EngineDiscount {
  id: string;
  /** null = automatic: applied without the shopper typing anything. */
  code: string | null;
  title: string;
  type: string;
  value: number;
  minSubtotal: number | null;
  minQty: number | null;
  usageLimit: number | null;
  usedCount: number;
  perCustomerLimit: number | null;
  /** Opt in to being used together with a discount of the other class. */
  combinable: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  appliesTo: unknown;
  createdAt: Date;
}

export interface EngineCart {
  /** Goods subtotal. */
  subtotal: number;
  itemCount: number;
  currency: string;
  /** The store's own currency; fixed amounts only make sense here. */
  baseCurrency: string;
}

export interface EngineInput {
  /** Every discount of the store that could apply (the engine filters). */
  discounts: EngineDiscount[];
  /** Codes the shopper typed, in the order they were added. */
  codes: string[];
  cart: EngineCart;
  /** How many times this shopper already used each discount (discount id to count). Empty for an anonymous cart. */
  customerUses: Record<string, number>;
  now: Date;
}

export type DiscountClass = "order" | "shipping";

export interface EngineApplication {
  discountId: string;
  code: string | null;
  title: string;
  type: string;
  discountClass: DiscountClass;
  /** Goods discount (0 for free shipping). */
  amount: number;
  freeShipping: boolean;
  /** True when it applied without a code. */
  automatic: boolean;
}

export interface EngineRejection {
  code: string;
  reason: string;
}

export interface EngineResult {
  applications: EngineApplication[];
  /** Typed codes that did not apply, with the reason shown to the shopper. */
  rejections: EngineRejection[];
}

const normalise = (c: string) => c.trim().toUpperCase();

export function discountClassOf(type: string): DiscountClass {
  return type === "free_shipping" ? "shipping" : "order";
}

/** Why a discount cannot be used on this cart, or null when it can. For a typed code the reason is shown; an automatic discount is just skipped. */
export function ineligibleReason(d: EngineDiscount, i: Pick<EngineInput, "cart" | "customerUses" | "now">): string | null {
  const { cart, now } = i;
  if (d.status !== "active") return `Discount code is ${d.status}`;
  if (d.startsAt && d.startsAt > now) return "Discount is not yet active";
  if (d.endsAt && d.endsAt < now) return "Discount has expired";
  if (d.minSubtotal && cart.subtotal < d.minSubtotal) {
    return `Minimum order subtotal of ${formatMoney(d.minSubtotal, cart.currency, { alwaysShowFraction: true })} required`;
  }
  if (d.minQty && cart.itemCount < d.minQty) return `Minimum order quantity of ${d.minQty} items required`;
  if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return "Discount usage limit has been reached";
  if (d.perCustomerLimit !== null && (i.customerUses[d.id] ?? 0) >= d.perCustomerLimit) return "You have already used this code";

  // Rules the checkout cannot apply yet are refused with a clear reason rather than guessed at.
  const appliesTo = (d.appliesTo as { type?: string } | null)?.type ?? "all";
  if (appliesTo !== "all") return "This code can't be used at checkout yet";
  if (d.type !== "percent" && d.type !== "fixed" && d.type !== "free_shipping") return "This code can't be used at checkout yet";

  // A fixed amount is a number in the store's own currency: it is not converted for other markets.
  if (d.type === "fixed" && cart.currency !== cart.baseCurrency) {
    return `This code only works on orders in ${cart.baseCurrency}`;
  }
  return null;
}

/** The goods amount a discount takes off this cart (0 for free shipping). */
export function goodsAmount(d: EngineDiscount, cart: EngineCart): number {
  if (d.type === "percent") return Math.round((cart.subtotal * Math.min(100, Math.max(0, d.value))) / 100);
  if (d.type === "fixed") return Math.min(cart.subtotal, Math.max(0, d.value));
  return 0;
}

function toApplication(d: EngineDiscount, cart: EngineCart, automatic: boolean): EngineApplication {
  return {
    discountId: d.id,
    code: d.code,
    title: d.title,
    type: d.type,
    discountClass: discountClassOf(d.type),
    amount: goodsAmount(d, cart),
    freeShipping: d.type === "free_shipping",
    automatic,
  };
}

/**
 * Stacking (ADR-045): at most one goods discount and one shipping discount. The two together need both to opt in
 * (`combinable`). A code the shopper typed always beats an automatic discount; among the same kind the one worth more
 * wins (older first on a tie), so the result never depends on row order.
 */
export function evaluateDiscounts(input: EngineInput): EngineResult {
  const { cart } = input;
  const rejections: EngineRejection[] = [];
  const candidates: EngineApplication[] = [];
  const byId = new Map<string, EngineDiscount>();

  const typed = [...new Set(input.codes.map(normalise).filter(Boolean))];
  for (const code of typed) {
    const d = input.discounts.find((x) => x.code !== null && normalise(x.code) === code);
    if (!d) {
      rejections.push({ code, reason: "Discount code not found" });
      continue;
    }
    const reason = ineligibleReason(d, input);
    if (reason) {
      rejections.push({ code, reason });
      continue;
    }
    byId.set(d.id, d);
    candidates.push(toApplication(d, cart, false));
  }
  for (const d of input.discounts) {
    if (d.code !== null || byId.has(d.id)) continue;
    if (ineligibleReason(d, input) !== null) continue;
    byId.set(d.id, d);
    candidates.push(toApplication(d, cart, true));
  }

  const age = (a: EngineApplication) => byId.get(a.discountId)?.createdAt.getTime() ?? 0;
  const rank = (a: EngineApplication, b: EngineApplication) => {
    if (a.automatic !== b.automatic) return a.automatic ? 1 : -1; // typed codes first
    if (a.amount !== b.amount) return b.amount - a.amount;
    return age(a) - age(b) || a.discountId.localeCompare(b.discountId);
  };
  const best = (cls: DiscountClass) => candidates.filter((c) => c.discountClass === cls).sort(rank)[0];
  const combinable = (a: EngineApplication) => byId.get(a.discountId)?.combinable === true;

  const goods = best("order");
  const shipping = best("shipping");
  const applications: EngineApplication[] = [];
  if (goods && shipping) {
    if (combinable(goods) && combinable(shipping)) {
      applications.push(goods, shipping);
    } else if (goods.automatic !== shipping.automatic) {
      // Not allowed together: the typed code wins over an automatic discount.
      applications.push(goods.automatic ? shipping : goods);
    } else {
      applications.push(goods);
    }
  } else if (goods) {
    applications.push(goods);
  } else if (shipping) {
    applications.push(shipping);
  }

  // A typed code that lost a stacking decision is told so, instead of silently disappearing.
  for (const c of candidates) {
    if (c.automatic || !c.code || applications.includes(c)) continue;
    rejections.push({ code: normalise(c.code), reason: "This code can't be combined with the other discount on your order" });
  }
  return { applications, rejections };
}
