import { describe, it, expect } from "vitest";
import { deriveAccent } from "../src/server.ts";
import { parseHex, relativeLuminance, contrastRatio } from "../src/theme/accent.ts";

function getContrastAgainstWhite(hex: string): number {
  const rgb = parseHex(hex);
  if (!rgb) throw new Error(`Invalid hex color: ${hex}`);
  const lum = relativeLuminance(rgb[0], rgb[1], rgb[2]);
  return contrastRatio(1, lum); // White has luminance 1
}

describe("deriveAccent (Guide §11)", () => {
  describe("Invalid inputs", () => {
    it("returns null for empty string", () => {
      expect(deriveAccent("")).toBeNull();
    });

    it("returns null for non-color strings", () => {
      expect(deriveAccent("not-a-color")).toBeNull();
      expect(deriveAccent("hello world")).toBeNull();
      expect(deriveAccent("#xyz")).toBeNull();
      expect(deriveAccent("#12345")).toBeNull();
    });

    it("returns null for null and undefined", () => {
      expect(deriveAccent(null)).toBeNull();
      expect(deriveAccent(undefined)).toBeNull();
    });
  });

  describe("Edge colours", () => {
    it("handles very light yellow (#ffffe0)", () => {
      const derived = deriveAccent("#ffffe0");
      expect(derived).not.toBeNull();
      if (!derived) return;

      expect(derived.fill).toBe("#ffffe0");
      expect(derived.onFill).toBe("#000000");
      expect(derived.ring).toBe("#ffffe0");

      const inkContrast = getContrastAgainstWhite(derived.ink);
      expect(inkContrast).toBeGreaterThanOrEqual(4.5);
    });

    it("handles pure black (#000000)", () => {
      const derived = deriveAccent("#000000");
      expect(derived).not.toBeNull();
      if (!derived) return;

      expect(derived.fill).toBe("#000000");
      expect(derived.onFill).toBe("#ffffff");
      expect(derived.ring).toBe("#000000");

      const inkContrast = getContrastAgainstWhite(derived.ink);
      expect(inkContrast).toBeGreaterThanOrEqual(4.5);
    });

    it("handles saturated red (#ff0000)", () => {
      const derived = deriveAccent("#ff0000");
      expect(derived).not.toBeNull();
      if (!derived) return;

      expect(derived.fill).toBe("#ff0000");
      // Original #ff0000 against white is ~3.998:1 (< 4.5:1), ink must be darkened to pass AA
      const inkContrast = getContrastAgainstWhite(derived.ink);
      expect(inkContrast).toBeGreaterThanOrEqual(4.5);
    });

    it("handles platform mint (#00d4a4)", () => {
      const derived = deriveAccent("#00d4a4");
      expect(derived).not.toBeNull();
      if (!derived) return;

      expect(derived.fill).toBe("#00d4a4");
      expect(derived.onFill).toBe("#000000");
      expect(derived.ring).toBe("#00d4a4");

      const inkContrast = getContrastAgainstWhite(derived.ink);
      expect(inkContrast).toBeGreaterThanOrEqual(4.5);
    });

    it("supports 3-digit shorthand hex (#f00)", () => {
      const derived = deriveAccent("#f00");
      expect(derived).not.toBeNull();
      if (!derived) return;

      expect(derived.fill).toBe("#ff0000");
      const inkContrast = getContrastAgainstWhite(derived.ink);
      expect(inkContrast).toBeGreaterThanOrEqual(4.5);
    });

    it("supports hex without leading hash (00d4a4)", () => {
      const derived = deriveAccent("00d4a4");
      expect(derived).not.toBeNull();
      if (!derived) return;

      expect(derived.fill).toBe("#00d4a4");
      const inkContrast = getContrastAgainstWhite(derived.ink);
      expect(inkContrast).toBeGreaterThanOrEqual(4.5);
    });
  });
});
