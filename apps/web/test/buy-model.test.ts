import { describe, expect, it } from "vitest";
import type { StorefrontProductDetail, StorefrontVariant } from "@bs/domain";
import { buyModel } from "../src/lib/buy-model.ts";

const variant = (id: string, title: string, optionValues: Record<string, string> | null): StorefrontVariant =>
  ({ id, productId: "p", sku: `SKU-${id}`, barcode: null, title, optionValues, price: 100, trackInventory: false, allowBackorder: false, position: 0, imageMediaId: null, stockStatus: "in_stock", createdAt: "", updatedAt: "" }) as StorefrontVariant;

const product = (variants: StorefrontVariant[], options: Array<{ name: string; values: string[] }> = []) =>
  ({ id: "p", variants, options: options.map((o, i) => ({ id: `o${i}`, productId: "p", position: i, ...o })) }) as unknown as StorefrontProductDetail;

describe("buyModel (which options the product page offers)", () => {
  it("keeps defined options when every variant is reachable", () => {
    const m = buyModel(product([variant("1", "S", { Size: "S" }), variant("2", "M", { Size: "M" })], [{ name: "Size", values: ["S", "M"] }]));
    expect(m.options.map((o) => o.name)).toEqual(["Size"]);
    expect(m.variants[0]?.optionValues).toEqual({ Size: "S" });
  });

  it("works options out from the variants when none are defined", () => {
    const m = buyModel(product([variant("1", "S", { Size: "S" }), variant("2", "M", { Size: "M" })]));
    expect(m.options).toHaveLength(1);
    expect(m.options[0]?.values).toEqual(["S", "M"]);
  });

  it("offers a plain Variant choice when a variant was added later without option values", () => {
    const m = buyModel(product([variant("1", "Default", null), variant("2", "Large", { Size: "L" })]));
    expect(m.options.map((o) => o.name)).toEqual(["Variant"]);
    expect(m.options[0]?.values).toEqual(["Default", "Large"]);
    expect(m.variants.map((v) => v.id)).toEqual(["1", "2"]);
  });

  it("offers it too when a new variant's value is not in the option's list", () => {
    const m = buyModel(product([variant("1", "S", { Size: "S" }), variant("2", "XL", { Size: "XL" })], [{ name: "Size", values: ["S"] }]));
    expect(m.options[0]?.name).toBe("Variant");
    expect(m.options[0]?.values).toEqual(["S", "XL"]);
  });

  it("shows no picker for a single variant", () => {
    expect(buyModel(product([variant("1", "Default", null)])).options).toEqual([]);
  });
});
