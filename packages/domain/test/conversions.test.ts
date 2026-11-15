import { describe, expect, it, vi } from "vitest";
import {
  buildMetaEventPayload,
  decideEventTracking,
  buildGa4PurchasePayload,
  buildMetaPurchasePayload,
  decideOrderTracking,
  gaClientIdFromCookie,
  hashedEmail,
  hashedPhone,
  parseConsentCookie,
  readCookie,
  sendGa4Purchase,
  sendMetaPurchase,
  sha256Hex,
  type ConversionOrder,
} from "../src/analytics/conversions.ts";
import type { PublicConsentConfig } from "@bs/contracts";

const cfg: PublicConsentConfig = {
  v: 1, rev: "abcd1234", position: "bottom", title: "t", message: "m", acceptLabel: "a", rejectLabel: "r", customizeLabel: "c",
  policyPath: "", ga4: "G-TEST12345", pixel: "1234567890123456",
};
const both = { metaAccessTokenSet: true, ga4ApiSecretSet: true };
const cookies = (consent: string, extra = "") => `bs_cart_count=2; bs_consent=${consent}; _fbp=fb.1.1700000000.123456789; _ga=GA1.1.1234567890.1700000000${extra}`;
const req = (cookieHeader: string) => ({ cookieHeader, ip: "203.0.113.7", userAgent: "Mozilla/5.0 Test", sourceUrl: "https://shop.test/checkout" });

const order: ConversionOrder = {
  number: "#1042", status: "confirmed", currency: "INR", email: "Buyer@Example.com ", phone: "98765 43210",
  grandTotal: 129_900, shippingTotal: 5_000, placedAt: new Date("2026-11-15T10:00:00Z"),
  items: [{ variantId: "v1", sku: "TEA-50", productTitle: "Tea", variantTitle: null, quantity: 2, unitPrice: 62_450 }],
};

describe("consent cookie and browser ids", () => {
  it("reads the choice only for the current revision", () => {
    expect(parseConsentCookie("abcd1234.10", "abcd1234")).toEqual({ analytics: true, marketing: false });
    expect(parseConsentCookie("abcd1234.01", "abcd1234")).toEqual({ analytics: false, marketing: true });
    expect(parseConsentCookie("old00000.11", "abcd1234")).toBeNull();
    expect(parseConsentCookie("abcd1234.12", "abcd1234")).toBeNull();
    expect(parseConsentCookie(null, "abcd1234")).toBeNull();
  });

  it("finds cookies and the GA client id", () => {
    expect(readCookie("a=1; _ga=GA1.1.555.666; b=2", "_ga")).toBe("GA1.1.555.666");
    expect(readCookie("a=1", "_ga")).toBeNull();
    expect(gaClientIdFromCookie("GA1.1.1234567890.1700000000")).toBe("1234567890.1700000000");
    expect(gaClientIdFromCookie("garbage")).toBeNull();
  });
});

describe("what is remembered about an order", () => {
  it("nothing without a decision, a rejection, or credentials", () => {
    expect(decideOrderTracking(null, both, req(cookies("abcd1234.11")))).toBeNull();
    expect(decideOrderTracking(cfg, both, req("bs_cart_count=1"))).toBeNull();
    expect(decideOrderTracking(cfg, both, req(cookies("abcd1234.00")))).toBeNull();
    expect(decideOrderTracking(cfg, both, req(cookies("old00000.11")))).toBeNull();
    expect(decideOrderTracking(cfg, { metaAccessTokenSet: false, ga4ApiSecretSet: false }, req(cookies("abcd1234.11")))).toBeNull();
  });

  it("marketing consent means Meta only, with request details; analytics consent means GA4 only, with no request details", () => {
    const m = decideOrderTracking(cfg, both, req(cookies("abcd1234.01")))!;
    expect(m).toMatchObject({ metaStatus: "pending", ga4Status: "skipped", clientIp: "203.0.113.7", fbp: "fb.1.1700000000.123456789", gaClientId: null });
    const a = decideOrderTracking(cfg, both, req(cookies("abcd1234.10")))!;
    expect(a).toMatchObject({ metaStatus: "skipped", ga4Status: "pending", clientIp: null, userAgent: null, fbp: null, gaClientId: "1234567890.1700000000" });
  });

  it("GA4 needs the visitor's _ga cookie, and a platform whose id is gone is not used", () => {
    const noGa = decideOrderTracking(cfg, both, req("bs_consent=abcd1234.10"));
    expect(noGa).toBeNull();
    const noPixel = decideOrderTracking({ ...cfg, pixel: null }, both, req(cookies("abcd1234.11")))!;
    expect(noPixel).toMatchObject({ metaStatus: "skipped", ga4Status: "pending" });
  });

  it("rejects malformed browser ids instead of storing them", () => {
    const row = decideOrderTracking(cfg, both, req("bs_consent=abcd1234.01; _fbp=<script>alert(1)</script>"))!;
    expect(row.fbp).toBeNull();
  });
});

describe("payloads", () => {
  it("hashes email and phone as Meta expects, and never sends them in the clear", () => {
    expect(hashedEmail(" Buyer@Example.com ")).toBe(sha256Hex("buyer@example.com"));
    expect(hashedPhone("98765 43210", "INR")).toBe(sha256Hex("919876543210"));
    expect(hashedPhone("+1 (415) 555-0132", "USD")).toBe(sha256Hex("14155550132"));
    expect(hashedPhone("12", "INR")).toBeNull();
    const p = buildMetaPurchasePayload(order, { clientIp: "203.0.113.7", userAgent: "UA", fbp: "fb.1.1.2", fbc: null, gaClientId: null, sourceUrl: "https://shop.test/checkout" }, "TEST123", "TOKEN-VALUE-0123456789")!;
    const json = JSON.stringify(p.data);
    expect(json).not.toContain("buyer@example.com");
    expect(json).not.toContain("9876543210");
    expect(json).not.toContain("TOKEN-VALUE");
    expect(p.test_event_code).toBe("TEST123");
    expect(p.data[0]).toMatchObject({
      event_name: "Purchase", event_id: "#1042", event_time: Math.floor(new Date("2026-11-15T10:00:00Z").getTime() / 1000), action_source: "website",
      custom_data: { currency: "INR", value: 1299, order_id: "#1042", num_items: 2, content_ids: ["TEA-50"] },
    });
    expect(p.data[0]!.user_data).toMatchObject({ em: [sha256Hex("buyer@example.com")], client_ip_address: "203.0.113.7", fbp: "fb.1.1.2" });
  });

  it("GA4 gets the transaction id and no personal data", () => {
    const p = buildGa4PurchasePayload(order, "1234567890.1700000000")!;
    expect(p).toMatchObject({ client_id: "1234567890.1700000000", events: [{ name: "purchase", params: { transaction_id: "#1042", value: 1299, shipping: 50, currency: "INR" } }] });
    expect(JSON.stringify(p)).not.toMatch(/buyer|9876543210/i);
  });

  it("cancelled orders produce no payload", () => {
    expect(buildMetaPurchasePayload({ ...order, status: "cancelled" }, { clientIp: null, userAgent: null, fbp: null, fbc: null, gaClientId: null, sourceUrl: null }, null, "t")).toBeNull();
    expect(buildGa4PurchasePayload({ ...order, status: "cancelled" }, "1.2")).toBeNull();
  });
});

describe("sending", () => {
  const meta = buildMetaPurchasePayload(order, { clientIp: null, userAgent: null, fbp: null, fbc: null, gaClientId: null, sourceUrl: null }, null, "SECRET-ACCESS-TOKEN-123")!;
  const ga4 = buildGa4PurchasePayload(order, "1.2")!;
  const reply = (status: number, body = "") => vi.fn(async () => new Response(status === 204 ? null : body, { status })) as unknown as typeof fetch;

  it("Meta: token in the body not the URL; 2xx ok; 4xx final; 5xx and 429 retryable; token redacted from messages", async () => {
    const ok = reply(200, "{}");
    expect(await sendMetaPurchase(ok, "1234567890123456", meta)).toEqual({ ok: true });
    const [url, init] = (ok as unknown as { mock: { calls: Array<[string, RequestInit]> } }).mock.calls[0]!;
    expect(url).toBe("https://graph.facebook.com/v21.0/1234567890123456/events");
    expect(url).not.toContain("SECRET");
    expect(String(init.body)).toContain("SECRET-ACCESS-TOKEN-123");

    const bad = await sendMetaPurchase(reply(400, JSON.stringify({ error: { message: "Invalid token SECRET-ACCESS-TOKEN-123" } })), "1234567890123456", meta);
    expect(bad).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(bad)).not.toContain("SECRET-ACCESS-TOKEN-123");
    expect(await sendMetaPurchase(reply(503), "1234567890123456", meta)).toMatchObject({ ok: false, retryable: true });
    expect(await sendMetaPurchase(reply(429), "1234567890123456", meta)).toMatchObject({ ok: false, retryable: true });
  });

  it("GA4: secret in the query string only, never in a recorded failure; network errors are retryable and generic", async () => {
    const ok = reply(204);
    expect(await sendGa4Purchase(ok, "G-TEST12345", "ga-secret-value", ga4)).toEqual({ ok: true });
    const url = (ok as unknown as { mock: { calls: Array<[string]> } }).mock.calls[0]![0];
    expect(url).toBe("https://www.google-analytics.com/mp/collect?measurement_id=G-TEST12345&api_secret=ga-secret-value");

    const bad = await sendGa4Purchase(reply(400, "bad ga-secret-value"), "G-TEST12345", "ga-secret-value", ga4);
    expect(bad).toMatchObject({ ok: false, retryable: false });
    expect(JSON.stringify(bad)).not.toContain("ga-secret-value");

    const down = vi.fn(async () => {
      throw new TypeError("fetch failed: https://www.google-analytics.com/mp/collect?api_secret=ga-secret-value");
    }) as unknown as typeof fetch;
    const net = await sendGa4Purchase(down, "G-TEST12345", "ga-secret-value", ga4);
    expect(net).toMatchObject({ ok: false, retryable: true });
    expect(JSON.stringify(net)).not.toContain("ga-secret-value");
  });
});

describe("add to cart and begin checkout from the server (Meta only)", () => {
  const meta = { metaAccessTokenSet: true };

  it("needs marketing consent of the current revision, a Pixel ID and a saved token", () => {
    expect(decideEventTracking(cfg, meta, req(cookies("abcd1234.01")))).toMatchObject({ clientIp: "203.0.113.7", fbp: "fb.1.1700000000.123456789" });
    expect(decideEventTracking(cfg, meta, req(cookies("abcd1234.10")))).toBeNull(); // analytics only
    expect(decideEventTracking(cfg, meta, req(cookies("abcd1234.00")))).toBeNull();
    expect(decideEventTracking(cfg, meta, req(cookies("old00000.11")))).toBeNull();
    expect(decideEventTracking(cfg, meta, req("bs_cart_count=1"))).toBeNull();
    expect(decideEventTracking(cfg, { metaAccessTokenSet: false }, req(cookies("abcd1234.11")))).toBeNull();
    expect(decideEventTracking({ ...cfg, pixel: null }, meta, req(cookies("abcd1234.11")))).toBeNull();
    expect(decideEventTracking(null, meta, req(cookies("abcd1234.11")))).toBeNull();
  });

  it("the payload carries the shared event id, items and request details, and no personal data", () => {
    const row = decideEventTracking(cfg, meta, req(cookies("abcd1234.11")))!;
    const p = buildMetaEventPayload(
      { name: "AddToCart", eventId: "atc_123", eventTime: new Date("2026-11-15T10:00:00Z"), currency: "INR", value: 2398, items: [{ id: "TEA-50", quantity: 2, price: 1199 }] },
      row,
      "TEST123",
      "TOKEN-VALUE-0123456789",
    );
    expect(p.test_event_code).toBe("TEST123");
    const ev = (p["data"] as Array<Record<string, unknown>>)[0]!;
    expect(ev).toMatchObject({ event_name: "AddToCart", event_id: "atc_123", action_source: "website", custom_data: { value: 2398, num_items: 2, content_ids: ["TEA-50"] } });
    expect(JSON.stringify(ev)).not.toMatch(/"em"|"ph"/);
  });
});
