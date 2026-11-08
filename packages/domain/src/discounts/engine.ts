/**
 * The discount engine (ADR-045, docs/DISCOUNTS-PLAN.md). A pure function: no database, no clock, no I/O. The cart, the
 * checkout and draft orders all call it with the same facts, so the discount a shopper sees is the one they are charged.
 * All amounts are minor units (paise for INR).
 *
 * Classes: `product` (a percent or fixed amount on matching cart lines), `order` (the whole order), `shipping`
 * (free shipping). Buy X get Y arrives with phase 3 and is refused until then.
 */
import { formatMoney } from "@bs/contracts/money";
import { parseDiscountAppliesTo, parseDiscountEligibility, parseDiscountRules, type DiscountAppliesTo, type DiscountRules } from "@bs/contracts/discount-rules";
import { bundleDiscount, bxgyDiscount } from "./bxgy.ts";
import { splitProportionally } from "./split.ts";

export { splitProportionally };

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
  /** Opt in to being used together with a discount of a different class. */
  combinable: boolean;
  startsAt: Date | null;
  endsAt: Date | null;
  status: string;
  /** Raw stored scope; the engine reads it with `parseDiscountAppliesTo`. */
  appliesTo: unknown;
  /** Raw stored extras; the engine reads it with `parseDiscountRules`. */
  rules: unknown;
  /** Raw stored audience; the engine reads it with `parseDiscountEligibility`. Missing means everyone. */
  customerEligibility?: unknown;
  /** The discount is redeemed through a list of single-use codes, so it never applies by itself. */
  usesCodeList?: boolean;
  createdAt: Date;
}

/** What the engine knows about the shopper. */
export interface EngineCustomer {
  /** null for a guest who matches no customer. */
  id: string | null;
  /** Has not completed an order yet. */
  isNew: boolean;
  tags: string[];
  /**
   * True at checkout, when the shopper's details are known and a guest who matches no customer really is a stranger.
   * False while browsing, when a guest might still be someone the audience includes: the code is not refused yet.
   */
  strict: boolean;
}

export const ANONYMOUS: EngineCustomer = { id: null, isNew: true, tags: [], strict: false };

/** One code from a generated list: which discount it belongs to and whether it has been used. */
export interface EngineBulkCode {
  discountId: string;
  codeId: string;
  used: boolean;
}

/** At most this many codes on one cart (the same limit Shopify has). */
export const MAX_CODES_PER_CART = 5;

export interface EngineLine {
  id: string;
  productId: string;
  /** Every collection the product belongs to (only the ones some discount asks about need to be filled in). */
  collectionIds: string[];
  quantity: number;
  unitPrice: number;
  lineTotal: number;
  /** Shows a compare-at price above its selling price. */
  onSale: boolean;
}

export interface EngineCart {
  lines: EngineLine[];
  /** Goods subtotal. */
  subtotal: number;
  itemCount: number;
  currency: string;
  /** The store's own currency; fixed amounts only make sense here. */
  baseCurrency: string;
  /** The market the cart is priced in (the base market's id when none was chosen); null before markets exist. */
  marketId: string | null;
}

export interface EngineInput {
  /** Every discount of the store that could apply (the engine filters). */
  discounts: EngineDiscount[];
  /** Codes the shopper typed, in the order they were added. */
  codes: string[];
  cart: EngineCart;
  /** How many times this shopper already used each discount (discount id to count). Empty for an anonymous cart. */
  customerUses: Record<string, number>;
  customer?: EngineCustomer;
  /** Typed codes that belong to a generated list (upper-case code to its entry). */
  bulk?: Record<string, EngineBulkCode>;
  now: Date;
}

export type DiscountClass = "product" | "order" | "shipping";

export interface EngineApplication {
  discountId: string;
  code: string | null;
  title: string;
  type: string;
  discountClass: DiscountClass;
  /** Goods discount in total (0 for free shipping). */
  amount: number;
  /** For a product discount: how much it takes off each cart line (line id to amount). */
  lineAmounts?: Record<string, number> | undefined;
  freeShipping: boolean;
  /** For free shipping: waive at most this much of the shipping charge. Missing means all of it. */
  maxShipping?: number | null | undefined;
  /** True when it applied without a code. */
  automatic: boolean;
  /** The generated code that was typed, so it can be marked used. */
  bulkCodeId?: string | undefined;
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

export function discountClassOf(d: Pick<EngineDiscount, "type" | "appliesTo">): DiscountClass {
  if (d.type === "free_shipping") return "shipping";
  if (d.type === "buy_x_get_y" || d.type === "bundle") return "product";
  const scope = parseDiscountAppliesTo(d.appliesTo);
  return scope && scope.type !== "all" ? "product" : "order";
}

/** The cart lines a scoped discount may touch (its products or collections, minus sale items when asked). */
export function eligibleLines(scope: DiscountAppliesTo, rules: DiscountRules, lines: EngineLine[]): EngineLine[] {
  return lines.filter((l) => {
    if (rules.excludeOnSale && l.onSale) return false;
    if (scope.type === "products") return scope.productIds.includes(l.productId);
    if (scope.type === "collections") return l.collectionIds.some((c) => scope.collectionIds.includes(c));
    return true;
  });
}

/**
 * The value a discount has on this cart: its own, or for a tiered one the highest tier the cart reaches (null when it
 * reaches none, so the discount does not apply yet).
 */
export function activeValue(d: Pick<EngineDiscount, "value">, rules: DiscountRules, lines: EngineLine[], eligible: EngineLine[]): number | null {
  if (!rules.tiers) return d.value;
  const pool = rules.countEligibleOnly ? eligible : lines;
  const basis = pool.reduce((sum, l) => sum + (rules.tierBy === "quantity" ? l.quantity : l.lineTotal), 0);
  let reached: number | null = null;
  for (const tier of [...rules.tiers].sort((a, b) => a.threshold - b.threshold)) {
    if (basis >= tier.threshold) reached = tier.value;
  }
  return reached;
}

/** Why a discount cannot be used on this cart, or null when it can. For a typed code the reason is shown; an automatic discount is just skipped. */
export function ineligibleReason(d: EngineDiscount, i: Pick<EngineInput, "cart" | "customerUses" | "now" | "customer">, viaCode = d.code !== null): string | null {
  const { cart, now } = i;
  const customer = i.customer ?? ANONYMOUS;
  if (d.status !== "active") return `Discount code is ${d.status}`;
  if (d.startsAt && d.startsAt > now) return "Discount is not yet active";
  if (d.endsAt && d.endsAt < now) return "Discount has expired";
  if (d.minSubtotal && cart.subtotal < d.minSubtotal) {
    return `Minimum order subtotal of ${formatMoney(d.minSubtotal, cart.currency, { alwaysShowFraction: true })} required`;
  }
  if (d.minQty && cart.itemCount < d.minQty) return `Minimum order quantity of ${d.minQty} items required`;
  if (d.usageLimit !== null && d.usedCount >= d.usageLimit) return "Discount usage limit has been reached";
  if (d.perCustomerLimit !== null && (i.customerUses[d.id] ?? 0) >= d.perCustomerLimit) return "You have already used this code";

  const audience = parseDiscountEligibility(d.customerEligibility);
  if (!audience) return "This code can't be used at checkout yet";
  if (audience.type !== "all") {
    if (!viaCode) return "This offer needs a code";
    if (audience.type === "new_customers" && !customer.isNew) return "This code is only for new customers";
    if (audience.type === "tags" && (customer.id === null ? customer.strict : !customer.tags.some((t) => audience.tags.includes(t)))) return "This code isn't available for your account";
    if (audience.type === "customers" && (customer.id === null ? customer.strict : !audience.customerIds.includes(customer.id))) return "This code isn't available for your account";
  }

  // Rules the checkout cannot apply yet are refused with a clear reason rather than guessed at.
  if (!["percent", "fixed", "free_shipping", "buy_x_get_y", "bundle"].includes(d.type)) return "This code can't be used at checkout yet";
  const rules0 = parseDiscountRules(d.rules);
  if ((d.type === "buy_x_get_y" && !rules0.bxgy) || (d.type === "bundle" && !rules0.bundle)) return "This code can't be used at checkout yet";
  const scope = parseDiscountAppliesTo(d.appliesTo);
  if (!scope) return "This code can't be used at checkout yet";
  if (d.type === "free_shipping" && scope.type !== "all") return "This code can't be used at checkout yet";

  // A fixed amount is a number in the store's own currency: it is not converted for other markets.
  const fixedMoney = d.type === "fixed" || d.type === "bundle" || (d.type === "buy_x_get_y" && rules0.bxgy?.get.effect === "fixed_price");
  if (fixedMoney && cart.currency !== cart.baseCurrency) {
    return `This code only works on orders in ${cart.baseCurrency}`;
  }
  const rules = parseDiscountRules(d.rules);
  const eligible = eligibleLines(scope, rules, cart.lines);
  if (cart.lines.length > 0 && eligible.length === 0) return "This code doesn't apply to anything in your cart";

  if (d.type === "free_shipping" && rules.markets && rules.markets.length > 0 && (cart.marketId === null || !rules.markets.includes(cart.marketId))) {
    return "This code isn't available in your region";
  }
  if ((d.type === "buy_x_get_y" || d.type === "bundle") && cart.lines.length > 0 && computeAmount(d, cart.lines, new Map()).amount === 0) {
    return "Add the items this offer needs to your cart";
  }
  if (rules.tiers && activeValue(d, rules, cart.lines, eligible) === null) {
    const lowest = [...rules.tiers].sort((a, b) => a.threshold - b.threshold)[0];
    if (lowest) {
      return rules.tierBy === "quantity"
        ? `Minimum order quantity of ${lowest.threshold} items required`
        : `Minimum order subtotal of ${formatMoney(lowest.threshold, cart.currency, { alwaysShowFraction: true })} required`;
    }
  }
  return null;
}

/**
 * What a discount takes off, given what each line still costs (`remaining`, after any product discount on it).
 * Returns the total and, for a product discount, the share on each line.
 */
export function computeAmount(d: EngineDiscount, lines: EngineLine[], remaining: Map<string, number>): { amount: number; lineAmounts?: Record<string, number> } {
  if (d.type === "free_shipping") return { amount: 0 };
  const scope = parseDiscountAppliesTo(d.appliesTo) ?? { type: "all" as const };
  const rules = parseDiscountRules(d.rules);
  if (d.type === "buy_x_get_y" || d.type === "bundle") {
    const pick = (sc: DiscountAppliesTo, ls: EngineLine[]) => eligibleLines(sc, rules, ls);
    const r = d.type === "buy_x_get_y" ? (rules.bxgy ? bxgyDiscount(rules.bxgy, lines, pick) : null) : rules.bundle ? bundleDiscount(rules.bundle, lines, pick) : null;
    return r ? { amount: r.amount, lineAmounts: r.lineAmounts } : { amount: 0, lineAmounts: {} };
  }
  const eligible = eligibleLines(scope, rules, lines);
  const room = (l: EngineLine) => Math.max(0, remaining.get(l.id) ?? l.lineTotal);
  const base = eligible.reduce((sum, l) => sum + room(l), 0);

  const value = activeValue(d, rules, lines, eligible) ?? 0;
  let total: number;
  let perLine: number[] | null = null;
  if (d.type === "percent") {
    total = Math.round((base * Math.min(100, Math.max(0, value))) / 100);
    if (rules.maxDiscount !== undefined) total = Math.min(total, rules.maxDiscount);
  } else if (scope.type !== "all" && !rules.oncePerOrder) {
    // A fixed amount on products comes off every item, never more than the line costs.
    perLine = eligible.map((l) => Math.min(room(l), Math.max(0, value) * l.quantity));
    total = perLine.reduce((a, b) => a + b, 0);
  } else {
    total = Math.min(base, Math.max(0, value));
  }
  total = Math.min(total, base);

  if (scope.type === "all") return { amount: total };
  const shares = perLine ?? splitProportionally(eligible.map(room), total);
  const lineAmounts: Record<string, number> = {};
  eligible.forEach((l, i) => {
    if ((shares[i] ?? 0) > 0) lineAmounts[l.id] = shares[i] as number;
  });
  return { amount: total, lineAmounts };
}

function toApplication(d: EngineDiscount, cart: EngineCart, automatic: boolean, typedCode?: string, bulkCodeId?: string): EngineApplication {
  const { amount, lineAmounts } = computeAmount(d, cart.lines, new Map());
  return {
    discountId: d.id,
    code: typedCode ?? d.code,
    ...(bulkCodeId ? { bulkCodeId } : {}),
    title: d.title,
    type: d.type,
    discountClass: discountClassOf(d),
    amount,
    ...(lineAmounts ? { lineAmounts } : {}),
    freeShipping: d.type === "free_shipping",
    ...(d.type === "free_shipping" ? { maxShipping: parseDiscountRules(d.rules).maxShipping ?? null } : {}),
    automatic,
  };
}

/**
 * Stacking (ADR-045). Candidates are taken in order: codes the shopper typed first, then the one worth most. A candidate
 * is taken when its slot is free (one order discount, one shipping discount, and product discounts only on lines nobody
 * else has) and, against a discount of a different class, both opted in (`combinable`). Because it is a fixed order, the
 * result never depends on row order. A typed code that lost is told so instead of silently disappearing.
 */
export function evaluateDiscounts(input: EngineInput): EngineResult {
  const { cart } = input;
  const rejections: EngineRejection[] = [];
  const candidates: EngineApplication[] = [];
  const byId = new Map<string, EngineDiscount>();

  const typed = [...new Set(input.codes.map(normalise).filter(Boolean))].slice(0, MAX_CODES_PER_CART);
  const typedAt = new Map<string, number>(); // discount id to how early the shopper typed its code
  typed.forEach((code, index) => {
    const bulk = input.bulk?.[code];
    const d = bulk ? input.discounts.find((x) => x.id === bulk.discountId) : input.discounts.find((x) => x.code !== null && normalise(x.code) === code);
    if (!d) {
      rejections.push({ code, reason: "Discount code not found" });
      return;
    }
    if (bulk?.used) {
      rejections.push({ code, reason: "This code has already been used" });
      return;
    }
    const reason = ineligibleReason(d, input, true);
    if (reason) {
      rejections.push({ code, reason });
      return;
    }
    byId.set(d.id, d);
    typedAt.set(d.id, index);
    candidates.push(toApplication(d, cart, false, code, bulk?.codeId));
  });
  for (const d of input.discounts) {
    if (d.code !== null || d.usesCodeList || byId.has(d.id)) continue;
    if (ineligibleReason(d, input, false) !== null) continue;
    byId.set(d.id, d);
    candidates.push(toApplication(d, cart, true));
  }

  const age = (a: EngineApplication) => byId.get(a.discountId)?.createdAt.getTime() ?? 0;
  candidates.sort((a, b) => {
    if (a.automatic !== b.automatic) return a.automatic ? 1 : -1; // typed codes first
    if (!a.automatic) return (typedAt.get(a.discountId) ?? 0) - (typedAt.get(b.discountId) ?? 0); // earlier codes keep their place
    if (a.amount !== b.amount) return b.amount - a.amount;
    return age(a) - age(b) || a.discountId.localeCompare(b.discountId);
  });
  const combinable = (a: EngineApplication) => byId.get(a.discountId)?.combinable === true;

  const accepted: EngineApplication[] = [];
  for (const c of candidates) {
    const sameClass = accepted.filter((a) => a.discountClass === c.discountClass);
    let fits: boolean;
    if (c.discountClass === "product") {
      const taken = new Set(sameClass.flatMap((a) => Object.keys(a.lineAmounts ?? {})));
      fits = Object.keys(c.lineAmounts ?? {}).every((id) => !taken.has(id));
    } else {
      fits = sameClass.length === 0;
    }
    if (fits) fits = accepted.filter((a) => a.discountClass !== c.discountClass).every((a) => combinable(a) && combinable(c));
    if (fits) accepted.push(c);
    else if (!c.automatic && c.code) rejections.push({ code: normalise(c.code), reason: "This code can't be combined with the other discount on your order" });
  }

  // An order discount comes off what is left after product discounts, so the two never take more than a line costs.
  const remaining = new Map<string, number>(cart.lines.map((l) => [l.id, l.lineTotal]));
  for (const a of accepted) {
    for (const [lineId, amt] of Object.entries(a.lineAmounts ?? {})) remaining.set(lineId, (remaining.get(lineId) ?? 0) - amt);
  }
  const applications = accepted.map((a) => {
    if (a.discountClass !== "order") return a;
    const d = byId.get(a.discountId) as EngineDiscount;
    return { ...a, amount: computeAmount(d, cart.lines, remaining).amount };
  });

  const order: DiscountClass[] = ["product", "order", "shipping"];
  applications.sort((a, b) => order.indexOf(a.discountClass) - order.indexOf(b.discountClass));
  return { applications, rejections };
}

/**
 * How much of the applied goods discounts lands on each cart line, in line order: product discounts on their own lines,
 * then order discounts spread over what each line still costs. The tax and the order items are built from this.
 */
export function allocateApplications(lines: Array<{ id: string; lineTotal: number }>, applications: Array<Pick<EngineApplication, "discountClass" | "amount" | "lineAmounts">>): number[] {
  const out = lines.map(() => 0);
  const idx = new Map(lines.map((l, i) => [l.id, i]));
  for (const a of applications) {
    if (a.discountClass !== "product") continue;
    for (const [lineId, amt] of Object.entries(a.lineAmounts ?? {})) {
      const i = idx.get(lineId);
      if (i !== undefined) out[i] = (out[i] ?? 0) + amt;
    }
  }
  const orderTotal = applications.filter((a) => a.discountClass === "order").reduce((s, a) => s + a.amount, 0);
  if (orderTotal > 0) {
    const left = lines.map((l, i) => Math.max(0, l.lineTotal - (out[i] ?? 0)));
    const shares = splitProportionally(left, Math.min(orderTotal, left.reduce((a, b) => a + b, 0)));
    shares.forEach((s, i) => {
      out[i] = (out[i] ?? 0) + s;
    });
  }
  return out;
}

/** The closest automatic offer a shopper has not reached yet: spend `remaining` more to get `benefit`. */
export interface EngineNudge {
  /** Minor units still to spend. */
  remaining: number;
  /** The subtotal at which the offer starts. */
  threshold: number;
  /** "10% off", "free shipping", "₹100 off". */
  benefit: string;
}

/**
 * The nearest automatic discount (or the next tier of one) that more spending would unlock. Only offers that apply by
 * themselves count: a code the shopper has not typed is not something to nudge towards. The numbers are worked out here,
 * on the server, so the cart never does pricing in the browser.
 */
export function nextOffer(input: EngineInput): EngineNudge | null {
  const { cart } = input;
  const label = (d: EngineDiscount, value: number): string =>
    d.type === "free_shipping" ? "free shipping" : d.type === "percent" ? `${value}% off` : `${formatMoney(value, cart.currency)} off`;
  let best: (EngineNudge & { value: number }) | null = null;
  const consider = (threshold: number, benefit: string, value: number) => {
    const remaining = threshold - cart.subtotal;
    if (remaining <= 0) return;
    if (!best || remaining < best.remaining || (remaining === best.remaining && value > best.value)) best = { remaining, threshold, benefit, value };
  };

  for (const d of input.discounts) {
    if (d.code !== null || d.usesCodeList) continue;
    if (!["percent", "fixed", "free_shipping"].includes(d.type)) continue;
    const scope = parseDiscountAppliesTo(d.appliesTo);
    if (!scope || scope.type !== "all") continue;
    // An offer made for some customers needs a code, so there is nothing to nudge towards.
    if (parseDiscountEligibility(d.customerEligibility)?.type !== "all") continue;
    const rules = parseDiscountRules(d.rules);
    if (rules.tierBy === "quantity") continue;
    const reason = ineligibleReason(d, input, false);
    if (reason !== null && !reason.startsWith("Minimum order subtotal")) continue;

    if (rules.tiers) {
      for (const tier of rules.tiers) consider(tier.threshold, label(d, tier.value), tier.value);
    } else if (d.minSubtotal && d.minSubtotal > cart.subtotal) {
      consider(d.minSubtotal, label(d, d.value), d.value);
    }
  }
  if (!best) return null;
  const { remaining, threshold, benefit } = best as EngineNudge & { value: number };
  return { remaining, threshold, benefit };
}
