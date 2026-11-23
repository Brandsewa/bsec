import { describe, expect, it } from "vitest";
import { AI_CELLS, isAllowedRedirectUri, isCellAllowed, localDay, humanWait, normalizeMatrix, readOnlyMatrix, storePermissionFor } from "../src/index.ts";

describe("AI permission matrix", () => {
  it("keeps only real toggle cells that are exactly true", () => {
    const m = normalizeMatrix({
      products: { read: true, write: "yes", delete: true },
      orders: { write: true }, // write is "soon": not a toggle yet
      collections: { read: true, delete: true },
      pages: { delete: true, write: "no" },
      finance: { read: true, write: true, delete: true }, // write and delete are locked
      customers: { write: true }, // n/a
      bogus: { read: true },
    });
    expect(m).toEqual({ products: { read: true, delete: true }, collections: { read: true, delete: true }, pages: { delete: true }, finance: { read: true } });
  });

  it("treats anything that is not an object as an empty matrix", () => {
    expect(normalizeMatrix(null)).toEqual({});
    expect(normalizeMatrix("x")).toEqual({});
    expect(normalizeMatrix([])).toEqual({});
  });

  it("the read-only preset turns on every read toggle and nothing else", () => {
    const m = readOnlyMatrix();
    for (const [resource, row] of Object.entries(AI_CELLS)) {
      expect(isCellAllowed(m, resource as keyof typeof AI_CELLS, "read")).toBe(row.read === "toggle");
      expect(isCellAllowed(m, resource as keyof typeof AI_CELLS, "write")).toBe(false);
      expect(isCellAllowed(m, resource as keyof typeof AI_CELLS, "delete")).toBe(false);
    }
  });

  it("finance can never be written and delete is never permanent", () => {
    expect(AI_CELLS.finance.write).toBe("locked");
    expect(AI_CELLS.finance.delete).toBe("locked");
    expect(isCellAllowed({ finance: { write: true } }, "finance", "write")).toBe(false);
  });

  it("maps each cell to the store permission the approving user must hold", () => {
    expect(storePermissionFor("products", "read")).toBe("products.read");
    expect(storePermissionFor("categories", "write")).toBe("products.write");
    for (const r of ["blog", "pages", "redirects"] as const) for (const a of ["read", "write", "delete"] as const) expect(storePermissionFor(r, a)).toBe("content.write");
    expect(storePermissionFor("products", "delete")).toBe("products.write");
    expect(storePermissionFor("collections", "write")).toBe("products.write");
    expect(storePermissionFor("customers", "read")).toBe("customers.read");
    expect(storePermissionFor("finance", "read")).toBe("finance.read");
    expect(storePermissionFor("analytics", "read")).toBe("analytics.read");
  });
});

describe("OAuth redirect allowlist", () => {
  it("accepts Claude's hosted callback and loopback addresses of any port", () => {
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback")).toBe(true);
    expect(isAllowedRedirectUri("http://localhost:3118/callback")).toBe(true);
    expect(isAllowedRedirectUri("http://127.0.0.1:54321/callback")).toBe(true);
  });

  it("refuses everything else", () => {
    expect(isAllowedRedirectUri("https://evil.example/cb")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai.evil.example/api/mcp/auth_callback")).toBe(false);
    expect(isAllowedRedirectUri("http://claude.ai/api/mcp/auth_callback")).toBe(false);
    expect(isAllowedRedirectUri("https://claude.ai/api/mcp/auth_callback#frag")).toBe(false);
    expect(isAllowedRedirectUri("javascript:alert(1)")).toBe(false);
    expect(isAllowedRedirectUri("not a url")).toBe(false);
  });
});

describe("usage limit helpers", () => {
  it("computes the store-local day and the time left until local midnight", () => {
    // 2026-11-21 20:00 UTC is 01:30 on the 22nd in India (UTC+5:30).
    const d = localDay("Asia/Kolkata", new Date("2026-11-21T20:00:00Z"));
    expect(d.date).toBe("2026-11-22");
    expect(d.secondsLeft).toBe(86400 - (1 * 3600 + 30 * 60));
  });

  it("falls back to India time for an unknown time zone", () => {
    expect(localDay("Mars/Olympus", new Date("2026-11-21T20:00:00Z")).date).toBe("2026-11-22");
  });

  it("writes waits in plain words", () => {
    expect(humanWait(30)).toBe("30 seconds");
    expect(humanWait(600)).toBe("10 minutes");
    expect(humanWait(3 * 3600)).toBe("3 hours");
  });
});
