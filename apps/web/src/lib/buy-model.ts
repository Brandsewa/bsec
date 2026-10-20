import type { StorefrontProductDetail, StorefrontVariant } from "@bs/domain";

type BuyOptions = NonNullable<StorefrontProductDetail["options"]>;

/**
 * What the picker offers: the option list and the variants it chooses between.
 * - A product normally carries its option definitions; one with variants that have option values but no definitions
 *   (imported or edited by hand) gets its options worked out from the variants. With a single variant, or when every
 *   option has one value, there is nothing to choose.
 * - If the options cannot reach every variant (a variant added later without a value for an option, a value that is not in
 *   the option's list, a variant with no values next to ones that have them), shoppers would never be able to pick it. The
 *   picker then offers one "Variant" choice listing each variant by its own title, so every variant can be bought.
 */
export function buyModel(product: StorefrontProductDetail): { options: BuyOptions; variants: StorefrontVariant[] } {
  const variants = product.variants ?? [];
  const defined = product.options ?? [];

  const byName = new Map<string, string[]>();
  for (const v of variants) {
    for (const [name, value] of Object.entries((v.optionValues as Record<string, string> | null) ?? {})) {
      const values = byName.get(name) ?? [];
      if (!values.includes(value)) values.push(value);
      byName.set(name, values);
    }
  }
  const derived: BuyOptions = [...byName.entries()].map(([name, values], position) => ({ id: `derived-${name}`, productId: product.id, name, position, values }));
  const options: BuyOptions = defined.length > 0 ? defined : derived.some((o) => o.values.length > 1) ? derived : [];

  const reaches = (v: StorefrontVariant) =>
    options.length > 0 &&
    options.every((o) => {
      const value = (v.optionValues as Record<string, string> | null)?.[o.name];
      return typeof value === "string" && o.values.includes(value);
    });

  if (variants.length >= 2 && (options.length === 0 || !variants.every(reaches))) {
    const seen = new Map<string, number>();
    const titled = variants.map((v) => {
      const base = v.title?.trim() || v.sku;
      const n = (seen.get(base) ?? 0) + 1;
      seen.set(base, n);
      return { ...v, optionValues: { Variant: n > 1 ? `${base} (${n})` : base } };
    });
    return {
      options: [{ id: "derived-variant", productId: product.id, name: "Variant", position: 0, values: titled.map((v) => (v.optionValues as Record<string, string>)["Variant"] as string) }],
      variants: titled,
    };
  }
  return { options, variants };
}

