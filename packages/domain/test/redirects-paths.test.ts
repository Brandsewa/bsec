import { describe, expect, it } from "vitest";
import { normalizeFromPath, normalizeToPath, parseStatus, reservedReason, targetAsStorePath, wouldLoop } from "../src/redirects/paths.ts";

describe("normalizeFromPath", () => {
  it("makes a path of whatever was typed: no host, query, fragment or trailing slash", () => {
    expect(normalizeFromPath("old-page")).toBe("/old-page");
    expect(normalizeFromPath("/old-page/")).toBe("/old-page");
    expect(normalizeFromPath("/old-page?utm=1#x")).toBe("/old-page");
    expect(normalizeFromPath("https://shop.example/a//b/")).toBe("/a/b");
    expect(normalizeFromPath("  /spaced  ")).toBe("/spaced");
  });

  it("refuses what is not a path", () => {
    for (const bad of ["", "   ", "//evil.example/x", "/a\\b", "/tab\there", "https://", "x".repeat(600)]) {
      expect(normalizeFromPath(bad), bad).toBeNull();
    }
  });
});

describe("reservedReason", () => {
  it("protects the home page and the paths the store needs", () => {
    for (const p of ["/", "/api/x", "/_next/static/a.js", "/cart", "/checkout/pay", "/account/login", "/orders/abc/thank-you", "/o/token", "/robots.txt", "/.well-known/x", "/CART"]) {
      expect(reservedReason(p), p).not.toBeNull();
    }
  });

  it("allows ordinary pages, including ones that only start with a reserved word", () => {
    for (const p of ["/products/old-tea", "/blogs/news/post", "/carton", "/accounting", "/old"]) {
      expect(reservedReason(p), p).toBeNull();
    }
  });
});

describe("normalizeToPath", () => {
  it("accepts a store path or an http(s) address and nothing else", () => {
    expect(normalizeToPath("/new?a=1#b")).toBe("/new?a=1#b");
    expect(normalizeToPath("new-page")).toBe("/new-page");
    expect(normalizeToPath("https://example.com/a")).toBe("https://example.com/a");
    for (const bad of ["", "//evil.example", "javascript:alert(1)", "data:text/html,x", "ftp://x.example", "/a\\b"]) {
      expect(normalizeToPath(bad), bad).toBeNull();
    }
  });
});

describe("parseStatus and targetAsStorePath", () => {
  it("allows the four redirect statuses", () => {
    expect(parseStatus(301)).toBe(301);
    expect(parseStatus("308")).toBe(308);
    expect(parseStatus(200)).toBeNull();
    expect(parseStatus("abc")).toBeNull();
  });

  it("reads the store path of a target and ignores outside addresses", () => {
    expect(targetAsStorePath("/a/b/?x=1")).toBe("/a/b");
    expect(targetAsStorePath("https://example.com/a")).toBeNull();
  });
});

describe("wouldLoop", () => {
  const map = new Map([
    ["/b", "/c"],
    ["/c", "/a"],
  ]);

  it("finds a loop through existing redirects, case-insensitively", () => {
    expect(wouldLoop("/a", "/b", map)).toBe(true);
    expect(wouldLoop("/A", "/B", map)).toBe(true);
  });

  it("lets a redirect end on a page or an outside address", () => {
    expect(wouldLoop("/x", "/b", new Map([["/b", "/page"]]))).toBe(false);
    expect(wouldLoop("/x", "https://example.com/y", map)).toBe(false);
    expect(wouldLoop("/x", "/plain-page", new Map())).toBe(false);
  });

  it("refuses a chain that is too long to be useful", () => {
    const chain = new Map([["/1", "/2"], ["/2", "/3"], ["/3", "/4"], ["/4", "/5"], ["/5", "/6"], ["/6", "/7"], ["/7", "/8"]]);
    expect(wouldLoop("/start", "/1", chain)).toBe(true);
    expect(wouldLoop("/start", "/6", chain)).toBe(false);
  });
});
