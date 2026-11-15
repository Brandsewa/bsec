import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { StripeProvider, STRIPE_API_VERSION, redactStripeSecrets } from "../src/providers/stripe.ts";

const SECRET = "sk_test_51ABCDEFGHIJKLMNOP";
const WHSEC = "whsec_test_signing_secret_123456";
const NOW = 1_800_000_000;

function sign(body: string, ts = NOW, secret = WHSEC): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

function eventBody(type: string, obj: Record<string, unknown>, id = "evt_1"): string {
  return JSON.stringify({ id, type, data: { object: obj } });
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
}

const ctx = { tenantId: "0199a000-0000-7000-8000-0000000000aa" };

describe("StripeProvider.verifyWebhook (signed fixtures, no network)", () => {
  const provider = new StripeProvider({ secretKey: SECRET, webhookSecret: WHSEC, nowSeconds: () => NOW });

  it("accepts a correctly signed checkout.session.completed and extracts order identity", async () => {
    const body = eventBody("checkout.session.completed", {
      id: "cs_test_1",
      payment_intent: "pi_1",
      amount_total: 49900,
      metadata: { order_id: "ord-1", tenant_id: ctx.tenantId },
    });
    const ev = await provider.verifyWebhook({ "stripe-signature": sign(body) }, body);
    expect(ev.isValid).toBe(true);
    expect(ev.provider).toBe("stripe");
    expect(ev.eventId).toBe("evt_1");
    expect(ev.eventType).toBe("checkout.session.completed");
    expect(ev.providerOrderId).toBe("cs_test_1");
    expect(ev.providerPaymentId).toBe("pi_1");
    expect(ev.amount).toBe(49900);
    expect(ev.orderId).toBe("ord-1");
  });

  it("rejects a wrong signature, a tampered body, a stale timestamp and a missing header", async () => {
    const body = eventBody("payment_intent.payment_failed", { id: "pi_2", amount: 100 });
    expect((await provider.verifyWebhook({ "stripe-signature": sign(body, NOW, "whsec_other_secret_value") }, body)).isValid).toBe(false);
    expect((await provider.verifyWebhook({ "stripe-signature": sign(body) }, body.replace("100", "999"))).isValid).toBe(false);
    expect((await provider.verifyWebhook({ "stripe-signature": sign(body, NOW - 10_000) }, body)).isValid).toBe(false);
    expect((await provider.verifyWebhook({}, body)).isValid).toBe(false);
  });

  it("never verifies without the store's own signing secret (no shared fallback)", async () => {
    const noSecret = new StripeProvider({ secretKey: SECRET, nowSeconds: () => NOW });
    const body = eventBody("charge.refunded", { id: "ch_1", amount: 10 });
    expect((await noSecret.verifyWebhook({ "stripe-signature": sign(body) }, body)).isValid).toBe(false);
  });

  it("accepts any matching v1 signature when Stripe sends several (secret rotation)", async () => {
    const body = eventBody("charge.refunded", { id: "ch_2", amount: 10 });
    const good = sign(body).split(",v1=")[1];
    const header = `t=${NOW},v1=${"0".repeat(64)},v1=${good}`;
    expect((await provider.verifyWebhook({ "stripe-signature": header }, body)).isValid).toBe(true);
  });

  it("strips secret-looking keys from the stored payload", async () => {
    const body = eventBody("checkout.session.completed", { id: "cs_x", client_secret: "abc", metadata: {} });
    const ev = await provider.verifyWebhook({ "stripe-signature": sign(body) }, body);
    expect(JSON.stringify(ev.rawPayload)).not.toContain("client_secret");
  });
});

describe("StripeProvider API calls (faked fetch)", () => {
  it("creates a hosted Checkout Session with paise amounts, metadata, pinned version and idempotency key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new StripeProvider({
      secretKey: SECRET,
      successUrl: "https://shop.example/thanks",
      cancelUrl: "https://shop.example/cart",
      fetchFn: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse({ id: "cs_test_9", url: "https://checkout.stripe.com/c/pay/cs_test_9", status: "open" });
      }) as unknown as typeof fetch,
    });
    const res = await provider.createIntent(ctx, {
      id: "ord-9",
      number: "BS-1009",
      currency: "INR",
      grandTotal: 123456,
      email: "a@b.co",
      phone: "9999999999",
    });
    expect(res.providerOrderId).toBe("cs_test_9");
    expect(res.amount).toBe(123456);
    expect(res.meta?.checkoutUrl).toBe("https://checkout.stripe.com/c/pay/cs_test_9");

    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/checkout/sessions");
    const headers = call.init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SECRET}`);
    expect(headers["Stripe-Version"]).toBe(STRIPE_API_VERSION);
    expect(headers["Idempotency-Key"]).toBe("bsec-checkout-ord-9");
    const form = new URLSearchParams(String(call.init.body));
    expect(form.get("line_items[0][price_data][unit_amount]")).toBe("123456");
    expect(form.get("line_items[0][price_data][currency]")).toBe("inr");
    expect(form.get("metadata[order_id]")).toBe("ord-9");
    expect(form.get("metadata[tenant_id]")).toBe(ctx.tenantId);
  });

  it("creates a PaymentIntent for the Payment Element: automatic payment methods, metadata, client secret out, no redirect URLs", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const provider = new StripeProvider({
      secretKey: SECRET,
      uiMode: "elements",
      idempotencySalt: "2",
      fetchFn: (async (url: string, init: RequestInit) => {
        calls.push({ url, init });
        return jsonResponse({ id: "pi_test_e1", status: "requires_payment_method", client_secret: "pi_test_e1_secret_x" });
      }) as unknown as typeof fetch,
    });
    const res = await provider.createIntent(ctx, { id: "ord-e", number: "BS-1", currency: "USD", grandTotal: 2500, email: "a@b.co", phone: "1" });
    expect(res.clientSecret).toBe("pi_test_e1_secret_x");
    expect(res.providerOrderId).toBe("pi_test_e1");
    expect(res.amount).toBe(2500);
    const call = calls[0]!;
    expect(call.url).toBe("https://api.stripe.com/v1/payment_intents");
    const form = new URLSearchParams(String(call.init.body));
    expect(form.get("amount")).toBe("2500");
    expect(form.get("currency")).toBe("usd");
    expect(form.get("automatic_payment_methods[enabled]")).toBe("true");
    expect(form.get("metadata[order_id]")).toBe("ord-e");
    expect(form.get("metadata[tenant_id]")).toBe(ctx.tenantId);
    expect(form.get("receipt_email")).toBe("a@b.co");
    expect(form.has("success_url")).toBe(false);
    expect((call.init.headers as Record<string, string>)["Idempotency-Key"]).toBe("bsec-pi-ord-e-2");
  });

  it("a hosted session still needs both return URLs", async () => {
    const noReturn = new StripeProvider({ secretKey: SECRET, cancelUrl: "https://x" });
    await expect(noReturn.createIntent(ctx, { id: "o", number: "n", currency: "INR", grandTotal: 100, email: "", phone: "" })).rejects.toThrow(/success and cancel URLs/);
  });

  it("retrievePaymentIntent exposes the client secret only while it can still be paid", async () => {
    const make = (status: string) =>
      new StripeProvider({
        secretKey: SECRET,
        fetchFn: (async () => jsonResponse({ status, client_secret: "pi_secret", amount: 2500, amount_received: status === "succeeded" ? 2500 : 0, currency: "usd", metadata: { order_id: "ord-e" } })) as unknown as typeof fetch,
      });
    expect((await make("requires_payment_method").retrievePaymentIntent("pi_1")).clientSecret).toBe("pi_secret");
    const paid = await make("succeeded").retrievePaymentIntent("pi_1");
    expect(paid).toMatchObject({ clientSecret: null, amountReceived: 2500, currency: "USD", orderId: "ord-e", status: "succeeded" });
    expect((await make("canceled").retrievePaymentIntent("pi_1")).clientSecret).toBeNull();
  });

  it("cancels a PaymentIntent with its cancel endpoint and a hosted session with expire", async () => {
    const urls: string[] = [];
    const provider = new StripeProvider({ secretKey: SECRET, fetchFn: (async (url: string) => { urls.push(url); return jsonResponse({}); }) as unknown as typeof fetch });
    await provider.cancel(ctx, { providerOrderId: "pi_9" } as never);
    await provider.cancel(ctx, { providerOrderId: "cs_9" } as never);
    expect(urls).toEqual(["https://api.stripe.com/v1/payment_intents/pi_9/cancel", "https://api.stripe.com/v1/checkout/sessions/cs_9/expire"]);
  });

  it("a payment_intent.succeeded webhook carries the PaymentIntent id as the provider reference", async () => {
    const provider = new StripeProvider({ secretKey: SECRET, webhookSecret: WHSEC, nowSeconds: () => NOW });
    const body = eventBody("payment_intent.succeeded", { id: "pi_77", amount: 2500, currency: "usd", metadata: { order_id: "ord-e", tenant_id: ctx.tenantId } });
    const ev = await provider.verifyWebhook({ "stripe-signature": sign(body) }, body);
    expect(ev).toMatchObject({ isValid: true, providerOrderId: "pi_77", providerPaymentId: "pi_77", orderId: "ord-e", amount: 2500 });
  });

  it("refunds partially with a stable idempotency key", async () => {
    const calls: Array<{ init: RequestInit }> = [];
    const provider = new StripeProvider({
      secretKey: SECRET,
      fetchFn: (async (_u: string, init: RequestInit) => {
        calls.push({ init });
        return jsonResponse({ id: "re_1", status: "succeeded", amount: 2500 });
      }) as unknown as typeof fetch,
    });
    const r = await provider.refund(ctx, { intentId: "int-1", providerPaymentId: "pi_1" }, 2500, "damaged");
    expect(r).toMatchObject({ providerRefundId: "re_1", status: "processed", amount: 2500 });
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers["Idempotency-Key"]).toBe("bsec-refund-int-1-2500-damaged");
    expect(new URLSearchParams(String(calls[0]!.init.body)).get("amount")).toBe("2500");
  });

  it("testConnection reports mode and never leaks the key in errors", async () => {
    const ok = new StripeProvider({ secretKey: SECRET, fetchFn: (async () => jsonResponse({ livemode: false })) as unknown as typeof fetch });
    expect(await ok.testConnection()).toEqual({ ok: true, livemode: false });

    const bad = new StripeProvider({
      secretKey: SECRET,
      fetchFn: (async () => jsonResponse({ error: { message: `Invalid API Key provided: ${SECRET}` } }, 401)) as unknown as typeof fetch,
    });
    const res = await bad.testConnection();
    expect(res.ok).toBe(false);
    expect(res.error).not.toContain(SECRET);
    expect(res.error).toContain("[REDACTED]");
  });

  it("redactStripeSecrets masks key-shaped strings", () => {
    expect(redactStripeSecrets("bad sk_live_abcdefghijk and whsec_abcdefghij")).not.toMatch(/abcdefghij/);
  });
});
