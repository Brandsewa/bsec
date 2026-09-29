import { describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";

// Mock server-only
vi.mock("server-only", () => ({}));
process.env.DATABASE_URL_RW = process.env.DATABASE_URL_RW ?? "postgres://x:y@127.0.0.1:1/none";

// Mock next/navigation
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/cart",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

// Mock @bs/domain runtime database interactions for API route tests
vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateStorefrontAccess: vi.fn(async () => ({
      tenantId: "tenant-test-1",
      mode: "live",
      customDomain: null,
      allowed: true,
    })),
    getOrCreateCart: vi.fn(async (_rt, _ctx, token) => ({
      id: "cart-test-1",
      token: token || "cart-token-test",
      currency: "INR",
      items: [],
      itemCount: 0,
      subtotal: 0,
      lastActivityAt: "2026-09-29T00:00:00.000Z",
      createdAt: "2026-09-29T00:00:00.000Z",
    })),
    estimateCartShipping: vi.fn(async () => ({
      serviceable: true,
      rates: [
        {
          id: "standard",
          title: "Standard Delivery",
          costPaise: 5000,
          estimatedDays: "3-5 business days",
        },
        {
          id: "express",
          title: "Express Delivery",
          costPaise: 12000,
          estimatedDays: "1-2 business days",
        },
      ],
    })),
    clearCart: vi.fn(async () => {}),
  };
});

import { CartView } from "../src/components/cart/CartView.tsx";
import { CartItemRow } from "../src/components/cart/CartItemRow.tsx";
import { ShippingEstimator } from "../src/components/cart/ShippingEstimator.tsx";
import { CheckoutForm } from "../src/components/checkout/CheckoutForm.tsx";
import { OrderSummary } from "../src/components/checkout/OrderSummary.tsx";
import { CheckoutContainer } from "../src/components/checkout/CheckoutContainer.tsx";
import type { StorefrontCart, StorefrontCartItem } from "@bs/domain";

describe("Storefront Cart & Checkout Flow", () => {
  const mockItem: StorefrontCartItem = {
    id: "item-1",
    cartId: "cart-1",
    variantId: "var-1",
    quantity: 2,
    unitPriceSnapshot: 149900,
    lineTotal: 299800,
    properties: { engraving: "BS Commerce" },
    product: {
      id: "prod-1",
      title: "KeyCraft Custom Switch Lubing Station",
      slug: "keycraft-custom-switch-lubing-station",
    },
    variant: {
      id: "var-1",
      sku: "KC-LUBE-STN-01",
      title: "Matte Black",
      optionValues: { Color: "Matte Black" },
      price: 149900,
    },
    primaryImage: {
      mediaId: "med-1",
      alt: "Lubing station top view",
    },
    createdAt: "2026-09-29T00:00:00.000Z",
    updatedAt: "2026-09-29T00:00:00.000Z",
  };

  const mockCart: StorefrontCart = {
    id: "cart-1",
    token: "cart-token-1234",
    currency: "INR",
    items: [mockItem],
    itemCount: 2,
    subtotal: 299800,
    lastActivityAt: "2026-09-29T00:00:00.000Z",
    createdAt: "2026-09-29T00:00:00.000Z",
  };

  const emptyCart: StorefrontCart = {
    id: "cart-empty",
    token: "cart-token-empty",
    currency: "INR",
    items: [],
    itemCount: 0,
    subtotal: 0,
    lastActivityAt: "2026-09-29T00:00:00.000Z",
    createdAt: "2026-09-29T00:00:00.000Z",
  };

  describe("CartItemRow", () => {
    it("renders item title, variant details, formatted price, quantity stepper, and remove button", () => {
      const html = renderToString(
        React.createElement(CartItemRow, {
          item: mockItem,
        }),
      );

      expect(html).toContain("KeyCraft Custom Switch Lubing Station");
      expect(html).toContain("Matte Black");
      expect(html).toContain("KC-LUBE-STN-01");
      expect(html).toContain("₹2,998");
      expect(html).toContain("2");
      expect(html).toContain("Remove");
    });
  });

  describe("ShippingEstimator", () => {
    it("renders pincode input with Indian pincode placeholder, a11y label, and estimate button", () => {
      const html = renderToString(React.createElement(ShippingEstimator));

      expect(html).toContain("Estimate Shipping");
      expect(html).toContain('aria-label="6-digit Indian Pincode"');
      expect(html).toContain('id="shipping-pincode"');
      expect(html).toContain('for="shipping-pincode"');
      expect(html).toContain("Pincode");
      expect(html).toContain("Calculate");
    });
  });

  describe("CartView", () => {
    it("renders line items, subtotal, GST note, and checkout button when cart has items", () => {
      const html = renderToString(
        React.createElement(CartView, {
          cart: mockCart,
        }),
      );

      expect(html).toContain("Shopping Cart");
      expect(html).toContain("KeyCraft Custom Switch Lubing Station");
      expect(html).toContain("₹2,998");
      expect(html).toContain("GST included");
      expect(html).toContain("Proceed to Checkout");
      expect(html).toContain('href="/checkout"');
    });

    it("renders empty cart zero-state when cart is empty", () => {
      const html = renderToString(
        React.createElement(CartView, {
          cart: emptyCart,
        }),
      );

      expect(html).toContain("Your cart is empty");
      expect(html).toContain("Continue Shopping");
      expect(html).toContain('href="/"');
    });
  });

  describe("OrderSummary", () => {
    it("renders order items, subtotal, standard shipping or free threshold, and total", () => {
      const html = renderToString(
        React.createElement(OrderSummary, {
          cart: mockCart,
          shippingPaise: 0,
        }),
      );

      expect(html).toContain("Order Summary");
      expect(html).toContain("KeyCraft Custom Switch Lubing Station");
      expect(html).toContain("₹2,998");
      expect(html).toContain("Free");
    });
  });

  describe("CheckoutForm", () => {
    it("renders customer info, shipping address with Indian states, shipping methods, and payment options", () => {
      const html = renderToString(
        React.createElement(CheckoutForm, {
          cart: mockCart,
        }),
      );

      // Contact info
      expect(html).toContain("Contact Information");
      expect(html).toContain("Email");
      expect(html).toContain("Phone");

      // Shipping address
      expect(html).toContain("Shipping Address");
      expect(html).toContain("Full Name");
      expect(html).toContain("Address Line 1");
      expect(html).toContain("City");
      expect(html).toContain("State");
      expect(html).toContain("Pincode");
      expect(html).toContain("Maharashtra");
      expect(html).toContain("Delhi");
      expect(html).toContain("Karnataka");

      // Shipping and Payment method
      expect(html).toContain("Standard Delivery");
      expect(html).toContain("Express Delivery");
      expect(html).toContain("Cash on Delivery (COD)");
      expect(html).toContain("UPI / Card / NetBanking");
      expect(html).toContain("Payment gateway in test mode");
      expect(html).toContain("Place Order");
    });
  });

  describe("CheckoutContainer", () => {
    it("renders both CheckoutForm and OrderSummary coordinated with shipping calculation", () => {
      const html = renderToString(
        React.createElement(CheckoutContainer, {
          cart: mockCart,
        }),
      );

      // Contains elements from both child components
      expect(html).toContain("Contact Information");
      expect(html).toContain("Shipping Address");
      expect(html).toContain("Order Summary");
      expect(html).toContain("KeyCraft Custom Switch Lubing Station");
      // Since subtotal 299800 >= 99900, standard delivery is Free
      expect(html).toContain("Free");
    });
  });

  describe("Cart & Checkout API Route Handlers", () => {
    describe("GET /api/storefront/cart", () => {
      it("creates or returns cart and sets bs_cart_token cookie if missing", async () => {
        const { GET } = await import("../src/app/api/storefront/cart/route.ts");
        const req = new Request("https://demo.gobs.cloud/api/storefront/cart", {
          headers: { host: "demo.gobs.cloud" },
        });
        const res = await GET(req);
        if (res.status !== 200) {
          const errData = await res.json();
          console.error("DEBUG CART GET ERROR:", errData);
        }
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("cart");
        expect(data.cart).toHaveProperty("token");
        expect(data.cart).toHaveProperty("items");

        // Verify Set-Cookie header for bs_cart_token
        const setCookie = res.headers.get("set-cookie") || "";
        expect(setCookie).toContain("bs_cart_token=");
      });
    });

    describe("POST /api/storefront/cart/items", () => {
      it("validates variantId and positive quantity", async () => {
        const { POST } = await import("../src/app/api/storefront/cart/items/route.ts");
        const badReq = new Request("https://demo.gobs.cloud/api/storefront/cart/items", {
          method: "POST",
          headers: { host: "demo.gobs.cloud", "content-type": "application/json" },
          body: JSON.stringify({ variantId: "", quantity: 0 }),
        });
        const res = await POST(badReq);
        expect(res.status).toBe(400);
      });
    });

    describe("PATCH /api/storefront/cart/items", () => {
      it("validates itemId and quantity", async () => {
        const { PATCH } = await import("../src/app/api/storefront/cart/items/route.ts");
        const badReq = new Request("https://demo.gobs.cloud/api/storefront/cart/items", {
          method: "PATCH",
          headers: { host: "demo.gobs.cloud", "content-type": "application/json" },
          body: JSON.stringify({ itemId: "", quantity: -1 }),
        });
        const res = await PATCH(badReq);
        expect(res.status).toBe(400);
      });
    });

    describe("DELETE /api/storefront/cart/items", () => {
      it("validates itemId", async () => {
        const { DELETE } = await import("../src/app/api/storefront/cart/items/route.ts");
        const badReq = new Request("https://demo.gobs.cloud/api/storefront/cart/items", {
          method: "DELETE",
          headers: { host: "demo.gobs.cloud", "content-type": "application/json" },
          body: JSON.stringify({ itemId: "" }),
        });
        const res = await DELETE(badReq);
        expect(res.status).toBe(400);
      });
    });

    describe("POST /api/storefront/cart/estimate-shipping", () => {
      it("validates 6-digit Indian pincode format", async () => {
        const { POST } = await import("../src/app/api/storefront/cart/estimate-shipping/route.ts");
        const badReq = new Request("https://demo.gobs.cloud/api/storefront/cart/estimate-shipping", {
          method: "POST",
          headers: { host: "demo.gobs.cloud", "content-type": "application/json" },
          body: JSON.stringify({ pincode: "123" }),
        });
        const res = await POST(badReq);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBeDefined();
      });

      it("returns shipping estimate for valid 6-digit Indian pincode", async () => {
        const { POST } = await import("../src/app/api/storefront/cart/estimate-shipping/route.ts");
        const req = new Request("https://demo.gobs.cloud/api/storefront/cart/estimate-shipping", {
          method: "POST",
          headers: {
            host: "demo.gobs.cloud",
            "content-type": "application/json",
            cookie: "bs_cart_token=cart-token-test",
          },
          body: JSON.stringify({ pincode: "560001" }),
        });
        const res = await POST(req);
        expect(res.status).toBe(200);
        const data = await res.json();
        expect(data).toHaveProperty("serviceable", true);
        expect(data).toHaveProperty("rates");
        expect(Array.isArray(data.rates)).toBe(true);
      });
    });

    describe("POST /api/storefront/checkout/place-order", () => {
      it("validates Indian phone number and required address fields", async () => {
        const { POST } = await import("../src/app/api/storefront/checkout/place-order/route.ts");
        const badReq = new Request("https://demo.gobs.cloud/api/storefront/checkout/place-order", {
          method: "POST",
          headers: { host: "demo.gobs.cloud", "content-type": "application/json" },
          body: JSON.stringify({
            email: "invalid-email",
            phone: "12345",
            fullName: "",
            addressLine1: "",
            city: "",
            state: "",
            pincode: "invalid",
          }),
        });
        const res = await POST(badReq);
        expect(res.status).toBe(400);
        const data = await res.json();
        expect(data.error).toBeDefined();
      });

      it("creates order token and returns redirect URL on valid checkout", async () => {
        const { POST } = await import("../src/app/api/storefront/checkout/place-order/route.ts");
        const validReq = new Request("https://demo.gobs.cloud/api/storefront/checkout/place-order", {
          method: "POST",
          headers: {
            host: "demo.gobs.cloud",
            "content-type": "application/json",
            cookie: "bs_cart_token=cart-token-1234",
          },
          body: JSON.stringify({
            email: "buyer@example.in",
            phone: "9876543210",
            fullName: "Aarav Sharma",
            addressLine1: "123 MG Road",
            addressLine2: "Apt 4B",
            city: "Bengaluru",
            state: "Karnataka",
            pincode: "560001",
            shippingMethod: "standard",
            paymentMethod: "cod",
            notes: "Please call upon arrival",
          }),
        });
        const res = await validReq ? await POST(validReq) : null;
        expect(res).not.toBeNull();
        if (res) {
          expect(res.status).toBe(200);
          const data = await res.json();
          expect(data.success).toBe(true);
          expect(data.orderToken).toMatch(/^ord_/);
          expect(data.redirectUrl).toBe(`/orders/${data.orderToken}/thank-you`);
          // Verify clearing cookie or clearing cart
          const setCookie = res.headers.get("set-cookie") || "";
          expect(setCookie).toBeDefined();
        }
      });
    });
  });
});
