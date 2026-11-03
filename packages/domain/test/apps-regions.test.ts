import { describe, expect, it } from "vitest";
import { IN_STATE_CODES, isIndianStateCode, normalizeIndianState } from "../src/apps/regions.ts";

describe("normalizeIndianState (ADR-044)", () => {
  it("accepts current ISO codes in any case, with or without the IN- prefix", () => {
    expect(normalizeIndianState("MH")).toBe("MH");
    expect(normalizeIndianState("mh")).toBe("MH");
    expect(normalizeIndianState(" IN-KA ")).toBe("KA");
  });

  it("maps the codes geolocation sources still return to the current ISO code", () => {
    expect(normalizeIndianState("OR")).toBe("OD");
    expect(normalizeIndianState("TS")).toBe("TG");
    expect(normalizeIndianState("UK")).toBe("UT");
    expect(normalizeIndianState("DN")).toBe("DD");
    expect(normalizeIndianState("DH")).toBe("DD");
  });

  it("returns null for empty, unknown and non-Indian values", () => {
    expect(normalizeIndianState(null)).toBeNull();
    expect(normalizeIndianState("")).toBeNull();
    expect(normalizeIndianState("CA")).toBe(null);
    expect(normalizeIndianState("ZZ")).toBeNull();
    expect(normalizeIndianState("Maharashtra")).toBeNull();
  });

  it("covers all 28 states and 8 union territories exactly once", () => {
    expect(IN_STATE_CODES).toHaveLength(36);
    expect(new Set(IN_STATE_CODES).size).toBe(36);
    expect(IN_STATE_CODES.every(isIndianStateCode)).toBe(true);
  });
});
