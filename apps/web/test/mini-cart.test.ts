import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

vi.mock("server-only", () => ({}));

import { DEFAULT_PAGES, resolveDefaultPages, validateDefaultPages } from "@bs/blocks";
import { MiniCartDrawer } from "../src/components/storefront/MiniCartDrawer.tsx";
import { FALLBACK_MINI_CART, MiniCartConfigProvider } from "../src/components/storefront/MiniCartConfig.tsx";
import type { StorefrontCart } from "@bs/domain";

const cart = {
  id: "c1",
  token: "t",
  currency: "INR",
  itemCount: 2,
  subtotal: 90000,
  items: [
    {
      id: "i1",
      cartId: "c1",
      variantId: "v1",
      quantity: 2,
      unitPriceSnapshot: 45000,
      lineTotal: 90000,
      properties: null,
      product: { id: "p1", title: "Orange Marmalade", slug: "orange-marmalade" },
      variant: { id: "v1", sku: "OM-1", title: "100g", optionValues: null, price: 45000 },
      primaryImage: null,
      createdAt: "",
      updatedAt: "",
    },
  ],
  lastActivityAt: "",
  createdAt: "",
} as unknown as StorefrontCart;

const drawer = (threshold: number | null) => React.createElement(MiniCartDrawer, { open: true, onClose: () => {}, cart, onCartChange: () => {}, freeShippingThresholdPaise: threshold });

describe("mini cart", () => {
  it("shows the items, the free-shipping progress, the total, both buttons and the reassurance row", () => {
    const html = render(drawer(299900));
    expect(html).toContain("Your Cart");
    expect(html).toMatch(/data-testid="mini-cart-count">2</); // the count sits in a dark circle
    expect(html).toContain("Orange Marmalade");
    expect(html).toContain("100g");
    expect(html).toContain("Add ₹2,099 more for free shipping"); // 2999 - 900
    expect(html).toContain('aria-valuenow="30"');
    expect(html).toContain("₹900");
    expect(html).toContain("Proceed to Checkout");
    expect(html).toContain("Continue Shopping");
    expect(html).toContain("100% Secure Payments");
    expect(html).not.toContain("View cart"); // the page link is gone from the drawer
  });

  it("says free shipping is unlocked once the threshold is reached, and hides the bar when the store has no free-shipping amount", () => {
    expect(render(drawer(50000))).toContain("You have unlocked free shipping");
    expect(render(drawer(null))).not.toContain("mini-cart-shipping-bar");
  });

  it("uses the theme's wording and can drop the bar, the small print and the reassurance row", () => {
    const html = render(
      React.createElement(
        MiniCartConfigProvider,
        { copy: { ...FALLBACK_MINI_CART, heading: "Your Bag", checkoutLabel: "Pay now", showFreeShippingBar: false, totalNote: "", showTrustRow: false } },
        drawer(299900),
      ),
    );
    expect(html).toContain("Your Bag");
    expect(html).toMatch(/data-testid="mini-cart-count">2</);
    expect(html).toContain("Pay now");
    expect(html).not.toContain("mini-cart-shipping-bar");
    expect(html).not.toContain("Taxes and shipping calculated");
    expect(html).not.toContain("mini-cart-trust");
  });

  it("renders nothing while closed", () => {
    expect(render(React.createElement(MiniCartDrawer, { open: false, onClose: () => {}, cart, onCartChange: () => {}, freeShippingThresholdPaise: null }))).toBe("");
  });
});

describe("mini cart settings", () => {
  it("the browser's built-in fallback equals the shared default", () => {
    expect(FALLBACK_MINI_CART).toEqual(DEFAULT_PAGES.miniCart);
  });

  it("merges a theme's partial settings, keeps at most four reassurance items and rejects HTML or unknown icons", () => {
    expect(resolveDefaultPages({ miniCart: { heading: "Bag" } }).miniCart).toEqual({ ...DEFAULT_PAGES.miniCart, heading: "Bag" });
    const item = (icon: string, text: string) => ({ icon, text });
    expect(validateDefaultPages({ miniCart: { trustItems: [item("check", "A"), item("star", "B")] } }).miniCart.trustItems).toHaveLength(2);
    expect(() => validateDefaultPages({ miniCart: { trustItems: Array.from({ length: 5 }, () => item("check", "x")) } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ miniCart: { trustItems: [item("rocket", "x")] } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ miniCart: { trustItems: [item("check", "<b>x</b>")] } })).toThrow(/Default pages/);
    expect(() => validateDefaultPages({ miniCart: { totalNote: "<script>" } })).toThrow(/Default pages/);
  });
});
