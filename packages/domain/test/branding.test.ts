import { describe, it, expect } from "vitest";
import {
  checkWcagContrast,
  getContrastRatio,
  getRelativeLuminance,
} from "../src/branding/contrast.ts";
import {
  FAVICON_SIZES,
  generateWebManifest,
} from "../src/branding/favicon.ts";
import {
  CURATED_FONTS,
  getCuratedFont,
  getDevanagariFonts,
} from "../src/branding/fonts.ts";

describe("contrast utilities", () => {
  it("calculates relative luminance correctly", () => {
    expect(getRelativeLuminance("#000000")).toBeCloseTo(0, 4);
    expect(getRelativeLuminance("#ffffff")).toBeCloseTo(1, 4);
  });

  it("calculates contrast ratio correctly", () => {
    const ratioBlackWhite = getContrastRatio("#000000", "#ffffff");
    expect(ratioBlackWhite).toBeCloseTo(21, 1);

    const ratioIdentical = getContrastRatio("#ffffff", "#ffffff");
    expect(ratioIdentical).toBeCloseTo(1, 1);
  });

  it("checks WCAG AA compliance and passes for high contrast", () => {
    const result = checkWcagContrast("#111827", "#ffffff");
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
    expect(result.aaPass).toBe(true);
    expect(result.aaaPass).toBe(true);
    expect(result.aaLargePass).toBe(true);
  });

  it("checks WCAG AA compliance and suggests a fix for failing contrast", () => {
    // Light gray on white has poor contrast
    const result = checkWcagContrast("#9ca3af", "#ffffff");
    expect(result.ratio).toBeLessThan(4.5);
    expect(result.aaPass).toBe(false);
    expect(result.suggestedColor).toBeDefined();

    // Verify suggested fix passes WCAG AA
    if (result.suggestedColor) {
      const fixedResult = checkWcagContrast(result.suggestedColor, "#ffffff");
      expect(fixedResult.aaPass).toBe(true);
      expect(fixedResult.ratio).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("supports 3-digit and unhashed hex values", () => {
    const res1 = checkWcagContrast("#000", "#fff");
    const res2 = checkWcagContrast("000000", "ffffff");
    expect(res1.ratio).toBeCloseTo(21, 1);
    expect(res2.ratio).toBeCloseTo(21, 1);
  });
});

describe("favicon utilities", () => {
  it("defines the 5 required favicon sizes per PLAN §8.1", () => {
    expect(FAVICON_SIZES).toEqual([16, 32, 180, 192, 512]);
  });

  it("generates a valid web manifest with all icon sizes", () => {
    const iconUrls = {
      16: "https://cdn.brandsewa.com/icons/icon-16.png",
      32: "https://cdn.brandsewa.com/icons/icon-32.png",
      180: "https://cdn.brandsewa.com/icons/icon-180.png",
      192: "https://cdn.brandsewa.com/icons/icon-192.png",
      512: "https://cdn.brandsewa.com/icons/icon-512.png",
    };

    const manifest = generateWebManifest("Handicraft Studio", iconUrls);
    expect(manifest.name).toBe("Handicraft Studio");
    expect(manifest.short_name).toBe("Handicraft Studio");
    expect(manifest.start_url).toBe("/");
    expect(manifest.display).toBe("standalone");
    expect(manifest.icons).toHaveLength(5);
    expect(manifest.icons.some((i) => i.sizes === "192x192")).toBe(true);
    expect(manifest.icons.some((i) => i.sizes === "512x512")).toBe(true);
  });
});

describe("curated fonts", () => {
  it("includes at least 30 curated Google fonts", () => {
    expect(CURATED_FONTS.length).toBeGreaterThanOrEqual(30);
  });

  it("includes Devanagari capable fonts per PLAN §8.1", () => {
    const devanagariFonts = getDevanagariFonts();
    expect(devanagariFonts.length).toBeGreaterThanOrEqual(5);
    expect(devanagariFonts.some((f) => f.id === "mukta")).toBe(true);
    expect(devanagariFonts.some((f) => f.id === "poppins")).toBe(true);
  });

  it("all fonts point to self-hosted R2 paths", () => {
    for (const font of CURATED_FONTS) {
      expect(font.r2Path).toMatch(/^\/fonts\//);
      expect(font.weights.length).toBeGreaterThan(0);
    }
  });

  it("looks up font by id", () => {
    const inter = getCuratedFont("inter");
    expect(inter).toBeDefined();
    expect(inter?.name).toBe("Inter");
    expect(getCuratedFont("unknown-font-id")).toBeUndefined();
  });
});
