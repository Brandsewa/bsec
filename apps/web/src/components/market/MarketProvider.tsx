"use client";

import React, { createContext, useContext, useMemo } from "react";
import { formatMoney, type FormatMoneyOptions } from "@bs/contracts/money";

export interface MarketClientValue {
  currency: string;
  locale: string;
  /** "/us" for a prefixed market, "" otherwise. */
  prefix: string;
}

const DEFAULT: MarketClientValue = { currency: "INR", locale: "en-IN", prefix: "" };
const MarketContextValue = createContext<MarketClientValue>(DEFAULT);

/** Gives client components the shopper's market, so prices use its currency and links keep its URL prefix (ADR-040). */
export function MarketProvider({ value, children }: { value: MarketClientValue; children: React.ReactNode }) {
  const stable = useMemo(() => value, [value.currency, value.locale, value.prefix]); // eslint-disable-line react-hooks/exhaustive-deps
  return <MarketContextValue.Provider value={stable}>{children}</MarketContextValue.Provider>;
}

export function useMarket(): MarketClientValue {
  return useContext(MarketContextValue);
}

/** `money(minorUnits)` formats in the current market's currency and locale. Never write a currency sign by hand. */
export function useMoney(): (minor: number | bigint, options?: FormatMoneyOptions) => string {
  const { currency, locale } = useMarket();
  return useMemo(() => (minor, options) => formatMoney(minor, currency, { locale, ...options }), [currency, locale]);
}

/** Prefixes an internal storefront path with the current market's URL prefix. */
export function useMarketHref(): (path: string) => string {
  const { prefix } = useMarket();
  return (path) => (prefix && path.startsWith("/") && !path.startsWith("/api/") ? `${prefix}${path}` : path);
}
