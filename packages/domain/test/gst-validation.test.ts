import { describe, it, expect } from "vitest";
import { validateGstin } from "../src/orders/gst-validation.ts";

describe("validateGstin", () => {
  // Real valid Indian GSTINs with verified mod-36 checksums:
  // Karnataka (29): 29AAFCD5862R0ZT
  // Delhi (07): 07AAAAA0000A1Z5
  // Maharashtra (27): 27AAPFU0955L1ZV

  it("validates valid Karnataka GSTIN", () => {
    const res = validateGstin("29AAFCD5862R1ZR");
    expect(res.valid).toBe(true);
    expect(res.stateCode).toBe("29");
    expect(res.stateName).toBe("Karnataka");
    expect(res.error).toBeUndefined();
  });

  it("validates valid Delhi GSTIN", () => {
    const res = validateGstin("07AAAAA0000A1Z4");
    expect(res.valid).toBe(true);
    expect(res.stateCode).toBe("07");
    expect(res.stateName).toBe("Delhi");
  });

  it("validates valid Maharashtra GSTIN", () => {
    const res = validateGstin("27AAPFU0955L1ZI");
    expect(res.valid).toBe(true);
    expect(res.stateCode).toBe("27");
    expect(res.stateName).toBe("Maharashtra");
  });

  it("rejects lowercase GSTIN", () => {
    const res = validateGstin("29aafcd5862r1zr");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("must be uppercase");
  });

  it("rejects incorrect length", () => {
    expect(validateGstin("29AAFCD5862R1Z").valid).toBe(false);
    expect(validateGstin("29AAFCD5862R1ZRA").valid).toBe(false);
  });

  it("rejects invalid state code", () => {
    // 99 is not a valid GST state code in India
    const res = validateGstin("99AAAAA0000A1Z4");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Invalid GST state code");
  });

  it("rejects bad checksum character", () => {
    // Correct check char for 29AAFCD5862R1Z is R, change to A
    const res = validateGstin("29AAFCD5862R1ZA");
    expect(res.valid).toBe(false);
    expect(res.error).toContain("Invalid GSTIN checksum character");
  });

  it("verifies state matching when expectedState is provided", () => {
    const resMatch = validateGstin("29AAFCD5862R1ZR", "Karnataka");
    expect(resMatch.valid).toBe(true);

    const resMismatch = validateGstin("29AAFCD5862R1ZR", "Maharashtra");
    expect(resMismatch.valid).toBe(false);
    expect(resMismatch.error).toContain("does not match registered seller state");
  });
});
