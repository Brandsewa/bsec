import { describe, expect, it } from "vitest";
import { applyBps, currencySymbol, formatMoney, minorUnitExponent, normalizeCurrency, toMajorUnits, toMinorUnits } from "../src/money.ts";
import { autoWeightUnit, formatWeight, gramsToUnit, unitToGrams, unitsForSystem } from "../src/units.ts";

describe("money", () => {
  it("formats INR like the old storefront did, without a hardcoded sign", () => {
    expect(formatMoney(129900, "INR")).toBe("₹1,299");
    expect(formatMoney(129950, "INR")).toBe("₹1,299.50");
    expect(formatMoney(12345678, "INR")).toBe("₹1,23,456.78");
  });
  it("formats USD and CAD in their own locales", () => {
    expect(formatMoney(1250, "USD")).toBe("$12.50");
    expect(formatMoney(1200, "USD")).toBe("$12");
    expect(formatMoney(1200, "USD", { alwaysShowFraction: true })).toBe("$12.00");
    expect(formatMoney(1250, "CAD")).toContain("12.50");
    expect(formatMoney(1250, "USD", { codeInsteadOfSymbol: true })).toMatch(/USD\s?12\.50/);
  });
  it("handles zero, negative and bigint amounts", () => {
    expect(formatMoney(0, "INR")).toBe("₹0");
    expect(formatMoney(-5000, "USD")).toBe("-$50");
    expect(formatMoney(10000n, "USD")).toBe("$100");
  });
  it("converts between major and minor units with the currency exponent", () => {
    expect(toMinorUnits(12.34, "USD")).toBe(1234);
    expect(toMinorUnits(1.005, "USD")).toBe(101);
    expect(toMinorUnits(500, "JPY")).toBe(500);
    expect(toMajorUnits(1234, "USD")).toBe(12.34);
    expect(minorUnitExponent("JPY")).toBe(0);
    expect(minorUnitExponent("ZZZ")).toBe(2);
  });
  it("falls back to INR for a missing or invalid code", () => {
    expect(normalizeCurrency(undefined)).toBe("INR");
    expect(normalizeCurrency("us")).toBe("INR");
    expect(normalizeCurrency("usd")).toBe("USD");
  });
  it("gives symbols and basis-point rounding", () => {
    expect(currencySymbol("INR")).toBe("₹");
    expect(currencySymbol("USD")).toBe("$");
    expect(applyBps(1000, 250)).toBe(25);
    expect(applyBps(-1000, 250)).toBe(-25);
    expect(applyBps(1, 5000)).toBe(1);
  });
});

describe("units", () => {
  it("round-trips at the boundaries", () => {
    expect(unitToGrams(1, "lb")).toBe(454);
    expect(gramsToUnit(454, "lb")).toBe(1.001);
    expect(unitToGrams(1, "oz")).toBe(28);
    expect(unitToGrams(2.5, "kg")).toBe(2500);
    expect(gramsToUnit(2500, "kg")).toBe(2.5);
    expect(gramsToUnit(500, "g")).toBe(500);
  });
  it("never drifts a stored gram value by more than rounding", () => {
    for (const g of [1, 7, 99, 250, 999, 1000, 4536, 123456]) {
      for (const unit of ["g", "kg", "oz", "lb"] as const) {
        const back = unitToGrams(gramsToUnit(g, unit), unit);
        const tolerance = unit === "oz" ? 0.3 : unit === "lb" ? 0.5 : 0.5;
        expect(Math.abs(back - g)).toBeLessThanOrEqual(Math.max(tolerance, 0.0006 * g));
      }
    }
  });
  it("lists units per system and picks display units", () => {
    expect(unitsForSystem("metric")).toEqual(["g", "kg"]);
    expect(unitsForSystem("imperial")).toEqual(["oz", "lb"]);
    expect(autoWeightUnit(500, "metric")).toBe("g");
    expect(autoWeightUnit(1500, "metric")).toBe("kg");
    expect(autoWeightUnit(200, "imperial")).toBe("oz");
    expect(autoWeightUnit(1000, "imperial")).toBe("lb");
  });
  it("formats weights", () => {
    expect(formatWeight(1500, "kg")).toBe("1.5 kg");
    expect(formatWeight(500, "g")).toBe("500 g");
    expect(formatWeight(1000, "lb")).toBe("2.205 lb");
  });
});
