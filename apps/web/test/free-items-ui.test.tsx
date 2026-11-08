import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString as render } from "react-dom/server";

// React inserts comment markers between adjacent text nodes; assert on the text a shopper reads
const renderToString = (el: React.ReactElement) => render(el).replace(/<!-- -->/g, "");

vi.mock("server-only", () => ({}));
process.env.DATABASE_URL_RW = process.env.DATABASE_URL_RW ?? "postgres://x:y@127.0.0.1:1/none";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/cart",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

import { FreeItemsCard, freeItemsOf } from "../src/components/cart/FreeItemsCard.tsx";
import { OrderSummary } from "../src/components/checkout/OrderSummary.tsx";
import { CartView } from "../src/components/cart/CartView.tsx";
import { ProductOfferBar } from "../src/components/product/ProductOfferBar.tsx";
import type { StorefrontCart, StorefrontCartItem } from "@bs/domain";

const item = (over: Partial<StorefrontCartItem> = {}): StorefrontCartItem => ({
  id: "item-1",
  cartId: "cart-1",
  variantId: "var-1",
  quantity: 3,
  autoFreeQty: 1,
  unitPriceSnapshot: 18000,
  lineTotal: 54000,
  properties: null,
  product: { id: "p1", title: "Dalle with Mutter/Mula", slug: "dalle" },
  variant: { id: "var-1", sku: "D-1", title: "200g", optionValues: null, price: 18000 },
  primaryImage: { mediaId: "m1", alt: "Dalle", kind: "image", url: "https://cdn.example/dalle.jpg" },
  createdAt: "2026-11-08T00:00:00.000Z",
  updatedAt: "2026-11-08T00:00:00.000Z",
  ...over,
});

const offer = { discountId: "d-1", code: "Buy 2 get 1", title: "Buy 2 Get 1 Free", type: "buy_x_get_y", amount: 18000, freeShipping: false, automatic: true, discountClass: "product" as const, lineAmounts: { "item-1": 18000 } };

const unlocked: StorefrontCart = {
  id: "cart-1",
  token: "tok",
  currency: "INR",
  items: [item()],
  itemCount: 3,
  subtotal: 54000,
  discount: offer,
  discounts: [offer],
  discountNotice: null,
  lastActivityAt: "2026-11-08T00:00:00.000Z",
  createdAt: "2026-11-08T00:00:00.000Z",
} as unknown as StorefrontCart;

const plain: StorefrontCart = { ...unlocked, items: [item({ quantity: 2, autoFreeQty: 0, lineTotal: 36000 })], itemCount: 2, subtotal: 36000, discount: null, discounts: [] };

describe("the free item card", () => {
  it("finds the free items with what they save and the offer that gave them", () => {
    expect(freeItemsOf(unlocked)).toEqual([expect.objectContaining({ free: 1, saved: 18000, offer: "Buy 2 Get 1 Free" })]);
    expect(freeItemsOf(plain)).toEqual([]);
  });

  it("says the offer is unlocked and shows the picture, FREE, the crossed-out price and the saving", () => {
    const html = renderToString(React.createElement(FreeItemsCard, { cart: unlocked }));
    expect(html).toContain("Offer unlocked: Buy 2 Get 1 Free");
    expect(html).toContain("Dalle with Mutter/Mula");
    expect(html).toContain("https://cdn.example/dalle.jpg");
    expect(html).toContain("FREE");
    expect(html).toContain("line-through");
    expect(html).toContain("₹180");
    expect(html).toContain("added free with your offer");
  });

  it("is not drawn when nothing is free", () => {
    expect(renderToString(React.createElement(FreeItemsCard, { cart: plain }))).toBe("");
  });
});

describe("where the free item shows", () => {
  it("on the cart page above everything else, and not for a plain cart", () => {
    expect(renderToString(React.createElement(CartView, { cart: unlocked }))).toContain("free-items-card");
    expect(renderToString(React.createElement(CartView, { cart: plain }))).not.toContain("free-items-card");
  });

  it("at checkout in the summary, and on the item row", () => {
    const html = renderToString(React.createElement(OrderSummary, { cart: unlocked, shippingPaise: 0 }));
    expect(html).toContain("Offer unlocked");
    expect(html).toContain("1 free with your offer");
    expect(renderToString(React.createElement(OrderSummary, { cart: plain, shippingPaise: 0 }))).not.toContain("free with your offer");
  });
});

describe("the promotion bar on the product page", () => {
  it("shows each offer's headline and that the free item is added by itself", () => {
    const html = renderToString(
      React.createElement(ProductOfferBar, {
        offers: [
          { id: "o1", name: "Test", headline: "Buy 2 Get 1 Free", autoAdd: true },
          { id: "o2", name: "Gift", headline: "Spend ₹2,000, get Dalle free", autoAdd: false },
        ],
      }),
    );
    expect(html).toContain("Buy 2 Get 1 Free");
    expect(html).toContain("Spend ₹2,000, get Dalle free");
    expect(html.match(/added to your cart automatically/g)).toHaveLength(1);
  });

  it("draws nothing when the product has no offer", () => {
    expect(renderToString(React.createElement(ProductOfferBar, { offers: [] }))).toBe("");
  });
});
