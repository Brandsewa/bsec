import { describe, expect, it } from "vitest";
import { AI_CELLS, WRITE_TOOL_NAMES, type AgentSession } from "@bs/domain";
import { ALL_CAPABILITIES, CapabilityError, capabilitiesFor, decodeCursor, encodeCursor, findCapability, refusalFor, serialize, toToolError } from "../src/index.ts";

function session(over: { matrix?: AgentSession["settings"]["matrix"]; allowPublishing?: boolean; permissions?: string[] }): AgentSession {
  return {
    ctx: { tenantId: "t", storeStatus: "live", actor: { type: "agent", userId: "u", connectionId: "c" }, roles: ["store_owner"], permissions: over.permissions ?? ["products.read", "products.write", "orders.read", "customers.read", "analytics.read", "finance.read"], requestId: "r" },
    connection: { id: "c", clientName: "Claude", userId: "u" },
    settings: { matrix: over.matrix ?? {}, allowPublishing: over.allowPublishing ?? false },
    timezone: "Asia/Kolkata",
    currency: "INR",
    storeName: "Test",
  };
}

describe("capability registry", () => {
  it("has unique snake_case names", () => {
    const names = ALL_CAPABILITIES.map((c) => c.name);
    expect(new Set(names).size).toBe(names.length);
    for (const n of names) expect(n).toMatch(/^[a-z][a-z0-9_]*$/);
  });

  it("every capability needs a real toggle cell of the matrix (except the overview)", () => {
    for (const c of ALL_CAPABILITIES) {
      if (c.name === "get_store_overview") {
        expect(c.resource).toBeNull();
        continue;
      }
      expect(c.resource, c.name).not.toBeNull();
      expect(AI_CELLS[c.resource!][c.action!], c.name).toBe("toggle");
    }
  });

  it("the usage meter counts exactly the write capabilities", () => {
    const writes = ALL_CAPABILITIES.filter((c) => c.kind === "write").map((c) => c.name).sort();
    expect(writes).toEqual([...WRITE_TOOL_NAMES].sort());
  });

  it("annotations tell the truth: reads are read-only, writes are not", () => {
    for (const c of ALL_CAPABILITIES) {
      if (c.action === "read" || c.resource === null) expect(c.annotations.readOnly, c.name).toBe(true);
      else expect(c.annotations.readOnly, c.name).toBe(false);
    }
    expect(findCapability("archive_product")?.annotations.destructive).toBe(true);
  });

  it("finance capabilities are read only and nothing can write finance, customers or analytics", () => {
    for (const c of ALL_CAPABILITIES) {
      if (c.resource === "finance" || c.resource === "customers" || c.resource === "analytics") expect(c.action, c.name).toBe("read");
    }
  });

  it("no capability sends anything outward or fetches a URL (v1 rule)", () => {
    for (const c of ALL_CAPABILITIES) expect(c.name).not.toMatch(/send|email|sms|fetch|url|webhook/);
  });
});

describe("policy", () => {
  it("offers nothing but the overview when the matrix is empty", () => {
    expect(capabilitiesFor(session({})).map((c) => c.name)).toEqual(["get_store_overview"]);
  });

  it("offers a capability only when the matrix allows it AND the approving user still holds the permission", () => {
    const s = session({ matrix: { products: { read: true, write: true } }, permissions: ["products.read"] });
    const names = capabilitiesFor(s).map((c) => c.name);
    expect(names).toContain("list_products");
    expect(names).not.toContain("create_product"); // the user lost products.write
    expect(refusalFor(s, findCapability("create_product")!)).toMatch(/does not have permission/);
    expect(refusalFor(session({}), findCapability("list_products")!)).toMatch(/has not allowed AI apps to read products/);
  });

  it("finance read needs the user to hold finance.read, whatever the matrix says", () => {
    const s = session({ matrix: { finance: { read: true } }, permissions: ["products.read"] });
    expect(refusalFor(s, findCapability("get_finance_summary")!)).toMatch(/does not have permission/);
  });

  it("publishing needs its own switch on top of write", () => {
    const m = { products: { read: true, write: true } };
    expect(refusalFor(session({ matrix: m }), findCapability("publish_product")!)).toMatch(/publish/);
    expect(refusalFor(session({ matrix: m, allowPublishing: true }), findCapability("publish_product")!)).toBeNull();
    expect(refusalFor(session({ matrix: m }), findCapability("unpublish_product")!)).toBeNull();
  });

  it("customer contact details are controlled by the customers cell alone", () => {
    expect(refusalFor(session({ matrix: { orders: { read: true } } }), findCapability("list_customers")!)).toMatch(/customers/);
  });
});

describe("output shaping and errors", () => {
  it("replaces an oversized result with a short instruction to narrow the request", () => {
    const big = { items: Array.from({ length: 2000 }, (_, i) => ({ id: i, title: "x".repeat(40) })) };
    const out = serialize(big);
    expect(out.truncated).toBe(true);
    expect(JSON.parse(out.text).message).toMatch(/too large/);
    expect(serialize({ a: 1 }).truncated).toBe(false);
  });

  it("drops null and empty fields", () => {
    expect(JSON.parse(serialize({ a: 1, b: null, c: "", d: { e: null, f: 2 } }).text)).toEqual({ a: 1, d: { f: 2 } });
  });

  it("cursors round-trip and reject garbage", () => {
    expect(decodeCursor(encodeCursor(40))).toBe(40);
    expect(decodeCursor("garbage")).toBe(0);
    expect(decodeCursor(undefined)).toBe(0);
  });

  it("maps domain errors to stable codes and never leaks internals", () => {
    expect(toToolError(new Error("Forbidden: nope")).code).toBe("forbidden");
    expect(toToolError(new Error("Not Found: Product")).code).toBe("not_found");
    expect(toToolError(new Error('Product not found: "x"')).code).toBe("not_found");
    expect(toToolError(new CapabilityError("conflict", "taken")).code).toBe("conflict");
    const leaked = toToolError(new Error('insert into "products" violates constraint products_pkey'));
    expect(leaked.code).toBe("error");
    expect(leaked.message).not.toMatch(/insert|constraint/i);
  });
});
