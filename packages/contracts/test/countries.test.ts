import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, COUNTRY_CURRENCIES, countryName, defaultCurrencyForCountry, isCountryCode, listCountries, suggestCurrencyForCountries } from "../src/countries.ts";
import { currencyLabel, formatMoney, minorUnitExponent } from "../src/money.ts";

describe("countries and currencies", () => {
  it("lists every sellable country with a name and a default currency", () => {
    expect(COUNTRY_CODES.length).toBeGreaterThan(230);
    for (const code of COUNTRY_CODES) {
      expect(code).toMatch(/^[A-Z]{2}$/);
      expect(defaultCurrencyForCountry(code)).toMatch(/^[A-Z]{3}$/);
    }
    expect(listCountries().find((c) => c.code === "IN")?.name).toBe("India");
    expect(countryName("DE")).toBe("Germany");
  });

  it("recognises codes case-insensitively and rejects unknown ones", () => {
    expect(isCountryCode("in")).toBe(true);
    expect(isCountryCode("ZZ")).toBe(false);
  });

  it("suggests the currency from the chosen countries", () => {
    expect(suggestCurrencyForCountries(["US", "CA"])).toBe("USD");
    expect(suggestCurrencyForCountries(["DE", "FR", "IT"])).toBe("EUR");
    expect(suggestCurrencyForCountries([])).toBeUndefined();
  });

  it("covers the launch currencies and every currency a country uses", () => {
    for (const c of ["INR", "USD", "CAD", "EUR", "GBP", "AED", "JPY", "KWD"]) expect(COUNTRY_CURRENCIES).toContain(c);
  });

  it("knows each currency's decimal places and formats it", () => {
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("KWD")).toBe(3);
    expect(minorUnitExponent("EUR")).toBe(2);
    expect(formatMoney(1500, "JPY")).toContain("1,500");
    expect(formatMoney(12345, "KWD")).toContain("12.345");
    expect(currencyLabel("USD")).toBe("USD - US Dollar ($)");
  });
});
