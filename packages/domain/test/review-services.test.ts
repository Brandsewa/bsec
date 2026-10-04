import { describe, expect, it } from "vitest";
import { sanitizePlainText } from "../src/review-services.ts";

describe("Review Services Unit Tests", () => {
  describe("sanitizePlainText", () => {
    it("strips html tags cleanly", () => {
      const input = "<script>alert('pwned')</script>Hello <b>World</b>!";
      const clean = sanitizePlainText(input);
      expect(clean).toBe("Hello World!");
    });

    it("strips links and urls from reviews to prevent spam", () => {
      const input = "Great product! Visit https://spam-casino.example.com for discounts, or http://promo.org";
      const clean = sanitizePlainText(input);
      expect(clean).toBe("Great product! Visit for discounts, or");
    });

    it("handles multiple consecutive newlines and spaces", () => {
      const input = "Line 1\n\n\n\nLine 2   with   spaces";
      const clean = sanitizePlainText(input);
      expect(clean).toBe("Line 1\n\nLine 2 with spaces");
    });
  });
});
