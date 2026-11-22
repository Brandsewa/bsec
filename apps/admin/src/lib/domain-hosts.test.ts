import { describe, expect, it } from "vitest";
import { missingWwwTwins } from "./domain-hosts.ts";

describe("missingWwwTwins", () => {
  it("suggests the www twin of a bare domain and the bare twin of a www domain", () => {
    expect(missingWwwTwins(["mybrand.com"])).toEqual([{ have: "mybrand.com", add: "www.mybrand.com" }]);
    expect(missingWwwTwins(["www.mybrand.com"])).toEqual([{ have: "www.mybrand.com", add: "mybrand.com" }]);
    expect(missingWwwTwins(["mybrand.co.in"])).toEqual([{ have: "mybrand.co.in", add: "www.mybrand.co.in" }]);
  });

  it("says nothing when both are connected, or for other subdomains", () => {
    expect(missingWwwTwins(["mybrand.com", "WWW.mybrand.com"])).toEqual([]);
    expect(missingWwwTwins(["shop.mybrand.com"])).toEqual([]);
    expect(missingWwwTwins([])).toEqual([]);
  });
});
