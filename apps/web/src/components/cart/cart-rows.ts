import type { StorefrontCart, StorefrontCartItem } from "@bs/domain";

/** One line of the cart as the shopper reads it: what they chose, or the free copy the store added for an offer. */
export interface CartRow {
  key: string;
  item: StorefrontCartItem;
  /** The free units of an offer (price 0), shown as their own line below the item the shopper chose. */
  free: boolean;
  qty: number;
  /** For a free row: what it saves (the normal price of those units). */
  saved: number;
  /** For a free row: the offer's name. */
  offer: string | null;
}

/** "200g" for a variant, nothing for a product with only one. */
export const weightLabel = (item: StorefrontCartItem): string | null => (item.variant.title && item.variant.title !== "Default" ? item.variant.title : null);

/**
 * The cart's lines for display. A cart line the store added free units to is shown as two: the shopper's own quantity at the
 * normal price, and right under it the free units at 0, so "2 + 1 free" is plain to read and the paid lines add up to the total.
 */
export function cartRows(cart: StorefrontCart): CartRow[] {
  return cart.items.flatMap((item) => {
    const free = Math.min(item.autoFreeQty ?? 0, item.quantity);
    const rows: CartRow[] = [];
    if (item.quantity - free > 0) rows.push({ key: item.id, item, free: false, qty: item.quantity - free, saved: 0, offer: null });
    if (free > 0) {
      const applied = (cart.discounts ?? []).filter((d) => d.discountClass === "product" && (d.lineAmounts?.[item.id] ?? 0) > 0);
      const saved = applied.reduce((sum, d) => sum + (d.lineAmounts?.[item.id] ?? 0), 0);
      rows.push({ key: `${item.id}:free`, item, free: true, qty: free, saved: saved || item.unitPriceSnapshot * free, offer: applied[0]?.title ?? null });
    }
    return rows;
  });
}
