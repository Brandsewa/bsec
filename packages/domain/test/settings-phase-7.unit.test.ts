import { describe, expect, it } from "vitest";
import { validatePolicyContent, type PolicyBlock } from "../src/policies/validator.ts";
import { hasStarterPlaceholders, POLICY_STARTERS } from "../src/policies/starters.ts";
import { hashConsentIp } from "../src/customers/consent.ts";
import { TEST_LOCKED_COOKIE_INVENTORY } from "../src/privacy/service.ts";
import { parseNotificationPreferences } from "../src/system/email-classes.ts";

describe("Phase 7 Unit Tests", () => {
  describe("7A: Notification Preferences Parser", () => {
    it("defaults equal today's behavior with all transactional emails on", () => {
      const parsed = parseNotificationPreferences({});
      expect(parsed.v).toBe(1);
      expect(parsed.customer.orderConfirmation).toBe(true);
      expect(parsed.customer.shipment).toBe(true);
      expect(parsed.customer.delivery).toBe(true);
      expect(parsed.customer.cancellation).toBe(true);
      expect(parsed.customer.refund).toBe(true);
      expect(parsed.customer.returnUpdates).toBe(true);
      expect(parsed.customer.preorderReminders).toBe(true);
      expect(parsed.customer.accountSecurity).toBe(true);
      expect(parsed.channels.email).toBe(true);
      expect(parsed.staff.newOrder.enabled).toBe(false);
    });

    it("locks accountSecurity to true even if attempted to disable", () => {
      const parsed = parseNotificationPreferences({
        customer: {
          accountSecurity: false,
        },
      });
      expect(parsed.customer.accountSecurity).toBe(true);
    });

    it("sanitizes sender display name and strips address-like strings", () => {
      const parsed = parseNotificationPreferences({
        sender: {
          displayName: "Fake <spoof@bcom.si>",
          replyToEmail: "support@store.com",
        },
      });
      expect(parsed.sender.displayName).toBe("Fake");
      expect(parsed.sender.replyToEmail).toBe("support@store.com");
    });
  });

  describe("7B: Policy Block Validator", () => {
    it("validates valid blocks structure and computes sha256", () => {
      const validBlocks = [
        { type: "heading" as const, level: 2 as const, text: "Privacy Policy" },
        { type: "paragraph" as const, text: "We respect your data." },
        { type: "divider" as const },
        { type: "list" as const, style: "unordered" as const, items: ["Item 1", "Item 2"] },
      ];

      const res = validatePolicyContent({ v: 1, blocks: validBlocks });
      expect(res.valid).toBe(true);
      if (res.valid) {
        expect(res.sha256).toBeDefined();
        expect(typeof res.sha256).toBe("string");
      }
    });

    it("rejects unknown block types", () => {
      const invalid = [
        { type: "raw_html", content: "<script>alert(1)</script>" },
      ];
      const res = validatePolicyContent({ v: 1, blocks: invalid as unknown as PolicyBlock[] });
      expect(res.valid).toBe(false);
    });

    it("rejects non-https/mailto links in paragraphs", () => {
      const unsafeLink = [
        {
          type: "paragraph",
          text: "Click here",
          marks: [{ type: "link", start: 0, end: 5, href: "javascript:alert(1)" }],
        },
      ];
      const res = validatePolicyContent({ v: 1, blocks: unsafeLink as unknown as PolicyBlock[] });
      expect(res.valid).toBe(false);
      if (!res.valid) {
        expect(res.error).toContain("https:, mailto:, or tel:");
      }
    });

    it("rejects blocks exceeding length limits", () => {
      const longText = "a".repeat(2500);
      const res = validatePolicyContent({
        v: 1,
        blocks: [{ type: "paragraph", text: longText }],
      });
      expect(res.valid).toBe(false);
    });
  });

  describe("7B: Starter Policies & Placeholder Detection", () => {
    it("identifies unreplaced placeholders in starter drafts", () => {
      const starter = POLICY_STARTERS.refund;
      expect(starter).toBeDefined();
      expect(hasStarterPlaceholders(starter.content).hasPlaceholders).toBe(true);
    });

    it("returns false for blocks with all placeholders replaced and banner removed", () => {
      const cleanContent = {
        v: 1 as const,
        blocks: [
          { type: "heading" as const, level: 2 as const, text: "Refund Policy" },
          { type: "paragraph" as const, text: "All sales at Acme Inc are final within 14 days." },
        ],
      };
      expect(hasStarterPlaceholders(cleanContent).hasPlaceholders).toBe(false);
    });
  });

  describe("7C: Customer Privacy Consent IP Hashing", () => {
    it("deterministically hashes IP for a given tenant and secret", () => {
      const tenantA = "0199a099-0000-7000-8000-000000000001";
      const ip = "203.0.113.195";
      const secret = "test-secret-key-32-bytes-long-padding!!";

      const hash1 = hashConsentIp(ip, tenantA, secret);
      const hash2 = hashConsentIp(ip, tenantA, secret);
      expect(hash1).toBe(hash2);
      expect(hash1).not.toBe(ip);
      expect(hash1).toMatch(/^[a-f0-9]{64}$/);
    });

    it("produces different hashes across different tenants for the same IP", () => {
      const tenantA = "0199a099-0000-7000-8000-000000000001";
      const tenantB = "0199a099-0000-7000-8000-000000000002";
      const ip = "203.0.113.195";
      const secret = "test-secret-key-32-bytes-long-padding!!";

      const hashA = hashConsentIp(ip, tenantA, secret);
      const hashB = hashConsentIp(ip, tenantB, secret);
      expect(hashA).not.toBe(hashB);
    });
  });

  describe("7C: Cookie Inventory Guard", () => {
    it("ensures every declared cookie is strictly necessary with no tracking", () => {
      expect(TEST_LOCKED_COOKIE_INVENTORY.length).toBeGreaterThan(0);
      for (const cookie of TEST_LOCKED_COOKIE_INVENTORY) {
        expect(cookie.category).toBe("strictly_necessary");
        expect(cookie.purpose.toLowerCase()).not.toContain("analytics");
        expect(cookie.purpose.toLowerCase()).not.toContain("tracking");
        expect(cookie.purpose.toLowerCase()).not.toContain("advertising");
      }
    });
  });
});
