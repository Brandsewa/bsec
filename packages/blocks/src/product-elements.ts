/** The elements of the product page's buy-box column, in their default order. The theme can reorder them (ProductDetail.elementOrder). */
export const PRODUCT_ELEMENTS = ["rating", "title", "sku", "description", "options", "price", "actions", "coupons", "payment", "delivery", "usps", "accordion", "tags"] as const;
export type ProductElement = (typeof PRODUCT_ELEMENTS)[number];
export const PRODUCT_ELEMENT_LABELS: Record<ProductElement, string> = {
  rating: "Review summary",
  title: "Title",
  sku: "SKU",
  description: "Short description",
  options: "Options (size, colour...)",
  price: "Price",
  actions: "Quantity, Add to cart, Buy it now",
  coupons: "Coupon cards",
  payment: "Secure payment picture",
  delivery: "Delivery estimate",
  usps: "Highlight cards",
  accordion: "Accordion (details)",
  tags: "Tags",
};

/** A saved order may miss newer elements or repeat one: unknown names are dropped, repeats ignored, missing ones follow in the default order. */
export function normalizeElementOrder(order: readonly string[] | undefined): ProductElement[] {
  const seen = new Set<ProductElement>();
  for (const name of order ?? []) {
    if ((PRODUCT_ELEMENTS as readonly string[]).includes(name)) seen.add(name as ProductElement);
  }
  // An order saved before coupons existed gets them right under the Add to cart row.
  if (!seen.has("coupons") && seen.has("actions")) {
    const out: ProductElement[] = [];
    for (const name of seen) {
      out.push(name);
      if (name === "actions") out.push("coupons");
    }
    seen.clear();
    for (const name of out) seen.add(name);
  }
  for (const name of PRODUCT_ELEMENTS) seen.add(name);
  return [...seen];
}

