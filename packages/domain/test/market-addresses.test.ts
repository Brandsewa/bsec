import { describe, expect, it } from "vitest";
import { CA_PROVINCES, US_STATES, addressProblem, normalizePhone, phoneProblem, postalCodeProblem, regionsFor } from "../src/markets/addresses.ts";

describe("postal codes", () => {
  it("keeps the Indian rule exactly", () => {
    expect(postalCodeProblem("IN", "560001")).toBeNull();
    expect(postalCodeProblem("IN", "060001")).toMatch(/6-digit/);
    expect(postalCodeProblem("IN", "5600")).toMatch(/6-digit/);
  });
  it("accepts US ZIP and ZIP+4 and Canadian postal codes", () => {
    expect(postalCodeProblem("US", "94103")).toBeNull();
    expect(postalCodeProblem("US", "94103-1234")).toBeNull();
    expect(postalCodeProblem("US", "9410")).toMatch(/ZIP/);
    expect(postalCodeProblem("CA", "M5V 2T6")).toBeNull();
    expect(postalCodeProblem("CA", "m5v2t6")).toBeNull();
    expect(postalCodeProblem("CA", "D5V 2T6")).toMatch(/postal code/);
    expect(postalCodeProblem("FR", "75001")).toBeNull();
    expect(postalCodeProblem("FR", "")).toMatch(/postal/);
  });
});

describe("phones", () => {
  it("normalises country codes", () => {
    expect(normalizePhone("US", "+1 (415) 555-2671")).toBe("4155552671");
    expect(normalizePhone("IN", "+91 98765 43210")).toBe("9876543210");
  });
  it("validates per country", () => {
    expect(phoneProblem("IN", "9876543210")).toBeNull();
    expect(phoneProblem("IN", "1234567890")).toMatch(/Indian/);
    expect(phoneProblem("US", "415-555-2671")).toBeNull();
    expect(phoneProblem("US", "115-555-2671")).toMatch(/10-digit/);
    expect(phoneProblem("CA", "+1 416 555 0199")).toBeNull();
    expect(phoneProblem("GB", "+44 20 7946 0958")).toBeNull();
    expect(phoneProblem("GB", "123")).toMatch(/valid phone/);
  });
});

describe("addressProblem", () => {
  it("needs a US state or Canadian province code", () => {
    expect(addressProblem({ country: "US", state: "CA", postalCode: "94103", phone: "415-555-2671" })).toBeNull();
    expect(addressProblem({ country: "US", state: "", postalCode: "94103" })).toMatch(/state/);
    expect(addressProblem({ country: "CA", state: "Ontario", postalCode: "M5V 2T6" })).toMatch(/province/);
  });
  it("requires a phone only when asked", () => {
    expect(addressProblem({ country: "US", state: "CA", postalCode: "94103", phone: "" })).toBeNull();
    expect(addressProblem({ country: "US", state: "CA", postalCode: "94103", phone: "" }, { phoneRequired: true })).toMatch(/10-digit/);
  });
  it("lists regions", () => {
    expect(US_STATES).toHaveLength(51);
    expect(CA_PROVINCES).toHaveLength(13);
    expect(regionsFor("ca")[0]).toEqual({ code: "AB", name: "Alberta" });
    expect(regionsFor("IN")).toEqual([]);
  });
});
