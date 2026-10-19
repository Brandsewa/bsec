import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import {
  CASHFREE_API_VERSION,
  CashfreeProvider,
  cashfreeModeOfSecret,
  paiseToRupees,
  rupeesToPaise,
  verifyCashfreeSignature,
} from "../src/providers/cashfree.ts";

const secret = "cfsk_ma_test_abc123def456";
const ctx = { tenantId: "t1" };

function sign(ts: string, body: string, sep = "") {
  return createHmac("sha256", secret).update(`${ts}${sep}${body}`).digest("base64");
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("Cashfree helpers", () => {
  it("converts between paise and rupees without float drift", () => {
    expect(paiseToRupees(149900)).toBe(1499);
    expect(paiseToRupees(10)).toBe(0.1);
    expect(rupeesToPaise(1499.5)).toBe(149950);
    expect(rupeesToPaise("0.29")).toBe(29);
  });

  it("reads the mode from the secret", () => {
    expect(cashfreeModeOfSecret("cfsk_ma_prod_xyz")).toBe("live");
    expect(cashfreeModeOfSecret("cfsk_ma_test_xyz")).toBe("test");
  });
});

describe("verifyCashfreeSignature", () => {
  const body = '{"type":"PAYMENT_SUCCESS_WEBHOOK","data":{"order":{"order_amount":170.00}}}';
  it("accepts a valid signature, with or without a dot separator", () => {
    expect(verifyCashfreeSignature(secret, "1700000000", body, sign("1700000000", body))).toBe(true);
    expect(verifyCashfreeSignature(secret, "1700000000", body, sign("1700000000", body, "."))).toBe(true);
  });
  it("fails closed on a wrong secret, tampered body, or missing parts", () => {
    const sig = sign("1700000000", body);
    expect(verifyCashfreeSignature("other-secret", "1700000000", body, sig)).toBe(false);
    expect(verifyCashfreeSignature(secret, "1700000000", body.replace("170.00", "1.00"), sig)).toBe(false);
    expect(verifyCashfreeSignature(secret, "1700000001", body, sig)).toBe(false);
    expect(verifyCashfreeSignature(undefined, "1700000000", body, sig)).toBe(false);
    expect(verifyCashfreeSignature(secret, undefined, body, sig)).toBe(false);
    expect(verifyCashfreeSignature(secret, "1700000000", body, undefined)).toBe(false);
  });
});

describe("CashfreeProvider", () => {
  it("verifies webhooks and derives a stable event id from the body", async () => {
    const p = new CashfreeProvider({ clientId: "TEST1", clientSecret: secret });
    const body = JSON.stringify({ type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "bs_1" }, payment: { cf_payment_id: 99, payment_amount: 12.5 } } });
    const headers = { "x-webhook-timestamp": "1700000000", "x-webhook-signature": sign("1700000000", body) };
    const a = await p.verifyWebhook(headers, body);
    const b = await p.verifyWebhook(headers, body);
    expect(a.isValid).toBe(true);
    expect(a.eventType).toBe("PAYMENT_SUCCESS_WEBHOOK");
    expect(a.providerOrderId).toBe("bs_1");
    expect(a.providerPaymentId).toBe("99");
    expect(a.amount).toBe(1250);
    expect(a.eventId).toBe(b.eventId);
    const bad = await p.verifyWebhook({ ...headers, "x-webhook-signature": "nope" }, body);
    expect(bad.isValid).toBe(false);
  });

  it("an unconfigured provider never validates a webhook", async () => {
    const p = new CashfreeProvider({});
    const body = "{}";
    expect((await p.verifyWebhook({ "x-webhook-timestamp": "1", "x-webhook-signature": sign("1", body) }, body)).isValid).toBe(false);
  });

  it("creates an order in rupees on the sandbox and returns the payment session", async () => {
    const fetchFn = vi.fn(async () => json(200, { order_id: "bs_ORD1", cf_order_id: 5, order_amount: 1499, order_currency: "INR", order_status: "ACTIVE", payment_session_id: "session_x" }));
    const p = new CashfreeProvider({ clientId: "TEST1", clientSecret: secret, fetchFn: fetchFn as unknown as typeof fetch });
    const r = await p.createIntent(ctx, { id: "o1", number: "ORD1", currency: "INR", grandTotal: 149900, email: "a@b.in", phone: "9999999999" });
    expect(r.providerOrderId).toBe("bs_ORD1");
    expect(r.amount).toBe(149900);
    expect(r.clientSecret).toBe("session_x");
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders");
    const headers = init.headers as Record<string, string>;
    expect(headers["x-api-version"]).toBe(CASHFREE_API_VERSION);
    expect(headers["x-client-id"]).toBe("TEST1");
    expect(JSON.parse(String(init.body)).order_amount).toBe(1499);
  });

  it("uses the production host for a production secret", async () => {
    const fetchFn = vi.fn(async () => json(404, { message: "order not found", code: "order_not_found", type: "invalid_request_error" }));
    const p = new CashfreeProvider({ clientId: "APP1", clientSecret: "cfsk_ma_prod_zzz", fetchFn: fetchFn as unknown as typeof fetch });
    const r = await p.testConnection();
    expect(r).toEqual({ ok: true, mode: "live" });
    expect((fetchFn.mock.calls[0] as unknown as [string])[0]).toBe("https://api.cashfree.com/pg/orders/bs_connection_probe");
  });

  it("testConnection reports rejected credentials and unreachable Cashfree", async () => {
    const reject = new CashfreeProvider({ clientId: "X", clientSecret: secret, fetchFn: (async () => json(401, { message: "authentication Failed", code: "request_failed" })) as unknown as typeof fetch });
    const r = await reject.testConnection();
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/rejected/);
    const down = new CashfreeProvider({ clientId: "X", clientSecret: secret, fetchFn: (async () => { throw new Error("net"); }) as unknown as typeof fetch });
    expect((await down.testConnection()).error).toMatch(/Could not reach/);
    expect((await new CashfreeProvider({}).testConnection()).ok).toBe(false);
  });

  it("refunds in rupees against the order and maps the status", async () => {
    const fetchFn = vi.fn(async () => json(200, { refund_id: "rf_1", refund_status: "PENDING", refund_amount: 10 }));
    const p = new CashfreeProvider({ clientId: "T", clientSecret: secret, fetchFn: fetchFn as unknown as typeof fetch });
    const r = await p.refund(ctx, { intentId: "i1", providerPaymentId: "bs_ORD1" }, 1000, "damaged");
    expect(r).toEqual({ providerRefundId: "rf_1", status: "pending", amount: 1000 });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://sandbox.cashfree.com/pg/orders/bs_ORD1/refunds");
    expect(JSON.parse(String(init.body)).refund_amount).toBe(10);
  });

  it("captures only when Cashfree shows a successful payment", async () => {
    const paid = new CashfreeProvider({ clientId: "T", clientSecret: secret, fetchFn: (async () => json(200, [{ cf_payment_id: 7, payment_status: "SUCCESS", payment_amount: 5, payment_currency: "INR" }])) as unknown as typeof fetch });
    const intent = { id: "i", orderId: "o", provider: "cashfree", amount: 500, currency: "INR", status: "created", providerOrderId: "bs_1" };
    expect(await paid.capture(ctx, intent, 500)).toEqual({ status: "captured", providerPaymentId: "7", amountCaptured: 500 });
    const unpaid = new CashfreeProvider({ clientId: "T", clientSecret: secret, fetchFn: (async () => json(200, [{ cf_payment_id: 8, payment_status: "FAILED", payment_amount: 5, payment_currency: "INR" }])) as unknown as typeof fetch });
    expect((await unpaid.capture(ctx, intent, 500)).status).toBe("failed");
  });
});
