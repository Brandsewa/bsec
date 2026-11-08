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

import { cartRows } from "../src/components/cart/cart-rows.ts";
import { FreeItemsCard } from "../src/components/cart/FreeItemsCard.tsx";
import { OrderSummary } from "../src/components/checkout/OrderSummary.tsx";
import { CartView } from "../src/components/cart/CartView.tsx";
import { CouponCards } from "../src/components/product/CouponCards.tsx";
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

describe("the cart shown as lines", () => {
  it("splits a line with free units into the shopper's own quantity and, right under it, the free units", () => {
    const rows = cartRows(unlocked);
    expect(rows.map((r) => [r.free, r.qty])).toEqual([[false, 2], [true, 1]]);
    expect(rows[1]).toMatchObject({ saved: 18000, offer: "Buy 2 Get 1 Free" });
    expect(cartRows(plain).map((r) => [r.free, r.qty])).toEqual([[false, 2]]);
  });

  it("a line that is only free units (a gift) is one free row", () => {
    const gift = { ...unlocked, items: [item({ quantity: 1, autoFreeQty: 1 })] };
    expect(cartRows(gift).map((r) => [r.free, r.qty])).toEqual([[true, 1]]);
  });
});

describe("the cart page", () => {
  const html = renderToString(React.createElement(CartView, { cart: unlocked, freeShippingThresholdPaise: 99900, options: { showFreeShippingBar: true } as never }));

  it("shows price x quantity for the paid line and the free line below it, not a card above", () => {
    expect(html).toContain("₹180 × 2");
    expect(html).toContain("₹0 × 1");
    expect(html).toContain("Offer unlocked: Buy 2 Get 1 Free");
    expect(html).toContain("save ₹180");
    expect(html.indexOf("₹180 × 2")).toBeLessThan(html.indexOf("free-item-row"));
    expect(html).not.toContain("free-items-card");
  });

  it("puts the free-shipping progress in the order summary column", () => {
    expect(html.indexOf("free-shipping-bar")).toBeGreaterThan(html.indexOf("free-item-row"));
    expect(html.indexOf("free-shipping-bar")).toBeLessThan(html.indexOf("Order Summary"));
  });

  it("has no shipping estimator and no trust lines", () => {
    expect(html).not.toContain("Estimate Shipping");
    expect(html).not.toContain("Cash on delivery");
    expect(html).not.toContain("Easy returns");
  });
});

describe("checkout", () => {
  const html = renderToString(React.createElement(OrderSummary, { cart: unlocked, shippingPaise: 0 }));

  it("shows each line with its weight and quantity, and the free line below the item, with a small saving badge", () => {
    expect(html).toContain("200g × 2");
    expect(html).toContain("200g × 1");
    expect(html).toContain("Offer unlocked");
    expect(html).toContain("save ₹180");
    expect(html).toContain("FREE");
    expect(html.indexOf("200g × 2")).toBeLessThan(html.indexOf("200g × 1"));
    expect(html).not.toContain("free-items-card");
  });

  it("shows nothing about an offer for a plain cart", () => {
    expect(renderToString(React.createElement(OrderSummary, { cart: plain, shippingPaise: 0 }))).not.toContain("Offer unlocked");
  });
});

describe("the unlocked card on the product page", () => {
  it("shows the picture, FREE, the crossed-out price and the saving", () => {
    const card = renderToString(React.createElement(FreeItemsCard, { cart: unlocked }));
    expect(card).toContain("Offer unlocked: Buy 2 Get 1 Free");
    expect(card).toContain("https://cdn.example/dalle.jpg");
    expect(card).toContain("line-through");
    expect(card).toContain("save ₹180");
    expect(renderToString(React.createElement(FreeItemsCard, { cart: plain }))).toBe("");
  });
});

describe("offers as coupon cards", () => {
  const cards = [
    { code: "", title: "Buy 2 Dalle get 1 free", benefit: "Buy 2 Get 1 Free", condition: "Free item is added to your cart", endsAt: null, automatic: true, appliesHere: true },
    { code: "TEN", title: "10% off", benefit: "10% off", condition: "", endsAt: null },
  ];
  it("an automatic offer is a card that says it applies by itself, with no code or copy button", () => {
    const html = renderToString(React.createElement(CouponCards, { coupons: cards, title: "Available offers", showCount: 2, showViewAll: true, viewAllLabel: "View all" }));
    expect(html).toContain("Buy 2 Get 1 Free");
    expect(html).toContain("Applied automatically");
    expect(html).toContain("TEN");
  });
});
