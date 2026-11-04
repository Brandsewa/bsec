"use client";

import React, { createContext, useContext } from "react";
import { formatMinor } from "@/lib/money-client.ts";

export interface MarketClientValue {
  currency: string;
  locale: string;
  /** "/us" for a prefixed market, "" otherwise. */
  prefix: string;
  /** Every market the shopper can be in, for the footer selector. */
  markets?: Array<{ handle: string; name: string; currency: string; countries: string[] }> | undefined;
  currentHandle?: string | undefined;
  /** The page's path without the market prefix, so a change of market returns to the same page. */
  path?: string | undefined;
}

const DEFAULT: MarketClientValue = { currency: "INR", locale: "en-IN", prefix: "" };
const MarketContextValue = createContext<MarketClientValue>(DEFAULT);

/** Gives client components the shopper's market, so prices use its currency and links keep its URL prefix (ADR-040). */
export function MarketProvider({ value, children }: { value: MarketClientValue; children: React.ReactNode }) {
  return <MarketContextValue.Provider value={value}>{children}</MarketContextValue.Provider>;
}

export function useMarket(): MarketClientValue {
  return useContext(MarketContextValue);
}

/** `money(minorUnits)` formats in the current market's currency and locale. Never write a currency sign by hand. */
export function useMoney(): (minor: number | bigint) => string {
  const { currency, locale } = useMarket();
  return (minor) => formatMinor(minor, currency, locale);
}

/** Prefixes an internal storefront path with the current market's URL prefix. */
export function useMarketHref(): (path: string) => string {
  const { prefix } = useMarket();
  return (path) => (prefix && path.startsWith("/") && !path.startsWith("/api/") ? `${prefix}${path}` : path);
}
