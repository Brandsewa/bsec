import { describe, expect, it } from "vitest";
import { decideMarket, type MarketEntry } from "../src/lib/market-detect.ts";

const IN: MarketEntry = { prefix: "", handle: "india", isBase: true, countries: ["IN"] };
const INTL: MarketEntry = { prefix: "/global", handle: "international", isBase: false, countries: ["US", "CA", "DE"] };
const base = { markets: [IN, INTL], prefixMatched: false, cookieHandle: null, country: null, isBot: false, isDocument: true };

describe("decideMarket", () => {
  it("does nothing with a single market, a prefix in the URL, a bot, or a non-page request", () => {
    expect(decideMarket({ ...base, markets: [IN], country: "US" })).toEqual({ redirectPrefix: null, setCookie: null });
    expect(decideMarket({ ...base, prefixMatched: true, country: "US" })).toEqual({ redirectPrefix: null, setCookie: null });
    expect(decideMarket({ ...base, isBot: true, country: "US" })).toEqual({ redirectPrefix: null, setCookie: null });
    expect(decideMarket({ ...base, isDocument: false, country: "US" })).toEqual({ redirectPrefix: null, setCookie: null });
  });

  it("places a first-time visitor by country, silently, and remembers it", () => {
    expect(decideMarket({ ...base, country: "DE" })).toEqual({ redirectPrefix: "/global", setCookie: "international" });
    expect(decideMarket({ ...base, country: "IN" })).toEqual({ redirectPrefix: null, setCookie: "india" });
  });

  it("sends a country no market covers to the base market", () => {
    expect(decideMarket({ ...base, country: "BR" })).toEqual({ redirectPrefix: null, setCookie: "india" });
    expect(decideMarket({ ...base, country: null })).toEqual({ redirectPrefix: null, setCookie: "india" });
  });

  it("keeps a saved choice and never detects again", () => {
    expect(decideMarket({ ...base, cookieHandle: "international", country: "IN" })).toEqual({ redirectPrefix: "/global", setCookie: null });
    expect(decideMarket({ ...base, cookieHandle: "india", country: "US" })).toEqual({ redirectPrefix: null, setCookie: null });
  });

  it("treats an unknown saved handle as no choice", () => {
    expect(decideMarket({ ...base, cookieHandle: "deleted-market", country: "US" })).toEqual({ redirectPrefix: "/global", setCookie: "international" });
  });
});
