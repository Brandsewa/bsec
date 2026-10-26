import { describe, expect, it } from "vitest";
import { describeRouting, isApexDomain, type RoutingView } from "../src/lib/domain-hosts.ts";

const view = (over: Partial<RoutingView>): RoutingView => ({
  status: "unknown",
  seen: { a: [], aaaa: [], cname: null },
  probeFailed: false,
  failures: 0,
  checkedAt: null,
  expected: { cname: "stores.bcom.si", a: ["104.21.59.175"], aaaa: [] },
  ...over,
});

describe("isApexDomain", () => {
  it("treats bare domains as apex, including two-part suffixes", () => {
    expect(isApexDomain("darjeelinghoney.com")).toBe(true);
    expect(isApexDomain("mybrand.co.in")).toBe(true);
  });
  it("treats subdomains as not apex", () => {
    expect(isApexDomain("shop.mybrand.com")).toBe(false);
    expect(isApexDomain("www.mybrand.co.in")).toBe(false);
  });
});

describe("describeRouting", () => {
  it("names the missing record", () => {
    expect(describeRouting("a.com", view({ status: "dns_missing" })).text).toContain("no DNS record for a.com");
  });
  it("shows what it sees when DNS points elsewhere", () => {
    const r = describeRouting("a.com", view({ status: "dns_wrong", seen: { a: ["84.32.1.1"], aaaa: [], cname: null } }));
    expect(r.tone).toBe("problem");
    expect(r.text).toContain("84.32.1.1");
  });
  it("is ok only when reachable", () => {
    expect(describeRouting("a.com", view({ status: "reachable" })).tone).toBe("ok");
    expect(describeRouting("a.com", view({ status: "dns_ok", probeFailed: true })).tone).toBe("wait");
  });
});
