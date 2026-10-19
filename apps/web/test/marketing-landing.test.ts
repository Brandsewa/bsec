import { existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DEMO_SEARCHES, searchAt } from "../src/components/marketing/landing/demo-data.ts";
import { FAQS, FALLBACK_PLANS, planBullets } from "../src/components/marketing/landing/content.ts";
import { ADDRESS_LINE, MARKETING_PAGES, SITE } from "../src/components/marketing/landing/site-info.ts";

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

describe("marketing landing content", () => {
  it("keeps plan bullets driven by the plan limits", () => {
    const starter = FALLBACK_PLANS[0];
    expect(starter).toBeDefined();
    const bullets = planBullets(starter?.limits ?? {});
    expect(bullets).toContain("Up to 500 products");
    expect(bullets.some((b) => b.includes("custom domain"))).toBe(true);
  });

  it("has unique, non-empty FAQ entries", () => {
    expect(new Set(FAQS.map((f) => f.q)).size).toBe(FAQS.length);
    for (const f of FAQS) {
      expect(f.q.length).toBeGreaterThan(5);
      expect(f.a.length).toBeGreaterThan(20);
    }
  });
});

describe("marketing site pages (payment gateway review)", () => {
  const required = ["/about", "/contact", "/pricing", "/terms", "/privacy", "/refund-policy", "/shipping-policy"];

  it("lists every page a payment gateway reviewer expects, once each", () => {
    const paths = MARKETING_PAGES.map((p) => p.path);
    for (const r of required) expect(paths).toContain(r);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("has a page and a sibling loading file for every listed page", () => {
    for (const { path } of MARKETING_PAGES) {
      const dir = join(__dirname, "..", "src", "app", path);
      expect(existsSync(join(dir, "page.tsx")), `${path} page.tsx`).toBe(true);
      expect(existsSync(join(dir, "loading.tsx")), `${path} loading.tsx`).toBe(true);
    }
  });

  it("states the company details completely, with no placeholders", () => {
    expect(SITE.legalName).toBe("Brand Sewa Digital Private Limited");
    expect(SITE.cin).toMatch(/^[LU]\d{5}[A-Z]{2}\d{4}[A-Z]{3}\d{6}$/);
    expect(SITE.gstin).toMatch(/^\d{2}[A-Z]{5}\d{4}[A-Z]\dZ[A-Z\d]$/);
    expect(SITE.emails.support).toMatch(/^[^@\s]+@bcom\.si$/);
    expect(SITE.grievance.email).toContain("@");
    expect(SITE.grievance.name.length).toBeGreaterThan(2);
    expect(ADDRESS_LINE).toContain("734101");
    const text = JSON.stringify(SITE) + ADDRESS_LINE;
    expect(text).not.toMatch(/TODO|TBD|lorem|xxx|\[.*\]/i);
  });
});
