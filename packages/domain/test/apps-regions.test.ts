import { describe, expect, it } from "vitest";
import { IN_STATE_CODES, isIndianStateCode, normalizeIndianState, stateCodeForName } from "../src/apps/regions.ts";
import { parsePincodeCsv, parsePincodeJson } from "../src/apps/pincodes.ts";

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

describe("stateCodeForName", () => {
  it("matches names in any case, with ampersands and older spellings", () => {
    expect(stateCodeForName("TAMIL NADU")).toBe("TN");
    expect(stateCodeForName("Jammu & Kashmir")).toBe("JK");
    expect(stateCodeForName("Andaman & Nicobar Islands")).toBe("AN");
    expect(stateCodeForName("Orissa")).toBe("OD");
    expect(stateCodeForName("Daman and Diu")).toBe("DD");
    expect(stateCodeForName("Narnia")).toBeNull();
    expect(stateCodeForName(null)).toBeNull();
  });
});

describe("parsePincodeCsv", () => {
  it("collapses repeated pincodes, maps names, and reports bad rows", () => {
    const csv = [
      "officename,pincode,statename",
      "Fort S.O,400001,MAHARASHTRA",
      "Mumbai G.P.O.,400001,MAHARASHTRA",
      "\"Koramangala, Bangalore\",560034,KARNATAKA",
      "Bad,12345,KARNATAKA",
      "Odd,560001,Atlantis",
      "Clash A,700001,WEST BENGAL",
      "Clash B,700001,ASSAM",
    ].join("\n");
    const out = parsePincodeCsv(csv);
    expect(out.rows.sort((a, b) => a.pincode.localeCompare(b.pincode))).toEqual([
      { pincode: "400001", stateCode: "MH" },
      { pincode: "560034", stateCode: "KA" },
    ]);
    expect(out.skipped.map((x) => x.reason)).toEqual(
      expect.arrayContaining(["not a pincode: 12345", "unknown state: Atlantis", "pincode 700001 appears in more than one state"]),
    );
  });

  it("refuses a file without pincode and state columns", () => {
    expect(() => parsePincodeCsv("a,b\n1,2")).toThrow(/pincode column/);
  });
});

describe("parsePincodeJson", () => {
  it("reads the keyed directory, maps the spellings in the file, and skips blank or unknown states", () => {
    const out = parsePincodeJson(
      JSON.stringify({
        "110001": { state: "Delhi", district: "New Delhi" },
        "744101": { state: "Andaman And Nicobar Islands", district: "South Andaman" },
        "396230": { state: "The Dadra And Nagar Haveli And Daman And Diu", district: "Dadra" },
        "180001": { state: "Jammu And Kashmir", district: "Jammu" },
        "121999": { state: "", district: "" },
        "555555": { state: "Atlantis", district: "" },
        "12": { state: "Delhi" },
        "799001": { state: "Telangana" },
      }),
    );
    expect(out.rows.map((r) => `${r.pincode}:${r.stateCode}`).sort()).toEqual(["110001:DL", "180001:JK", "396230:DD", "744101:AN", "799001:TR"]);
    expect(out.skipped.map((x) => x.reason)).toEqual(expect.arrayContaining(["no state for 121999", "unknown state for 555555: Atlantis", "not a pincode: 12"]));
  });

  it("refuses a file that is not an object", () => {
    expect(() => parsePincodeJson("[]")).toThrow(/keyed by pincode/);
  });
});
