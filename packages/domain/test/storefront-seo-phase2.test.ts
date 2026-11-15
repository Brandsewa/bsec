import { describe, expect, it } from "vitest";
import { generateOrganizationJsonLd, cleanSameAs } from "../src/storefront/seo.ts";
import { brandedTitle } from "../src/blog/seo.ts";

describe("Organization JSON-LD (Phase 2)", () => {
  it("adds an @id, logo, legal name and a contact point only when the merchant gave them", () => {
    const org = generateOrganizationJsonLd({ name: "Ricwell", url: "https://ricwell.com", logoUrl: "https://media.x/logo.png", legalName: "Ricwell Pvt Ltd", email: "hi@ricwell.com", telephone: "+91 99999 00000", sameAs: ["https://www.instagram.com/ricwell"] });
    expect(org["@id"]).toBe("https://ricwell.com/#organization");
    expect(org.logo).toBe("https://media.x/logo.png");
    expect(org.legalName).toBe("Ricwell Pvt Ltd");
    expect(org.contactPoint).toEqual({ "@type": "ContactPoint", contactType: "customer service", email: "hi@ricwell.com", telephone: "+91 99999 00000" });
    expect(org.sameAs).toEqual(["https://www.instagram.com/ricwell"]);
  });

  it("invents nothing when there is no logo, contact or profile link", () => {
    const org = generateOrganizationJsonLd({ name: "Ricwell", url: "https://ricwell.com/" });
    expect(org).not.toHaveProperty("logo");
    expect(org).not.toHaveProperty("contactPoint");
    expect(org).not.toHaveProperty("sameAs");
    expect(org).not.toHaveProperty("legalName");
    expect(org["@id"]).toBe("https://ricwell.com/#organization");
  });

  it("does not repeat the legal name when it equals the store name", () => {
    expect(generateOrganizationJsonLd({ name: "Ricwell", url: "https://r.com", legalName: "Ricwell" })).not.toHaveProperty("legalName");
  });
});

describe("cleanSameAs", () => {
  it("keeps absolute https URLs once and drops everything else", () => {
    expect(cleanSameAs(["https://a.com/x", "https://a.com/x", "http://insecure.com", "mailto:a@b.c", "not a url", 5, null])).toEqual(["https://a.com/x"]);
    expect(cleanSameAs({ ig: "https://instagram.com/r", fb: "javascript:alert(1)" })).toEqual(["https://instagram.com/r"]);
    expect(cleanSameAs(undefined)).toEqual([]);
  });
});

describe("brandedTitle", () => {
  it("appends the store name once", () => {
    expect(brandedTitle("Tea guides", "Ricwell")).toBe("Tea guides | Ricwell");
    expect(brandedTitle("Blog | Ricwell", "ricwell")).toBe("Blog | Ricwell");
  });
});
