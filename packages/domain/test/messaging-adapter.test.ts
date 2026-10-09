import { describe, expect, it, beforeEach } from "vitest";
import { ZohoCPaaSAdapter, _resetRateLimits } from "../src/system/messaging/zoho-cpaas.ts";
import { maskPhoneNumber, cleanPhoneNumber } from "../src/system/messaging/masking.ts";

describe("ZohoCPaaSAdapter (SMS and WhatsApp with faked HTTP)", () => {
  beforeEach(() => {
    _resetRateLimits();
  });

  describe("maskPhoneNumber and cleanPhoneNumber", () => {
    it("masks phone numbers keeping only the last 4 digits", () => {
      expect(maskPhoneNumber("+919876543210")).toBe("********3210");
      expect(maskPhoneNumber("9876543210")).toBe("******3210");
      expect(maskPhoneNumber("1234")).toBe("****1234");
      expect(maskPhoneNumber("")).toBe("******");
    });

    it("cleans phone numbers to digits and optional leading plus", () => {
      expect(cleanPhoneNumber("+91 98765-43210")).toBe("+919876543210");
      expect(cleanPhoneNumber(" (022) 2345 6789 ")).toBe("02223456789");
    });
  });

  describe("refuses send if not enrolled (missing or empty token)", () => {
    it("returns ok: false with clear not-enrolled error for SMS", async () => {
      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: null,
        config: { senderKey: "MY_SENDER" },
      });

      const res = await adapter.send({
        to: "+919876543210",
        template: "order_confirmation",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not enrolled/i);
      expect(res.maskedRecipient).toBe("********3210");
    });

    it("returns ok: false with clear not-enrolled error for WhatsApp", async () => {
      const adapter = new ZohoCPaaSAdapter({
        channel: "whatsapp",
        token: "   ",
        config: { fromNumber: "+919876543210" },
      });

      const res = await adapter.send({
        to: "+919876543210",
        template: "welcome",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/not enrolled/i);
    });
  });

  describe("SMS dispatch with faked HTTP", () => {
    it("sends POST to /sms with exact headers and JSON payload", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const fakeFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ message_id: "sms_msg_12345" }],
            message: "Success",
          }),
        } as unknown as Response;
      };

      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: "zoho-test-sms-token-xyz",
        config: {
          baseUrl: "https://cpaas.zoho.com/v1.1",
          senderKey: "BRANDSEWA_SMS",
          templateMap: {
            otp_verification: "tmpl_zoho_otp_001",
          },
        },
        fetchFn: fakeFetch,
      });

      const res = await adapter.send({
        to: "+91 98765 43210",
        template: "otp_verification",
        variables: { code: "654321" },
      });

      expect(res.ok).toBe(true);
      expect(res.providerMessageId).toBe("sms_msg_12345");
      expect(res.maskedRecipient).toBe("********3210");

      // Verify URL
      expect(capturedUrl).toBe("https://cpaas.zoho.com/v1.1/sms");

      // Verify Headers
      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Content-Type"]).toBe("application/json");
      expect(headers["Accept"]).toBe("application/json");
      expect(headers["Authorization"]).toBe("zoho-test-sms-token-xyz");

      // Verify Body shape matches Zoho CPaaS SMS API specification
      const body = JSON.parse(capturedInit?.body as string);
      expect(body).toEqual({
        sender_key: "BRANDSEWA_SMS",
        template_key: "tmpl_zoho_otp_001",
        to: [{ mobile_no: "+919876543210" }],
        merge_info: { code: "654321" },
      });
    });
  });

  describe("WhatsApp dispatch with faked HTTP", () => {
    it("sends POST to /whatsapp with exact headers and JSON payload", async () => {
      let capturedUrl = "";
      let capturedInit: RequestInit | undefined;

      const fakeFetch: typeof fetch = async (input, init) => {
        capturedUrl = String(input);
        capturedInit = init;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: [{ message_id: "wa_msg_98765" }],
            message: "Accepted",
          }),
        } as unknown as Response;
      };

      const adapter = new ZohoCPaaSAdapter({
        channel: "whatsapp",
        token: "zoho-test-wa-token-abc",
        config: {
          baseUrl: "https://cpaas.zoho.com/v1.1",
          fromNumber: "+918000011111",
          templateMap: {
            order_shipped: "tmpl_zoho_wa_shipped",
          },
        },
        fetchFn: fakeFetch,
      });

      const res = await adapter.send({
        to: "+91 99999 88888",
        template: "order_shipped",
        variables: { tracking_url: "https://track.bcom.si/123" },
      });

      expect(res.ok).toBe(true);
      expect(res.providerMessageId).toBe("wa_msg_98765");
      expect(res.maskedRecipient).toBe("********8888");

      expect(capturedUrl).toBe("https://cpaas.zoho.com/v1.1/whatsapp");

      const headers = capturedInit?.headers as Record<string, string>;
      expect(headers["Authorization"]).toBe("zoho-test-wa-token-abc");

      // Verify Body shape matches Zoho CPaaS WhatsApp API specification
      const body = JSON.parse(capturedInit?.body as string);
      expect(body).toEqual({
        from: "+918000011111",
        to: "+919999988888",
        template_key: "tmpl_zoho_wa_shipped",
        merge_info: { tracking_url: "https://track.bcom.si/123" },
      });
    });
  });

  describe("Per-recipient rate limiting", () => {
    it("blocks dispatches exceeding 5 messages per minute for the same recipient", async () => {
      const fakeFetch: typeof fetch = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ message_id: "msg" }] }),
        }) as unknown as Response;

      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: "test-token",
        config: { senderKey: "TEST" },
        fetchFn: fakeFetch,
      });

      const phone = "+919123456789";

      // 5 requests succeed
      for (let i = 0; i < 5; i++) {
        const res = await adapter.send({ to: phone, template: "test" });
        expect(res.ok).toBe(true);
      }

      // 6th request fails with rate limit error
      const rateLimitedRes = await adapter.send({ to: phone, template: "test" });
      expect(rateLimitedRes.ok).toBe(false);
      expect(rateLimitedRes.error).toMatch(/rate limit exceeded/i);

      // A different phone number can still send
      const otherRes = await adapter.send({ to: "+919988776655", template: "test" });
      expect(otherRes.ok).toBe(true);
    });
  });

  describe("Configuration requirements and fallback prevention", () => {
    it("refuses SMS dispatch when senderKey is not configured", async () => {
      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: "valid-token",
        config: {},
      });

      const res = await adapter.send({
        to: "+919876543210",
        template: "otp",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/sender key is not configured/i);
    });

    it("refuses WhatsApp dispatch when fromNumber is not configured", async () => {
      const adapter = new ZohoCPaaSAdapter({
        channel: "whatsapp",
        token: "valid-token",
        config: {},
      });

      const res = await adapter.send({
        to: "+919876543210",
        template: "welcome",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/from phone number is not configured/i);
    });

    it("refuses test dispatch when no test template is configured", async () => {
      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: "valid-token",
        config: { senderKey: "TEST" },
      });

      const res = await adapter.test({ to: "+919876543210" });
      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/test template key is not configured/i);
    });

    it("refuses dispatch when template is unmapped and templateMap is present", async () => {
      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: "valid-token",
        config: {
          senderKey: "TEST",
          templateMap: { order_confirmation: "tmpl_1" },
        },
      });

      const res = await adapter.send({
        to: "+919876543210",
        template: "order_cancelled",
      });

      expect(res.ok).toBe(false);
      expect(res.error).toMatch(/template key for "order_cancelled" is not configured/i);
    });
  });

  describe("Unknown success response body handling (UNCONFIRMED schema)", () => {
    it("treats unknown 2xx body as success without provider message ID", async () => {
      const fakeFetch: typeof fetch = async () =>
        ({
          ok: true,
          status: 200,
          json: async () => ({ status: "accepted", custom_unrecognized_prop: 123 }),
        }) as unknown as Response;

      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: "test-token",
        config: { senderKey: "TEST", testTemplateKey: "TEST_TMPL" },
        fetchFn: fakeFetch,
      });

      const res = await adapter.test({ to: "+919876543210" });
      expect(res.ok).toBe(true);
      expect(res.providerMessageId).toBeNull();
    });
  });

  describe("Error sanitisation and secrets containment", () => {
    it("redacts auth tokens and credentials from error responses", async () => {
      const sensitiveToken = "secret_raw_token_value_xyz";
      const fakeFetch: typeof fetch = async () =>
        ({
          ok: false,
          status: 401,
          statusText: "Unauthorized",
          json: async () => ({
            error: { message: `Invalid authentication header with ${sensitiveToken} and Zoho-enczapikey token123` },
          }),
        }) as unknown as Response;

      const adapter = new ZohoCPaaSAdapter({
        channel: "sms",
        token: sensitiveToken,
        config: { senderKey: "TEST" },
        fetchFn: fakeFetch,
      });

      const res = await adapter.send({ to: "+919876543210", template: "test" });
      expect(res.ok).toBe(false);
      expect(res.error).not.toContain(sensitiveToken);
      expect(res.error).toContain("[REDACTED]");
    });
  });
});
