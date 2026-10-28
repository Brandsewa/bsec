/**
 * Pure market rules (ADR-040): price derivation, tax arithmetic, country-to-market lookup, market readiness.
 * No database here, so storefront, cart, checkout and the admin preview all use the same functions and cannot disagree.
 */
import { minorUnitExponent } from "@bs/contracts/money";

export const ROUNDING_MODES = ["none", "nearest_whole", "charm_99", "charm_95"] as const;
export type RoundingMode = (typeof ROUNDING_MODES)[number];

export interface DeriveInput {
  baseMinor: number;
  baseCurrency: string;
  targetCurrency: string;
  /** Base currency -> market currency, merchant-entered (decision 3). */
  fxRate: number;
  adjustBps: number;
  rounding: RoundingMode;
}

function roundHalfUp(x: number): number {
  return Math.round(x + Number.EPSILON * Math.abs(x));
}

/** Round an amount in major units to minor units under a market's rounding rule. */
export function roundToMinor(major: number, currency: string, mode: RoundingMode): number {
  if (!(major > 0)) return 0;
  const exp = minorUnitExponent(currency);
  const f = 10 ** exp;
  switch (mode) {
    case "nearest_whole":
      return Math.max(1, Math.round(major)) * f;
    case "charm_99":
    case "charm_95": {
      if (exp === 0) return Math.max(1, Math.round(major));
      const cents = Math.round(f * (mode === "charm_99" ? 0.99 : 0.95));
      return Math.floor(major) * f + cents;
    }
    default:
      return roundHalfUp(major * f);
  }
}

/** The one price formula: base price x rate x (1 + adjustment), then the market's rounding rule. */
export function derivePrice(i: DeriveInput): number {
  if (i.baseMinor <= 0) return 0;
  const baseMajor = i.baseMinor / 10 ** minorUnitExponent(i.baseCurrency);
  const major = baseMajor * i.fxRate * (1 + i.adjustBps / 10_000);
  return roundToMinor(major, i.targetCurrency, i.rounding);
}

export interface TaxRuleRow {
  country: string;
  region: string; // '*' = whole country
  taxName: string;
  rateBps: number;
}

export interface TaxLine {
  name: string;
  rateBps: number;
  amount: number;
}

export interface TaxInput {
  /** Taxable goods per line, after discounts, in minor units. */
  lineAmounts: readonly number[];
  shippingAmount: number;
  taxShippingToo: boolean;
  /** true when listed prices already include tax (the tax is carved out, the total does not change). */
  pricesIncludeTax: boolean;
  country: string;
  region: string | null | undefined;
  rules: readonly TaxRuleRow[];
}

export interface TaxResult {
  lines: TaxLine[];
  /** Tax added on top of the goods and shipping (0 when prices include tax). */
  addedTotal: number;
  /** Total tax contained in the order, whether added or already inside the prices. */
  containedTotal: number;
}

export function matchTaxRules(rules: readonly TaxRuleRow[], country: string, region: string | null | undefined): TaxRuleRow[] {
  const c = country.toUpperCase();
  const r = (region ?? "").trim().toUpperCase();
  return rules.filter((rule) => rule.country.toUpperCase() === c && (rule.region === "*" || rule.region.toUpperCase() === r));
}

/**
 * Generic merchant-entered tax: every matching row is applied, per line in minor units, half-up, then summed.
 * Exclusive: tax = amount x rate. Inclusive: tax = amount - amount / (1 + rate), so the total is unchanged.
 */
export function computeTax(input: TaxInput): TaxResult {
  const matched = matchTaxRules(input.rules, input.country, input.region);
  const bases = [...input.lineAmounts];
  if (input.taxShippingToo) bases.push(input.shippingAmount);
  const lines: TaxLine[] = [];
  for (const rule of matched) {
    let amount = 0;
    for (const base of bases) {
      if (base <= 0) continue;
      amount += input.pricesIncludeTax
        ? roundHalfUp(base - base / (1 + rule.rateBps / 10_000))
        : roundHalfUp((base * rule.rateBps) / 10_000);
    }
    lines.push({ name: rule.taxName, rateBps: rule.rateBps, amount });
  }
  const containedTotal = lines.reduce((s, l) => s + l.amount, 0);
  return { lines, addedTotal: input.pricesIncludeTax ? 0 : containedTotal, containedTotal };
}

export interface MarketCountryRow {
  marketId: string;
  country: string;
}

/** Which market covers a country. Unknown country (or none) -> the base market. */
export function marketIdForCountry(rows: readonly MarketCountryRow[], country: string | null | undefined, baseMarketId: string): string {
  if (!country) return baseMarketId;
  const c = country.toUpperCase();
  return rows.find((r) => r.country === c)?.marketId ?? baseMarketId;
}

export interface ReadinessInput {
  isBase: boolean;
  currency: string;
  baseCurrency: string;
  fxRate: number | null;
  countryCount: number;
  paymentMethodCount: number;
  shippingRateCount: number;
  policyFilled: boolean;
  taxChoiceAcknowledged: boolean;
}

export interface ReadinessItem {
  key: "currency_rate" | "countries" | "gateway" | "shipping" | "policy" | "tax_acknowledgement";
  ok: boolean;
  message: string;
}

/** What a non-base market needs before it can go active (plan section 6.1 / 7). The base market is always ready. */
export function marketReadiness(i: ReadinessInput): { ready: boolean; items: ReadinessItem[] } {
  const items: ReadinessItem[] = [
    {
      key: "currency_rate",
      ok: i.isBase || i.currency === i.baseCurrency || (i.fxRate !== null && i.fxRate > 0),
      message: "Set the exchange rate from your store currency",
    },
    { key: "countries", ok: i.countryCount > 0, message: "Add at least one country" },
    { key: "gateway", ok: i.isBase || i.paymentMethodCount > 0, message: "Offer at least one payment method" },
    { key: "shipping", ok: i.isBase || i.shippingRateCount > 0, message: "Add a shipping rate for this market" },
    { key: "policy", ok: i.isBase || i.policyFilled, message: "Write your returns and cancellation policy" },
    {
      key: "tax_acknowledgement",
      ok: i.isBase || i.taxChoiceAcknowledged,
      message: "Confirm you are responsible for tax rates and policies",
    },
  ];
  return { ready: items.every((x) => x.ok), items };
}

/** Plan limit for extra markets (decision 12): the base market does not count. */
export function canAddMarket(extraMarketCount: number, maxExtraMarkets: number): boolean {
  return extraMarketCount < maxExtraMarkets;
}

/** Handle for a market URL prefix and name: "United States" -> "united-states". */
export function slugifyHandle(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize("NFKD")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "market"
  );
}

/** Reserved first path segments a market prefix may never take (storefront routes). */
export const RESERVED_PREFIXES = new Set([
  "api", "admin", "account", "cart", "checkout", "products", "collections", "categories", "search", "blog", "orders", "o",
  "pages", "policies", "about", "contact", "address", "cod", "media", "preview", "signup", "pricing", "privacy", "_next",
]);

export function isValidPathPrefix(prefix: string): boolean {
  const m = /^\/([a-z0-9-]{1,40})$/.exec(prefix);
  return !!m && !RESERVED_PREFIXES.has(m[1]!);
}
