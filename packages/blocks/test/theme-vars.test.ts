import { describe, expect, it } from "vitest";
import { computeThemeTokens } from "../src/theme-vars.ts";

const fg = (primary: string) => computeThemeTokens({ primaryColor: primary })["--bs-primary-fg"];

describe("--bs-primary-fg (text on the brand colour)", () => {
  it("is white on dark colours, including ones starting with 3 valid hex digits", () => {
    expect(fg("#0f172a")).toBe("#ffffff"); // regression: was read as #0f1 and came out dark-on-dark
    expect(fg("#000000")).toBe("#ffffff");
    expect(fg("#0b6b42")).toBe("#ffffff");
  });

  it("is dark on light colours", () => {
    expect(fg("#ffffff")).toBe("#0f172a");
    expect(fg("#fff")).toBe("#0f172a");
    expect(fg("#f5a623")).toBe("#0f172a");
  });

  it("falls back safely for non-hex colours", () => {
    expect(fg("rgb(10, 20, 30)")).toBe("#ffffff");
  });
});
