import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToString } from "react-dom/server";
import type { StorefrontCart } from "@bs/domain";

vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => "/checkout",
  useSearchParams: () => new URLSearchParams(),
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: vi.fn(),
}));

const placeOrder = vi.fn();
vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    evaluateStorefrontAccess: async () => ({ tenantId: "tenant-test-1", mode: "live", allowed: true }),
    checkStorefrontRateLimit: async () => ({}),
    checkPlaceOrderRateLimit: async () => undefined,
    getCustomerBySession: async () => null,
    placeOrder: (...args: unknown[]) => placeOrder(...args),
  };
});

import { CheckoutForm } from "../src/components/checkout/CheckoutForm.tsx";
import { POST } from "../src/app/api/storefront/checkout/place-order/route.ts";

const REACHED = "PLACE_ORDER_REACHED";
const order = {
  email: "buyer@example.test",
  phone: "9876543210",
  fullName: "Test Buyer",
  addressLine1: "1 Test Road",
  city: "Pune",
  state: "Maharashtra",
  pincode: "411001",
  paymentMethod: "cod",
};
function req(body: Record<string, unknown>) {
  return new Request("https://demo.bcom.si/api/storefront/checkout/place-order", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: "bs_cart_token=cart-token-1", host: "demo.bcom.si" },
    body: JSON.stringify(body),
  });
}

describe("Checkout bot check at the place-order route (audit A3-04)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    placeOrder.mockRejectedValue(new Error(REACHED));
    (globalThis as Record<string, unknown>).__bsWeb = {
      rt: { service: "web", _db: { db: {} }, close: async () => {} },
      log: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
    };
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const withKeys = () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "site-key-public");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "secret-key-private");
  };

  it("refuses an order with no token before anything is created", async () => {
    withKeys();
    const res = await POST(req(order));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("challenge_failed");
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("refuses an order whose token Cloudflare rejects", async () => {
    withKeys();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 })));
    const res = await POST(req({ ...order, turnstileToken: "forged" }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("challenge_failed");
    expect(placeOrder).not.toHaveBeenCalled();
  });

  it("places the order when Cloudflare confirms the token", async () => {
    withKeys();
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ success: true }), { status: 200 })));
    const res = await POST(req({ ...order, turnstileToken: "good" }));
    expect(placeOrder).toHaveBeenCalledTimes(1);
    expect((await res.json()).error).toBe(REACHED);
  });

  it("lets the order through when Cloudflare is unreachable", async () => {
    withKeys();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    await POST(req({ ...order, turnstileToken: "good" }));
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });

  it("does not ask for a token when the keys are not both set (a store is never blocked by missing setup)", async () => {
    vi.stubEnv("TURNSTILE_SITE_KEY", "");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "");
    await POST(req(order));
    expect(placeOrder).toHaveBeenCalledTimes(1);
  });
});

describe("CheckoutForm bot check", () => {
  const cart = {
    id: "cart-1",
    token: "cart-token-1234",
    currency: "INR",
    items: [],
    itemCount: 0,
    subtotal: 100000,
    lastActivityAt: "2026-09-29T00:00:00.000Z",
    createdAt: "2026-09-29T00:00:00.000Z",
  } as unknown as StorefrontCart;
  const base = {
    cart,
    shippingRates: [{ method: "standard", title: "Standard", description: "3-7 days", estimatedDays: "3-7 days", amount: 9900 }],
    paymentOptions: { codEnabled: true, codFeePaise: 0, onlineAvailable: false },
    consent: { termsRequired: false, marketing: null },
  };

  it("holds the Place Order button until the check has produced a token", () => {
    const html = renderToString(React.createElement(CheckoutForm, { ...base, turnstileSiteKey: "site-key-public" }));
    expect(html).toContain("Checking security...");
    expect(html).not.toContain("Place Order (");
  });

  it("is unchanged when the bot check is off", () => {
    const html = renderToString(React.createElement(CheckoutForm, base));
    expect(html).toContain("Place Order (");
    expect(html).not.toContain("Checking security");
  });
});
