import { describe, expect, it } from "vitest";
import { defaultDraftVariant, regenerateVariants, usableOptions } from "../src/components/product/draft-variant-builder.tsx";

describe("draft variants on a product that is not saved yet", () => {
  it("starts with one default row and keeps it while no option is complete", () => {
    const start = [{ ...defaultDraftVariant(), sku: "SKU-1", price: "499" }];
    expect(regenerateVariants([], start)).toEqual(start);
    // A name without values makes no variants yet.
    expect(regenerateVariants([{ name: "Size", values: [] }], start)).toEqual(start);
    expect(usableOptions([{ name: "Size", values: [] }, { name: "Colour", values: ["Red"] }])).toEqual([{ name: "Colour", values: ["Red"] }]);
  });

  it("turns option values into variant rows straight away, in order", () => {
    const rows = regenerateVariants(
      [
        { name: "Size", values: ["S", "M"] },
        { name: "Colour", values: ["Red", "Blue"] },
      ],
      [defaultDraftVariant()],
    );
    expect(rows.map((r) => r.title)).toEqual(["S / Red", "S / Blue", "M / Red", "M / Blue"]);
    expect(rows[0]?.optionValues).toEqual({ Size: "S", Colour: "Red" });
  });

  it("lets the first combination inherit what was typed on the default row", () => {
    const typed = [{ ...defaultDraftVariant(), sku: "JKT-1", price: "1599", compareAtPrice: "1999" }];
    const rows = regenerateVariants([{ name: "Size", values: ["S", "M"] }], typed);
    expect(rows[0]).toMatchObject({ title: "S", sku: "JKT-1", price: "1599", compareAtPrice: "1999" });
    expect(rows[1]).toMatchObject({ title: "M", sku: "", price: "" });
  });

  it("keeps SKUs and prices for combinations that still exist when a value is added or removed", () => {
    const first = regenerateVariants([{ name: "Size", values: ["S", "M"] }], [defaultDraftVariant()]);
    const typed = first.map((r) => ({ ...r, sku: `SKU-${r.title}`, price: r.title === "S" ? "100" : "200" }));
    const added = regenerateVariants([{ name: "Size", values: ["S", "M", "L"] }], typed);
    expect(added.map((r) => [r.title, r.sku, r.price])).toEqual([
      ["S", "SKU-S", "100"],
      ["M", "SKU-M", "200"],
      ["L", "", ""],
    ]);
    const removed = regenerateVariants([{ name: "Size", values: ["M"] }], added);
    expect(removed.map((r) => [r.title, r.sku])).toEqual([["M", "SKU-M"]]);
  });

  it("falls back to a single default row when every option is removed", () => {
    const rows = regenerateVariants([{ name: "Size", values: ["S"] }], [defaultDraftVariant()]);
    const back = regenerateVariants([], rows.map((r) => ({ ...r, sku: "KEEP", price: "50" })));
    expect(back).toHaveLength(1);
    expect(back[0]).toMatchObject({ title: "Default", optionValues: {}, sku: "KEEP", price: "50" });
  });
});
