import { describe, expect, it } from "vitest";
import { ShiprocketProvider } from "../src/providers/shiprocket.ts";
import { ManualShippingProvider } from "../src/providers/manual.ts";
import { encryptSecret, decryptSecret } from "../src/crypto.ts";
import type { TenantContext } from "../src/types.ts";

describe("Shipping Provider Layer (PLAN §11.7, ADR-008)", () => {
  const dummyCtx: TenantContext = {
    tenantId: "0199a000-0000-7000-8000-000000000001",
    storeStatus: "live",
    roles: ["admin"],
  };

  it("encrypts and decrypts Shiprocket credentials securely using AES-256-GCM", () => {
    const rawSecret = "my_shiprocket_api_key_123456";
    const encrypted = encryptSecret(rawSecret);
    expect(encrypted.ciphertext).not.toBe(rawSecret);
    expect(encrypted.iv).toHaveLength(24); // 12 bytes hex

    const decrypted = decryptSecret(encrypted);
    expect(decrypted).toBe(rawSecret);
  });

  it("ManualShippingProvider supports serviceability and creation for kill switch", async () => {
    const provider = new ManualShippingProvider();
    const serviceability = await provider.checkServiceability(dummyCtx, {
      pickupPincode: "110001",
      deliveryPincode: "400001",
      weightGrams: 500,
      cod: false,
    });
    expect(serviceability.serviceable).toBe(true);
    expect(serviceability.rates[0]?.courierName).toBe("Standard Delivery");

    const shipment = await provider.createShipment(dummyCtx, {
      orderId: "ord_1",
      orderNumber: "ORD-001",
      pickupLocation: "Primary Warehouse",
      deliveryAddress: {
        name: "Test Customer",
        phone: "9999999999",
        addressLine1: "123 Main St",
        city: "Mumbai",
        state: "Maharashtra",
        pincode: "400001",
      },
      items: [{ name: "T-Shirt", units: 1, sellingPrice: 50000 }],
      subtotal: 50000,
      shippingFee: 0,
      total: 50000,
      paymentMethod: "prepaid",
      weightGrams: 500,
    });
    expect(shipment.providerShipmentId).toBeDefined();
  });

  it("ShiprocketProvider serializes authentic REST requests against mocked HTTP layer", async () => {
    let capturedAuthReq: { url: string; body: unknown } | undefined;
    let capturedOrderReq: { url: string; body: unknown; headers: unknown } | undefined;

    const mockFetch = async (url: string, init?: RequestInit): Promise<Response> => {
      if (url.includes("/auth/login")) {
        capturedAuthReq = { url, body: JSON.parse((init?.body as string) ?? "{}") };
        return new Response(JSON.stringify({ token: "sr_token_mock_abcdef" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (url.includes("/orders/create/adhoc")) {
        capturedOrderReq = {
          url,
          body: JSON.parse((init?.body as string) ?? "{}"),
          headers: init?.headers ?? {},
        };
        return new Response(
          JSON.stringify({
            order_id: 987654,
            shipment_id: 123456,
            status: "NEW",
            awb_code: "AWB123456789",
            courier_name: "Blue Dart",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      return new Response("Not Found", { status: 404 });
    };

    const provider = new ShiprocketProvider({
      credentials: {
        email: "store@brandsewa.com",
        password: "SecretPassword123!",
      },
      fetchFn: mockFetch,
    });

    const result = await provider.createShipment(dummyCtx, {
      orderId: "ord_100",
      orderNumber: "ORD-2026-100",
      pickupLocation: "Delhi Hub",
      deliveryAddress: {
        name: "Arjun Verma",
        phone: "9876543210",
        addressLine1: "Flat 4B, Lotus Apartments",
        city: "Bengaluru",
        state: "Karnataka",
        pincode: "560001",
      },
      items: [
        {
          name: "Premium Cotton Shirt",
          sku: "SHIRT-BLU-L",
          units: 2,
          sellingPrice: 150000,
          hsn: "6205",
        },
      ],
      subtotal: 300000,
      shippingFee: 10000,
      total: 310000,
      paymentMethod: "cod",
      weightGrams: 800,
    });

    expect(capturedAuthReq?.url).toContain("/auth/login");
    expect(capturedAuthReq?.body).toEqual({
      email: "store@brandsewa.com",
      password: "SecretPassword123!",
    });

    expect(capturedOrderReq?.url).toContain("/orders/create/adhoc");
    const sentBody = capturedOrderReq?.body as Record<string, unknown>;
    expect(sentBody.order_id).toBe("ORD-2026-100");
    expect(sentBody.payment_method).toBe("COD");
    expect(sentBody.billing_customer_name).toBe("Arjun Verma");
    expect(sentBody.billing_pincode).toBe("560001");
    expect(sentBody.weight).toBe("0.80");

    expect(result.providerShipmentId).toBe("123456");
    expect(result.awb).toBe("AWB123456789");
    expect(result.courierName).toBe("Blue Dart");
  });

  it("ShiprocketProvider verifies incoming webhook signatures accurately", async () => {
    const webhookSecret = "sr_webhook_secret_key_999";
    const provider = new ShiprocketProvider({
      credentials: { webhookSecret },
    });

    const payload = {
      awb: "AWB123456789",
      current_status: "DELIVERED",
      current_location: "Bengaluru Hub",
      scans: "Package delivered to customer",
    };
    const rawBody = JSON.stringify(payload);

    const { createHmac } = await import("node:crypto");
    const validSignature = createHmac("sha256", webhookSecret).update(rawBody).digest("hex");

    const verified = await provider.verifyWebhook(
      { "x-shiprocket-signature": validSignature },
      rawBody,
    );

    expect(verified.isValid).toBe(true);
    expect(verified.eventType).toBe("shipment.delivered");
    expect(verified.awb).toBe("AWB123456789");
    expect(verified.location).toBe("Bengaluru Hub");

    const forged = await provider.verifyWebhook(
      { "x-shiprocket-signature": "forged_signature_hex" },
      rawBody,
    );
    expect(forged.isValid).toBe(false);
  });
});
