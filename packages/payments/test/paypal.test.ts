import { describe, expect, it } from "vitest";
import { PayPalProvider, fromPayPalAmount, redactPayPalSecrets, toPayPalAmount } from "../src/providers/paypal.ts";

const ctx = { tenantId: "0199a000-0000-7000-8000-0000000000aa" };

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: string | undefined;
}

function mockFetch(routes: Record<string, (call: Call) => unknown | { status: number; body: unknown }>): { fetchFn: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchFn = (async (url: string, init?: RequestInit) => {
    const call: Call = { url, method: init?.method ?? "GET", headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body as string | undefined };
    calls.push(call);
    const key = Object.keys(routes).find((k) => url.endsWith(k));
    if (!key) return new Response(JSON.stringify({ message: "no route" }), { status: 404 });
    const out = routes[key]!(call) as { status?: number; body?: unknown };
    const status = typeof out?.status === "number" && "body" in (out as object) ? out.status : 200;
    const body = typeof out?.status === "number" && "body" in (out as object) ? out.body : out;
    return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

const tokenRoute = () => ({ access_token: "tok_123", expires_in: 3600 });

describe("amounts", () => {
  it("converts minor units to PayPal strings and back", () => {
    expect(toPayPalAmount(1250, "USD")).toBe("12.50");
    expect(toPayPalAmount(5, "CAD")).toBe("0.05");
    expect(toPayPalAmount(500, "JPY")).toBe("500");
    expect(fromPayPalAmount("12.50", "USD")).toBe(1250);
    expect(fromPayPalAmount("19.99", "CAD")).toBe(1999);
    expect(fromPayPalAmount("500", "JPY")).toBe(500);
  });
});

describe("PayPalProvider.createIntent", () => {
  it("creates an order in the market currency with the server-side total and returns the approval link", async () => {
    const { fetchFn, calls } = mockFetch({
      "/v1/oauth2/token": tokenRoute,
      "/v2/checkout/orders": () => ({ id: "5O190127TN364715T", status: "PAYER_ACTION_REQUIRED", links: [{ rel: "payer-action", href: "https://www.sandbox.paypal.com/checkoutnow?token=5O19" }] }),
    });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "csecret", mode: "sandbox", returnUrl: "https://shop.test/ok", cancelUrl: "https://shop.test/no", fetchFn });
    const intent = await p.createIntent(ctx, { id: "ord-1", number: "#1001", currency: "USD", grandTotal: 4599, email: "a@b.co", phone: "1" });
    expect(intent).toMatchObject({ providerOrderId: "5O190127TN364715T", amount: 4599, currency: "USD", status: "requires_action" });
    expect(intent.meta?.checkoutUrl).toContain("paypal.com/checkoutnow");
    const create = calls.find((c) => c.url.endsWith("/v2/checkout/orders"))!;
    expect(create.url.startsWith("https://api-m.sandbox.paypal.com")).toBe(true);
    expect(create.headers["PayPal-Request-Id"]).toBe("bsec-checkout-ord-1");
    expect(create.headers.Authorization).toBe("Bearer tok_123");
    const body = JSON.parse(create.body!) as { purchase_units: { amount: { currency_code: string; value: string }; custom_id: string }[] };
    expect(body.purchase_units[0]!.amount).toEqual({ currency_code: "USD", value: "45.99" });
    expect(body.purchase_units[0]!.custom_id).toBe("ord-1");
  });

  it("uses the live host only for live mode", async () => {
    const { fetchFn, calls } = mockFetch({ "/v1/oauth2/token": tokenRoute });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs", mode: "live", fetchFn });
    expect((await p.testConnection()).mode).toBe("live");
    expect(calls[0]!.url.startsWith("https://api-m.paypal.com")).toBe(true);
  });

  it("requires return and cancel URLs", async () => {
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs" });
    await expect(p.createIntent(ctx, { id: "o", number: "#1", currency: "USD", grandTotal: 100, email: "", phone: "" })).rejects.toThrow(/return and cancel/);
  });
});

describe("PayPalProvider.captureOrder", () => {
  it("reports the captured amount and currency so the server can check them", async () => {
    const { fetchFn } = mockFetch({
      "/v1/oauth2/token": tokenRoute,
      "/capture": () => ({ status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "CAP1", status: "COMPLETED", amount: { currency_code: "CAD", value: "45.99" } }] } }] }),
    });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs", fetchFn });
    expect(await p.captureOrder("ORD")).toEqual({ status: "captured", captureId: "CAP1", amount: 4599, currency: "CAD" });
  });

  it("returns a failure instead of throwing when PayPal declines", async () => {
    const { fetchFn } = mockFetch({
      "/v1/oauth2/token": tokenRoute,
      "/capture": () => ({ status: 422, body: { name: "UNPROCESSABLE_ENTITY", details: [{ issue: "ORDER_NOT_APPROVED", description: "Order not approved" }] } }),
    });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs", fetchFn });
    expect(await p.captureOrder("ORD")).toMatchObject({ status: "failed", errorMessage: "Order not approved" });
  });
});

describe("PayPalProvider.refund", () => {
  it("refunds in the currency that was charged", async () => {
    const { fetchFn, calls } = mockFetch({
      "/v1/oauth2/token": tokenRoute,
      "/refund": () => ({ id: "REF1", status: "COMPLETED", amount: { value: "10.00", currency_code: "USD" } }),
    });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs", fetchFn });
    const r = await p.refund(ctx, { intentId: "int-1", providerPaymentId: "CAP1" }, 1000, "damaged", "USD");
    expect(r).toEqual({ providerRefundId: "REF1", status: "processed", amount: 1000 });
    const body = JSON.parse(calls.find((c) => c.url.endsWith("/refund"))!.body!) as { amount: { currency_code: string; value: string } };
    expect(body.amount).toEqual({ currency_code: "USD", value: "10.00" });
  });
});

describe("PayPalProvider.verifyWebhook", () => {
  const headers = {
    "paypal-auth-algo": "SHA256withRSA",
    "paypal-cert-url": "https://api.paypal.com/cert",
    "paypal-transmission-id": "tid",
    "paypal-transmission-sig": "sig",
    "paypal-transmission-time": "2026-10-28T10:00:00Z",
  };
  const body = JSON.stringify({
    id: "WH-1",
    event_type: "PAYMENT.CAPTURE.COMPLETED",
    resource: { id: "CAP1", custom_id: "ord-1", amount: { value: "45.99", currency_code: "USD" }, supplementary_data: { related_ids: { order_id: "PPORD" } } },
  });

  it("accepts an event PayPal verifies and extracts the order identity", async () => {
    const { fetchFn } = mockFetch({ "/v1/oauth2/token": tokenRoute, "/v1/notifications/verify-webhook-signature": () => ({ verification_status: "SUCCESS" }) });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs", webhookId: "WHID", fetchFn });
    const ev = await p.verifyWebhook(headers, body);
    expect(ev).toMatchObject({ isValid: true, provider: "paypal", eventId: "WH-1", eventType: "PAYMENT.CAPTURE.COMPLETED", orderId: "ord-1", providerOrderId: "PPORD", providerPaymentId: "CAP1", amount: 4599 });
  });

  it("rejects an event PayPal does not verify, or one with no webhook id configured", async () => {
    const bad = mockFetch({ "/v1/oauth2/token": tokenRoute, "/v1/notifications/verify-webhook-signature": () => ({ verification_status: "FAILURE" }) });
    expect((await new PayPalProvider({ clientId: "cid", clientSecret: "cs", webhookId: "WHID", fetchFn: bad.fetchFn }).verifyWebhook(headers, body)).isValid).toBe(false);
    expect((await new PayPalProvider({ clientId: "cid", clientSecret: "cs" }).verifyWebhook(headers, body)).isValid).toBe(false);
  });

  it("rejects when the verification call itself fails", async () => {
    const { fetchFn } = mockFetch({ "/v1/oauth2/token": () => ({ status: 401, body: { error_description: "bad client" } }) });
    const p = new PayPalProvider({ clientId: "cid", clientSecret: "cs", webhookId: "WHID", fetchFn });
    expect((await p.verifyWebhook(headers, body)).isValid).toBe(false);
  });
});

describe("secrets", () => {
  it("never leaves credentials in error text", () => {
    expect(redactPayPalSecrets("failed for csecret-value with Bearer abc.def", ["csecret-value"])).toBe("failed for [REDACTED] with Bearer [REDACTED]");
  });
});
