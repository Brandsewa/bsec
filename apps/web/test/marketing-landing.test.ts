import { describe, expect, it } from "vitest";
import { DEMO_SEARCHES, NEGOTIATION, bundleDiscount, searchAt } from "../src/components/marketing/landing/demo-data.ts";
import { FAQS, FALLBACK_PLANS, INCLUDED_IN_ALL, STEPS, planBullets } from "../src/components/marketing/landing/content.ts";

describe("marketing landing demo data", () => {
  it("every search offers three products from different brands and a valid pick", () => {
    expect(DEMO_SEARCHES.length).toBeGreaterThanOrEqual(3);
    for (const s of DEMO_SEARCHES) {
      expect(s.products).toHaveLength(3);
      expect(new Set(s.products.map((p) => p.brand)).size).toBe(3);
      expect([0, 1, 2]).toContain(s.pick);
      expect(s.query.length).toBeGreaterThan(3);
    }
  });

  it("searchAt wraps instead of reading past the end", () => {
    expect(searchAt(DEMO_SEARCHES.length)).toBe(DEMO_SEARCHES[0]);
    expect(searchAt(0)).toBe(DEMO_SEARCHES[0]);
  });

  it("covers the three assistants shown in the hero tabs", () => {
    expect(DEMO_SEARCHES.map((s) => s.assistant)).toEqual(["ChatGPT", "Gemini", "Claude"]);
  });
});

describe("negotiation demo rules", () => {
  it("gives no discount under 5 pieces, 5% from 5 and 10% from 12", () => {
    expect(bundleDiscount(1)).toBe(0);
    expect(bundleDiscount(4)).toBe(0);
    expect(bundleDiscount(5)).toBe(5);
    expect(bundleDiscount(11)).toBe(5);
    expect(bundleDiscount(12)).toBe(10);
    expect(bundleDiscount(40)).toBe(10);
  });

  it("offers maximum-discount choices that include the buyer's ask", () => {
    expect(NEGOTIATION.maxChoices).toContain(NEGOTIATION.buyerAsks);
  });
});

describe("marketing landing content", () => {
  it("keeps plan bullets driven by the plan limits", () => {
    const starter = FALLBACK_PLANS[0];
    expect(starter).toBeDefined();
    const bullets = planBullets(starter?.limits ?? {});
    expect(bullets).toContain("Up to 500 products");
    expect(bullets.some((b) => b.includes("custom domain"))).toBe(true);
  });

  it("has a four-step launch and an AI-ready line in every plan", () => {
    expect(STEPS).toHaveLength(4);
    expect(INCLUDED_IN_ALL[0]).toBe("AI-ready store layer");
  });

  it("has unique, non-empty FAQ entries", () => {
    expect(new Set(FAQS.map((f) => f.q)).size).toBe(FAQS.length);
    for (const f of FAQS) {
      expect(f.q.length).toBeGreaterThan(5);
      expect(f.a.length).toBeGreaterThan(20);
    }
  });
});
