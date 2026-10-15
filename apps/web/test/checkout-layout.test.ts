import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup as render } from "react-dom/server";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {}, push: () => {}, replace: () => {} }) }));

import { CheckoutContainer } from "../src/components/checkout/CheckoutContainer.tsx";
import type { StorefrontCart } from "@bs/domain";

const cart = {
  id: "c1",
  token: "t",
  currency: "INR",
  itemCount: 1,
  subtotal: 100000,
  items: [
    {
      id: "i1",
      cartId: "c1",
      variantId: "v1",
      quantity: 1,
      unitPriceSnapshot: 100000,
      lineTotal: 100000,
      properties: null,
      product: { id: "p1", title: "Marmalade", slug: "marmalade" },
      variant: { id: "v1", sku: "M-1", title: "100g", optionValues: null, price: 100000 },
      primaryImage: null,
    },
  ],
} as unknown as StorefrontCart;

const html = render(
  React.createElement(CheckoutContainer, {
    cart,
    shippingRates: [{ method: "standard", title: "Standard", description: "3 to 4 days", estimatedDays: "3-4", amount: 5000 }],
    paymentOptions: { codEnabled: true, codFeePaise: 5000, onlineAvailable: false },
    consent: { showTerms: false, showMarketing: false } as never,
  }),
);

describe("checkout layout", () => {
  it("puts the order summary first on phones, collapsed behind a bar that shows the total, and beside the form on desktop", () => {
    expect(html.indexOf("Show order summary")).toBeGreaterThan(-1);
    expect(html.indexOf("Show order summary")).toBeLessThan(html.indexOf("Contact Information"));
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("₹1,100"); // 1000 + 50 shipping + 50 cash on delivery fee, in the bar
    expect(html).toContain("hidden lg:mt-0 lg:block"); // the panel is hidden on phones until opened
    expect(html).toContain("lg:order-2");
  });

  it("has no card borders around the form sections and a soft grey summary panel without a border", () => {
    expect(html).not.toMatch(/<section class="[^"]*border/);
    expect(html).toContain("bg-muted/60");
    expect(html).not.toContain("rounded-2xl border border-border");
    expect(html).not.toContain("shadow-sm");
  });

  it("offers a guest a Login link and Create an account, and a signed-in shopper neither", () => {
    expect(html).toContain('href="/account/login"');
    expect(html).toContain("Create an account");
    const signedIn = render(
      React.createElement(CheckoutContainer, {
        cart,
        shippingRates: [{ method: "standard", title: "Standard", description: "3 to 4 days", estimatedDays: "3-4", amount: 5000 }],
        paymentOptions: { codEnabled: true, codFeePaise: 5000, onlineAvailable: false },
        consent: { showTerms: false, showMarketing: false } as never,
        signedIn: true,
      }),
    );
    expect(signedIn).not.toContain('href="/account/login"');
    expect(signedIn).not.toContain("Create an account");
  });

  it("starts a signed-in shopper on their default saved address, with edit, choose-another and manage links", () => {
    const addr = (id: string, name: string, isDefault: boolean) => ({ id, name, phone: "9000000001", line1: `${name} Road`, line2: null, landmark: null, city: "Pune", stateCode: "Maharashtra", pincode: "411001", type: "home", isDefault });
    const out = render(
      React.createElement(CheckoutContainer, {
        cart,
        shippingRates: [{ method: "standard", title: "Standard", description: "3 to 4 days", estimatedDays: "3-4", amount: 5000 }],
        paymentOptions: { codEnabled: true, codFeePaise: 5000, onlineAvailable: false },
        consent: { showTerms: false, showMarketing: false } as never,
        signedIn: true,
        customerEmail: "me@example.com",
        savedAddresses: [addr("a1", "Home", true), addr("a2", "Office", false)],
      }),
    );
    expect(out).toContain('data-testid="saved-addresses"');
    expect(out).toContain("Home Road");
    expect(out).not.toContain("Office Road"); // the other card is only in the popup
    expect(out).toContain("Choose another address");
    expect(out).toContain("Add a new address");
    expect(out).toContain('href="/account/addresses"');
    expect(out).toContain("me@example.com");
  });
});
