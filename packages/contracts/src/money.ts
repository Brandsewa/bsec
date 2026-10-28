/**
 * Money helpers (ADR-040). Pure and dependency-free so the storefront, admin and domain can share them.
 *
 * Amounts are integer minor units (paise, cents) plus an ISO 4217 code. Columns still named `*_paise`
 * mean "minor units of the row's currency".
 */

/** Digits after the decimal point, per currency. Unlisted currencies default to 2. Add a row when a market needs one. */
const MINOR_UNIT_EXPONENT: Readonly<Record<string, number>> = {
  INR: 2,
  USD: 2,
  CAD: 2,
  JPY: 0,
};

/** Currencies markets may use at launch (owner scope: India, USA, Canada). */
export const LAUNCH_CURRENCIES = ["INR", "USD", "CAD"] as const;
export type LaunchCurrency = (typeof LAUNCH_CURRENCIES)[number];

const DEFAULT_LOCALE_BY_CURRENCY: Readonly<Record<string, string>> = {
  INR: "en-IN",
  USD: "en-US",
  CAD: "en-CA",
};

/** The store default until markets exist everywhere: India. */
export const DEFAULT_CURRENCY = "INR";

export function normalizeCurrency(currency: string | null | undefined): string {
  const c = (currency ?? "").trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : DEFAULT_CURRENCY;
}

export function minorUnitExponent(currency: string): number {
  return MINOR_UNIT_EXPONENT[normalizeCurrency(currency)] ?? 2;
}

export function defaultLocaleForCurrency(currency: string): string {
  return DEFAULT_LOCALE_BY_CURRENCY[normalizeCurrency(currency)] ?? "en-US";
}

/** 12.5 -> 1250 for a two-digit currency. Rounds half away from zero; the input should already be a clean decimal. */
export function toMinorUnits(major: number, currency: string): number {
  const factor = 10 ** minorUnitExponent(currency);
  const scaled = Math.abs(major) * factor;
  const rounded = Math.round(scaled + Number.EPSILON * scaled);
  return major < 0 ? -rounded : rounded;
}

export function toMajorUnits(minor: number | bigint, currency: string): number {
  return Number(minor) / 10 ** minorUnitExponent(currency);
}

export interface FormatMoneyOptions {
  /** Defaults to the currency's usual locale (en-IN for INR). Pass the market locale once markets exist. */
  locale?: string | undefined;
  /** Show ".00" on whole amounts. Default false: "₹1,299", but "₹1,299.50". */
  alwaysShowFraction?: boolean | undefined;
  /** Show the ISO code instead of the symbol, e.g. "USD 12.00". For places where two dollars could be confused. */
  codeInsteadOfSymbol?: boolean | undefined;
}

const formatterCache = new Map<string, Intl.NumberFormat>();

function formatter(locale: string, currency: string, minFraction: number, maxFraction: number, code: boolean): Intl.NumberFormat {
  const key = `${locale}|${currency}|${minFraction}|${maxFraction}|${code ? 1 : 0}`;
  let f = formatterCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: code ? "code" : "symbol",
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    });
    formatterCache.set(key, f);
  }
  return f;
}

/** Format minor units for display. Never use a hardcoded currency sign. */
export function formatMoney(minor: number | bigint, currency: string, options: FormatMoneyOptions = {}): string {
  const code = normalizeCurrency(currency);
  const exponent = minorUnitExponent(code);
  const factor = 10 ** exponent;
  const value = Number(minor);
  const whole = Math.abs(value) % factor === 0;
  const minFraction = options.alwaysShowFraction || !whole ? exponent : 0;
  const locale = options.locale ?? defaultLocaleForCurrency(code);
  return formatter(locale, code, minFraction, exponent, options.codeInsteadOfSymbol === true).format(value / factor);
}

/** The currency symbol on its own ("₹", "$"), for input prefixes. */
export function currencySymbol(currency: string, locale?: string): string {
  const code = normalizeCurrency(currency);
  const parts = new Intl.NumberFormat(locale ?? defaultLocaleForCurrency(code), {
    style: "currency",
    currency: code,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(0);
  return parts.find((p) => p.type === "currency")?.value ?? code;
}

/** Basis points helper: applyBps(1000, 250) = 25 (2.5%), half away from zero. */
export function applyBps(minor: number, bps: number): number {
  const raw = (minor * bps) / 10_000;
  return raw < 0 ? -Math.round(-raw) : Math.round(raw);
}
