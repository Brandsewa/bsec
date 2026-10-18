/** The elements of the product page's buy-box column, in their default order. The theme can reorder them (ProductDetail.elementOrder). */
export const PRODUCT_ELEMENTS = ["rating", "title", "sku", "description", "options", "price", "actions", "payment", "delivery", "usps", "accordion", "tags"] as const;
export type ProductElement = (typeof PRODUCT_ELEMENTS)[number];
export const PRODUCT_ELEMENT_LABELS: Record<ProductElement, string> = {
  rating: "Review summary",
  title: "Title",
  sku: "SKU",
  description: "Short description",
  options: "Options (size, colour...)",
  price: "Price",
  actions: "Quantity, Add to cart, Buy it now",
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
  for (const name of PRODUCT_ELEMENTS) seen.add(name);
  return [...seen];
}

