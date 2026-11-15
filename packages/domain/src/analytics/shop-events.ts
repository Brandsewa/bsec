import { toMajorUnits } from "@bs/contracts/money";

/**
 * Shop events for the optional GA4 and Meta Pixel integrations (docs/ANALYTICS-PLAN.md slice 5, ADR-047).
 *
 * The server renders these as small JSON blobs (`<script type="application/json" data-bs-ev>`); `bsc.js` reads them and sends them
 * to the tools the visitor accepted. Amounts are in major units (what a shopper sees) because GA4 and Meta expect that; stored
 * amounts are minor units. No customer details are included: ids, titles, prices, quantities and totals only.
 */

export interface ShopItem {
  /** SKU when the variant has one, otherwise the variant id, so the same product has the same id in every event. */
  id: string;
  name: string;
  variant?: string | undefined;
  price: number;
  quantity: number;
}

export type ShopEvent =
  | { t: "view_item"; currency: string; value: number; items: ShopItem[] }
  | { t: "begin_checkout"; currency: string; value: number; items: ShopItem[]; eventId?: string | undefined }
  | { t: "purchase"; currency: string; value: number; orderId: string; shipping: number; items: ShopItem[] };

interface VariantLike {
  id: string;
  sku?: string | null | undefined;
  title?: string | null | undefined;
}

const itemId = (v: VariantLike): string => (v.sku && v.sku.trim() ? v.sku.trim() : v.id);
const PLACEHOLDER_VARIANT = new Set(["default", "default title"]);
const variantName = (title: string | null | undefined): string | undefined =>
  title && title.trim() && !PLACEHOLDER_VARIANT.has(title.trim().toLowerCase()) ? title.trim().slice(0, 100) : undefined;
const money = (minor: number, currency: string): number => toMajorUnits(minor, currency);

/** The product page: the lowest-priced variant stands for the product, as in the page's structured data. */
export function buildViewItemEvent(
  product: { title: string; priceOnRequest?: boolean | undefined; variants: Array<VariantLike & { price: number }> },
  currency: string,
): ShopEvent | null {
  if (product.priceOnRequest || product.variants.length === 0) return null;
  const v = [...product.variants].sort((a, b) => a.price - b.price)[0];
  if (!v) return null;
  const price = money(v.price, currency);
  return { t: "view_item", currency, value: price, items: [{ id: itemId(v), name: product.title.slice(0, 150), variant: variantName(v.title), price, quantity: 1 }] };
}

interface CartLike {
  currency: string;
  items: Array<{ quantity: number; unitPriceSnapshot: number; product: { title: string }; variant: VariantLike }>;
}

/** Checkout started: the cart as it stands. */
export function buildBeginCheckoutEvent(cart: CartLike): ShopEvent | null {
  if (cart.items.length === 0) return null;
  const items = cart.items.map((i) => ({
    id: itemId(i.variant),
    name: i.product.title.slice(0, 150),
    variant: variantName(i.variant.title),
    price: money(i.unitPriceSnapshot, cart.currency),
    quantity: i.quantity,
  }));
  const value = Math.round(items.reduce((s, i) => s + i.price * i.quantity, 0) * 100) / 100;
  return { t: "begin_checkout", currency: cart.currency, value, items };
}

interface OrderLike {
  number: string;
  status: string;
  currency: string;
  grandTotal: number;
  shippingTotal: number;
  items: Array<{ variantId: string; sku: string | null; productTitle: string; variantTitle: string | null; quantity: number; unitPrice: number }>;
}

/** The thank-you page. Cancelled orders are not purchases. `orderId` is the order number, which is unique within the store. */
export function buildPurchaseEvent(order: OrderLike): ShopEvent | null {
  if (order.status === "cancelled" || order.items.length === 0) return null;
  return {
    t: "purchase",
    currency: order.currency,
    value: money(order.grandTotal, order.currency),
    orderId: order.number,
    shipping: money(order.shippingTotal, order.currency),
    items: order.items.map((i) => ({
      id: itemId({ id: i.variantId, sku: i.sku }),
      name: i.productTitle.slice(0, 150),
      variant: variantName(i.variantTitle),
      price: money(i.unitPrice, order.currency),
      quantity: i.quantity,
    })),
  };
}

/** JSON for a script tag. `<` is escaped so merchant-controlled titles can never close the tag. */
export function serializeShopEvent(event: ShopEvent): string {
  return JSON.stringify(event).replace(/</g, "\\u003c");
}
