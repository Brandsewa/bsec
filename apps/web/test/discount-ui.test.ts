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

const cartAfterApply = {
  id: "cart-1",
  token: "tok-1",
  currency: "INR",
  items: [],
  itemCount: 1,
  subtotal: 10000,
  discount: { discountId: "d-1", code: "TEN", title: "10% off", type: "percent", amount: 1000, freeShipping: false },
  discountNotice: null,
  lastActivityAt: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-10-01T00:00:00.000Z",
};

vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateStorefrontAccess: vi.fn(async () => ({ tenantId: "tenant-test-1", mode: "live", allowed: true })),
    checkStorefrontRateLimit: vi.fn(async () => {}),
    applyCartDiscount: vi.fn(async (_rt: unknown, _ctx: unknown, input: { code: string }) => {
      if (input.code.toUpperCase() === "TEN") return cartAfterApply;
      throw new Error("Bad Request: Discount code not found");
    }),
    removeCartDiscount: vi.fn(async () => ({ ...cartAfterApply, discount: null })),
  };
});

import { OrderSummary } from "../src/components/checkout/OrderSummary.tsx";
import { DiscountCodeBox } from "../src/components/cart/DiscountCodeBox.tsx";
import { CartView } from "../src/components/cart/CartView.tsx";
import type { StorefrontCart, StorefrontCartItem } from "@bs/domain";

const item: StorefrontCartItem = {
  id: "item-1",
  cartId: "cart-1",
  variantId: "var-1",
  quantity: 1,
  unitPriceSnapshot: 10000,
  lineTotal: 10000,
  properties: null,
  product: { id: "p1", title: "Pickle", slug: "pickle" },
  variant: { id: "var-1", sku: "P-1", title: "Default", optionValues: null, price: 10000 },
  primaryImage: null,
  createdAt: "2026-10-01T00:00:00.000Z",
  updatedAt: "2026-10-01T00:00:00.000Z",
};

const base: StorefrontCart = { ...(cartAfterApply as unknown as StorefrontCart), items: [item], discount: null };
const withTen: StorefrontCart = { ...base, discount: cartAfterApply.discount };
const withFreeShipping: StorefrontCart = {
  ...base,
  discount: { discountId: "d-2", code: "SHIPFREE", title: "Free shipping", type: "free_shipping", amount: 0, freeShipping: true },
};

describe("checkout order summary with a discount code", () => {
  it("without a code the total is goods + shipping", () => {
    const html = renderToString(React.createElement(OrderSummary, { cart: base, shippingPaise: 9900 }));
    expect(html).not.toContain("discount-line");
    expect(html).toContain("₹199"); // 100 + 99
  });

  it("a percent code shows a discount line and the lower total", () => {
    const html = renderToString(React.createElement(OrderSummary, { cart: withTen, shippingPaise: 9900 }));
    expect(html).toContain("Discount (TEN)");
    expect(html).toContain("−");
    expect(html).toContain("₹189"); // 100 - 10 + 99
  });

  it("a free-shipping code shows shipping as Free and the goods total only", () => {
    const html = renderToString(React.createElement(OrderSummary, { cart: withFreeShipping, shippingPaise: 9900 }));
    expect(html).toContain("Free");
    expect(html).toContain("₹100");
    expect(html).not.toContain("₹199");
  });

  it("shows the code box only when the checkout asks for it", () => {
    expect(renderToString(React.createElement(OrderSummary, { cart: base, shippingPaise: 0 }))).not.toContain("discount-box");
    expect(renderToString(React.createElement(OrderSummary, { cart: base, shippingPaise: 0, onCartChange: () => {} }))).toContain("discount-box");
  });
});

describe("cart page with a discount code", () => {
  it("shows the code field, and after a code the discount line and the lower estimate", () => {
    const plain = renderToString(React.createElement(CartView, { cart: base }));
    expect(plain).toContain("Discount code");
    expect(plain).not.toContain("discount-line");

    const discounted = renderToString(React.createElement(CartView, { cart: withTen }));
    expect(discounted).toContain("Discount (TEN)");
    expect(discounted).toContain("₹90"); // estimated total 100 - 10
  });

  it("a free-shipping code says so in the shipping row", () => {
    expect(renderToString(React.createElement(CartView, { cart: withFreeShipping }))).toContain("Free with your code");
  });
});

describe("the discount code box", () => {
  it("offers an input and Apply until a code is on the cart, then names it with a Remove button", () => {
    const empty = renderToString(React.createElement(DiscountCodeBox, { cart: base, onChange: () => {} }));
    expect(empty).toContain('placeholder="Discount code"');
    expect(empty).toContain("Apply");

    const applied = renderToString(React.createElement(DiscountCodeBox, { cart: withTen, onChange: () => {} }));
    expect(applied).toContain("TEN");
    expect(applied).toContain("applied");
    expect(applied).toContain("Remove");
    expect(applied).not.toContain('placeholder="Discount code"');
  });

  it("explains a code that stopped being valid and offers to remove it", () => {
    const stale: StorefrontCart = { ...base, discountNotice: "Code OVER150 can't be used: Minimum order subtotal of ₹150.00 required" };
    const html = renderToString(React.createElement(DiscountCodeBox, { cart: stale, onChange: () => {} }));
    expect(html).toContain("Minimum order subtotal");
    expect(html).toContain("Remove code");
  });
});

describe("POST/DELETE /api/storefront/cart/discount", () => {
  const url = "https://demo.bcom.si/api/storefront/cart/discount";
  const headers = { host: "demo.bcom.si", "content-type": "application/json", cookie: "bs_cart_token=tok-1" };

  it("applies a valid code and returns the cart with the discount", async () => {
    const { POST } = await import("../src/app/api/storefront/cart/discount/route.ts");
    const res = await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ code: "ten" }) }));
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.cart.discount).toMatchObject({ code: "TEN", amount: 1000 });
  });

  it("answers an unknown code with the reason, without the internal prefix", async () => {
    const { POST } = await import("../src/app/api/storefront/cart/discount/route.ts");
    const res = await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ code: "NOPE" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Discount code not found");
  });

  it("rejects an empty code and a missing cart", async () => {
    const { POST } = await import("../src/app/api/storefront/cart/discount/route.ts");
    const empty = await POST(new Request(url, { method: "POST", headers, body: JSON.stringify({ code: "   " }) }));
    expect(empty.status).toBe(400);
    const noCart = await POST(new Request(url, { method: "POST", headers: { host: "demo.bcom.si", "content-type": "application/json" }, body: JSON.stringify({ code: "TEN" }) }));
    expect(noCart.status).toBe(400);
    expect((await noCart.json()).error).toMatch(/cart is empty/i);
  });

  it("removes the code", async () => {
    const { DELETE } = await import("../src/app/api/storefront/cart/discount/route.ts");
    const res = await DELETE(new Request(url, { method: "DELETE", headers }));
    expect(res.status).toBe(200);
    expect((await res.json()).cart.discount).toBeNull();
  });
});
