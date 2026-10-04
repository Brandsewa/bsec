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

describe("heading sizes", () => {
  it("emits rem variables for every level and device, defaulting to the original block sizes", () => {
    const v = computeThemeTokens(null, {});
    expect(v["--bs-h1-d"]).toBe("3.75rem");
    expect(v["--bs-h1-m"]).toBe("2.25rem");
    expect(v["--bs-h2-d"]).toBe("2.25rem");
    expect(v["--bs-h6-t"]).toBe("0.875rem");
    expect(Object.keys(v).filter((k) => /^--bs-h[1-6]-[dtm]$/.test(k))).toHaveLength(18);
  });

  it("applies a theme's own sizes per device, clamps them and ignores unusable values", () => {
    const v = computeThemeTokens(null, { fontSizes: { h1: { desktop: 72, tablet: 4, mobile: "x" }, h2: { desktop: 1000 } } });
    expect(v["--bs-h1-d"]).toBe("4.5rem");
    expect(v["--bs-h1-t"]).toBe("0.75rem"); // clamped up to 12px
    expect(v["--bs-h1-m"]).toBe("2.25rem"); // not a number: default
    expect(v["--bs-h2-d"]).toBe("7.5rem"); // clamped down to 120px
    expect(v["--bs-h2-m"]).toBe("1.75rem"); // untouched
  });

  it("never lets a theme inject anything but numbers into the stylesheet", () => {
    const v = computeThemeTokens(null, { fontSizes: { h1: { desktop: "60px; background:url(x)" as never } } });
    expect(v["--bs-h1-d"]).toBe("3.75rem");
  });
});

describe("font weights and button colours", () => {
  it("defaults to the original weights and button look", () => {
    const v = computeThemeTokens({ primaryColor: "#0b6b42" });
    expect(v["--bs-heading-weight"]).toBe("700");
    expect(v["--bs-body-weight"]).toBe("400");
    expect(v["--bs-btn-dark-bg"]).toBe("#0b6b42");
    expect(v["--bs-btn-dark-fg"]).toBe("#ffffff");
    expect(v["--bs-btn-light-bg"]).toBe(v["--color-surface"]);
    expect(v["--bs-btn-light-fg"]).toBe(v["--color-text"]);
  });

  it("applies chosen weights and the dark/light button colours, and ignores unusable values", () => {
    const v = computeThemeTokens(null, {
      colors: { primary: "#1f3a5f" },
      fonts: { headingWeight: 600, bodyWeight: "500" },
      buttons: { darkBg: "#111111", darkText: "#fafafa", lightBg: "#e0f2fe", lightText: "#075985" },
    });
    expect(v["--bs-heading-weight"]).toBe("600");
    expect(v["--bs-body-weight"]).toBe("500");
    expect(v["--bs-btn-bg"]).toBe("#111111");
    expect(v["--bs-btn-fg"]).toBe("#fafafa");
    expect(v["--bs-btn-light-bg"]).toBe("#e0f2fe");
    expect(v["--bs-btn-light-bd"]).toBe("#e0f2fe");
    const bad = computeThemeTokens(null, { fonts: { headingWeight: 950, bodyWeight: "bold" }, buttons: { darkBg: "red; x", lightText: "url(x)" } });
    expect(bad["--bs-heading-weight"]).toBe("700");
    expect(bad["--bs-body-weight"]).toBe("400");
    expect(bad["--bs-btn-dark-bg"]).toBe(bad["--color-primary"]);
  });

  it("derives the outline and soft styles from the dark button colour", () => {
    const outline = computeThemeTokens(null, { buttons: { style: "outline", darkBg: "#7c3aed" } });
    expect(outline["--bs-btn-bd"]).toBe("#7c3aed");
    expect(outline["--bs-btn-fg"]).toBe("#7c3aed");
  });
});
