import { describe, expect, it } from "vitest";
import { classifyLink, type KnownTargets } from "../src/admin/link-rules.ts";
import { collectLinks } from "../src/admin/link-health.ts";

const known: KnownTargets = {
  products: new Set(["green-tea"]),
  collections: new Set(["teas"]),
  categories: new Set(["herbal"]),
  pages: new Set(["/pages/about", "/pages/services/wholesale"]),
  blogPosts: new Set(["how-to-brew"]),
  redirects: new Set(["/old-tea"]),
  ownHosts: new Set(["shop.com", "shop.bcom.si"]),
};
const kind = (link: string) => classifyLink(link, known)?.kind ?? null;

describe("classifyLink", () => {
  it("accepts pages the store really has, with a query, fragment, trailing slash or capital letters", () => {
    for (const l of ["/", "/products/green-tea", "/Products/Green-Tea/?x=1#top", "/collections/teas", "/categories/herbal", "/pages/about", "/pages/services/wholesale", "/blog/how-to-brew", "/products/all", "/collections/all", "/categories/all", "/policies", "/policies/refund", "/cart", "/search?q=tea", "/old-tea"]) {
      expect(kind(l), l).toBeNull();
    }
  });

  it("flags addresses nothing on the store has", () => {
    for (const l of ["/products/gone", "/collections/gone", "/categories/gone", "/pages/gone", "/blog/gone", "/wholesale-bulk-tea", "/private-label-tea/"]) {
      expect(kind(l), l).toBe("broken");
    }
  });

  it("suggests where an old Shopify address lives now", () => {
    expect(classifyLink("/blogs/tea-guides/how-to-brew", known)?.hint).toContain("/blog/how-to-brew");
    expect(classifyLink("/products", known)?.hint).toContain("/products/all");
  });

  it("flags old checkout links and links to the store's preview address", () => {
    expect(kind("/checkouts/cn/abc123")).toBe("shopify_checkout");
    expect(kind("https://shop.com/checkouts/cn/abc")).toBe("shopify_checkout");
    expect(kind("https://acme.bcom.si/products/green-tea")).toBe("platform_host");
  });

  it("checks absolute links to the store's own domain like paths, and a www address that is not connected", () => {
    expect(kind("https://shop.com/products/green-tea")).toBeNull();
    expect(kind("https://shop.com/products/gone")).toBe("broken");
    expect(kind("https://www.shop.com/products/green-tea")).toBe("www_host");
  });

  it("leaves outside websites, mail, phone and anchors alone", () => {
    for (const l of ["https://example.com/x", "mailto:hi@shop.com", "tel:+911234567890", "#faq", "", "https://admin.bcom.si", "https://www.bcom.si/pricing"]) {
      expect(kind(l), l).toBeNull();
    }
  });
});

describe("collectLinks", () => {
  it("reads links under link-like keys anywhere in a document, and ignores pictures and text", () => {
    const doc = {
      blocks: [
        { type: "Hero", props: { title: "Visit /not-a-link now", primaryHref: "/collections/teas", image: "/uploads/a.png", buttonUrl: "https://shop.com/x" } },
        { type: "Banner", props: { text: "Sale", link: "/products/all", messages: [{ text: "x", link: "/blogs/news/a" }] } },
        { type: "Image", props: { src: "/placeholder.png", imageUrl: "/img.png", href: "mailto:a@b.c" } },
      ],
    };
    expect(collectLinks(doc).sort()).toEqual(["/blogs/news/a", "/collections/teas", "/products/all", "https://shop.com/x"].sort());
  });

  it("reads menu items", () => {
    expect(collectLinks([{ label: "Shop", url: "/products/all", children: [{ label: "Tea", url: "/collections/teas" }] }]).sort()).toEqual(["/collections/teas", "/products/all"]);
  });
});
