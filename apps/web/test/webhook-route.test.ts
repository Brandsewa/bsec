import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { POST } from "../src/app/api/webhooks/[provider]/route.ts";
import { processWebhookInboxItem } from "@bs/domain";

// Mock server-only before importing runtime
vi.mock("server-only", () => ({}));

const mockReceiveWebhook = vi.fn();
const mockGetTenantPaymentSecrets = vi.fn();
const mockCheckWebhookRateLimit = vi.fn();
const mockResolveWebhookTenant = vi.fn();

vi.mock("@bs/domain", async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    receiveWebhook: (...args: unknown[]) => mockReceiveWebhook(...args),
    getTenantPaymentSecrets: (...args: unknown[]) => mockGetTenantPaymentSecrets(...args),
    checkWebhookRateLimit: (...args: unknown[]) => mockCheckWebhookRateLimit(...args),
    resolveWebhookTenant: (...args: unknown[]) => mockResolveWebhookTenant(...args),
  };
});

const RZP_SECRET = "rzp_webhook_secret_key_12345";
const COD_SECRET = "cod_webhook_secret_key_67890";
const TENANT_ID = "0199a000-0000-7000-8000-000000000001";

describe("Webhook Route Handler End-to-End Signature Verification & Processing Chain (PLAN §11.4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Configure global server runtime stub without touching database drivers directly
    (globalThis as Record<string, unknown>).__bsWeb = {
      rt: {
        service: "web",
        _db: { db: {} },
        close: async () => {},
      },
      log: {
        info: vi.fn(),
        error: vi.fn(),
        warn: vi.fn(),
      },
    };

    mockCheckWebhookRateLimit.mockResolvedValue(undefined);
    mockResolveWebhookTenant.mockImplementation(async (_db: unknown, params: { claimedTenantId?: string }) => {
      return { tenantId: params.claimedTenantId || TENANT_ID, verified: true };
    });
    mockReceiveWebhook.mockResolvedValue({ duplicate: false, inboxId: "inbox_rec_001" });
    mockGetTenantPaymentSecrets.mockImplementation(async (_db: unknown, _tenantId: string, provider: string) => {
      if (provider === "razorpay") return { webhookSecret: RZP_SECRET };
      if (provider === "cod") return { webhookSecret: COD_SECRET };
      return {};
    });
  });

  it("SECURITY: rejects forged Razorpay webhook through route -> inbox -> processor chain", async () => {
    const rawBody = JSON.stringify({
      event: "payment.captured",
      event_id: "evt_rzp_forged_999",
      payload: {
        payment: {
          entity: {
            id: "pay_forged_999",
            order_id: "ord_101",
            notes: { tenant_id: TENANT_ID, order_id: "ord_101" },
          },
        },
      },
    });

    const forgedSignature = "forged_razorpay_signature_which_fails_timing_safe_hmac_check_0000";

    const req = new Request(`http://localhost:3000/api/webhooks/razorpay?tenantId=${TENANT_ID}`, {
      method: "POST",
      headers: {
        "x-razorpay-signature": forgedSignature,
        "content-type": "application/json",
      },
      body: rawBody,
    });

    // 1. Route handler executes real RazorpayProvider HMAC verification
    const res = await POST(req, { params: Promise.resolve({ provider: "razorpay" }) });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.received).toBe(true);

    // 2. Inbox receives the record with signatureValid = false (SECURITY GATE)
    expect(mockReceiveWebhook).toHaveBeenCalledTimes(1);
    const receivedInput = mockReceiveWebhook.mock.calls[0]?.[1];
    expect(receivedInput).toBeDefined();
    expect(receivedInput.provider).toBe("razorpay");
    expect(receivedInput.signatureValid).toBe(false);
    expect(receivedInput.eventId).toBe("evt_rzp_forged_999");
    expect(receivedInput.tenantId).toBe(TENANT_ID);

    // 3. Processor rejects items with signatureValid = false before touching business logic
    const mockDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "inbox_rec_001",
            provider: "razorpay",
            event_id: "evt_rzp_forged_999",
            tenant_id: TENANT_ID,
            signature_valid: false,
            payload_sanitized: JSON.parse(rawBody),
            status: "processing",
          },
        ],
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const processRes = await processWebhookInboxItem(mockDb as never, "inbox_rec_001");
    expect(processRes.success).toBe(false);
    expect(processRes.error).toBe("Invalid webhook signature");
  });

  it("SECURITY: rejects forged COD webhook through route before touching business logic", async () => {
    const rawBody = JSON.stringify({
      event: "cod.confirmed",
      event_id: "evt_cod_forged_888",
      order_id: "ord_102",
      tenant_id: TENANT_ID,
    });

    // Compute forged HMAC signature with wrong attacker secret
    const forgedCodSig = createHmac("sha256", "attacker_wrong_secret_666").update(rawBody).digest("hex");

    const req = new Request(`http://localhost:3000/api/webhooks/cod?tenantId=${TENANT_ID}`, {
      method: "POST",
      headers: {
        "x-cod-signature": forgedCodSig,
        "content-type": "application/json",
      },
      body: rawBody,
    });

    // 1. Route handler executes real CODProvider HMAC verification
    const res = await POST(req, { params: Promise.resolve({ provider: "cod" }) });
    expect(res.status).toBe(200);

    // 2. Verified signatureValid is false
    expect(mockReceiveWebhook).toHaveBeenCalledTimes(1);
    const receivedInput = mockReceiveWebhook.mock.calls[0]?.[1];
    expect(receivedInput).toBeDefined();
    expect(receivedInput.provider).toBe("cod");
    expect(receivedInput.signatureValid).toBe(false);
    expect(receivedInput.eventId).toBe("evt_cod_forged_888");

    // 3. Processor rejects item before touching business logic
    const mockDb = {
      execute: vi.fn().mockResolvedValue({
        rows: [
          {
            id: "inbox_rec_002",
            provider: "cod",
            event_id: "evt_cod_forged_888",
            tenant_id: TENANT_ID,
            signature_valid: false,
            payload_sanitized: JSON.parse(rawBody),
            status: "processing",
          },
        ],
      }),
      update: vi.fn().mockReturnValue({
        set: vi.fn().mockReturnValue({
          where: vi.fn().mockResolvedValue([]),
        }),
      }),
    };

    const processRes = await processWebhookInboxItem(mockDb as never, "inbox_rec_002");
    expect(processRes.success).toBe(false);
    expect(processRes.error).toBe("Invalid webhook signature");
  });

  it("processes valid COD webhook: verifies signature and sets signatureValid = true", async () => {
    const rawBody = JSON.stringify({
      event: "cod.confirmed",
      event_id: "evt_cod_valid_777",
      order_id: "ord_103",
      tenant_id: TENANT_ID,
    });

    // Compute legitimate HMAC-SHA256 signature using the tenant's COD_SECRET
    const validCodSig = createHmac("sha256", COD_SECRET).update(rawBody).digest("hex");

    const req = new Request(`http://localhost:3000/api/webhooks/cod?tenantId=${TENANT_ID}`, {
      method: "POST",
      headers: {
        "x-cod-signature": validCodSig,
        "content-type": "application/json",
      },
      body: rawBody,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "cod" }) });
    expect(res.status).toBe(200);

    expect(mockReceiveWebhook).toHaveBeenCalledTimes(1);
    const receivedInput = mockReceiveWebhook.mock.calls[0]?.[1];
    expect(receivedInput.signatureValid).toBe(true);
    expect(receivedInput.provider).toBe("cod");
  });

  it("processes valid Razorpay webhook: verifies signature and sets signatureValid = true", async () => {
    const rawBody = JSON.stringify({
      event: "payment.captured",
      event_id: "evt_rzp_valid_555",
      payload: {
        payment: {
          entity: {
            id: "pay_valid_555",
            order_id: "ord_104",
            notes: { tenant_id: TENANT_ID, order_id: "ord_104" },
          },
        },
      },
    });

    // Compute legitimate HMAC-SHA256 signature using the tenant's RZP_SECRET
    const validRzpSig = createHmac("sha256", RZP_SECRET).update(rawBody).digest("hex");

    const req = new Request(`http://localhost:3000/api/webhooks/razorpay?tenantId=${TENANT_ID}`, {
      method: "POST",
      headers: {
        "x-razorpay-signature": validRzpSig,
        "content-type": "application/json",
      },
      body: rawBody,
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "razorpay" }) });
    expect(res.status).toBe(200);

    expect(mockReceiveWebhook).toHaveBeenCalledTimes(1);
    const receivedInput = mockReceiveWebhook.mock.calls[0]?.[1];
    expect(receivedInput.signatureValid).toBe(true);
    expect(receivedInput.provider).toBe("razorpay");
  });

  it("SECURITY: rejects unknown provider with signatureValid = false", async () => {
    const req = new Request(`http://localhost:3000/api/webhooks/unknown_provider?tenantId=${TENANT_ID}`, {
      method: "POST",
      headers: {
        "x-some-signature": "arbitrary_signature",
        "content-type": "application/json",
      },
      body: JSON.stringify({ event: "test" }),
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "unknown_provider" }) });
    expect(res.status).toBe(200);

    expect(mockReceiveWebhook).toHaveBeenCalledTimes(1);
    const receivedInput = mockReceiveWebhook.mock.calls[0]?.[1];
    expect(receivedInput.signatureValid).toBe(false);
  });

  it("returns 429 when checkWebhookRateLimit throws RateLimitExceededError", async () => {
    const { RateLimitExceededError } = await import("@bs/domain");
    mockCheckWebhookRateLimit.mockRejectedValueOnce(
      new RateLimitExceededError("Rate limit exceeded", 45, 300, "rate:webhook:razorpay:127.0.0.1"),
    );

    const req = new Request(`http://localhost:3000/api/webhooks/razorpay?tenantId=${TENANT_ID}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({ event: "payment.captured" }),
    });

    const res = await POST(req, { params: Promise.resolve({ provider: "razorpay" }) });
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("45");
    const json = await res.json();
    expect(json.error).toBe("Rate limit exceeded");
  });
});
