import { describe, expect, it } from "vitest";
import { defaultFooterMenuItems, defaultHeaderMenuItems, normalizeMenuItems } from "../src/menu-defaults.ts";

describe("normalizeMenuItems", () => {
  it("adds missing ids and types, keeps existing ones, and repairs children", () => {
    const out = normalizeMenuItems([
      { title: "Home", url: "/" },
      { id: "keep-me", title: "Shop", url: "/collections/all", type: "collection", children: [{ title: "Tea", url: "/collections/tea" }] },
    ]) as Array<{ id: string; type: string; children?: Array<{ id: string; type: string }> }>;

    expect(out[0]?.id).toMatch(/[0-9a-f-]{36}/);
    expect(out[0]?.type).toBe("url");
    expect(out[1]?.id).toBe("keep-me");
    expect(out[1]?.type).toBe("collection");
    expect(out[1]?.children?.[0]?.id).toBeTruthy();
    expect(out[1]?.children?.[0]?.type).toBe("url");
  });

  it("turns an unknown type into url and skips non-objects without throwing", () => {
    const out = normalizeMenuItems([null, 7, "x", { id: "a", title: "A", url: "/a", type: "javascript" }]) as Array<{ type: string }>;
    expect(out).toHaveLength(1);
    expect(out[0]?.type).toBe("url");
  });

  it("returns an empty list for non-array input", () => {
    expect(normalizeMenuItems(undefined)).toEqual([]);
    expect(normalizeMenuItems({})).toEqual([]);
  });

  it("starter menus carry an id and a type on every item", () => {
    for (const it of [...defaultHeaderMenuItems(), ...defaultFooterMenuItems()]) {
      expect(it.id).toBeTruthy();
      expect(it.type).toBeTruthy();
    }
  });
});
