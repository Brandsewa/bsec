import { describe, expect, it } from "vitest";
import { tenantTag } from "../src/cache-tags.ts";

const T = "0199a000-0000-7000-8000-000000000001";

describe("tenantTag", () => {
  it("prefixes the tenant", () => {
    expect(tenantTag({ tenantId: T }, "product", "p1")).toBe(`t:${T}:product:p1`);
    expect(tenantTag(T, "theme")).toBe(`t:${T}:theme`);
  });
  it("rejects a missing or malformed tenant", () => {
    expect(() => tenantTag("", "nav")).toThrow();
    expect(() => tenantTag("store-1", "nav")).toThrow();
  });
});
