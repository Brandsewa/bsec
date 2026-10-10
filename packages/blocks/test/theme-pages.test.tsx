import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  THEME_SYSTEM_PAGES,
  computeThemeTokens,
  googleFontsHref,
  renderBlockDocument,
  renderBlockTree,
  resolveThemeTokens,
  validateBlockDocument,
  type BlockInstance,
} from "../src/index.ts";

const block = (id: string, type: BlockInstance["type"], props: Record<string, unknown> = {}): BlockInstance => ({ id, type, version: 1, props });

describe("header, footer, product and collection blocks", () => {
  it("validates with only defaults and renders the store name", () => {
    for (const type of ["SiteHeader", "SiteFooter", "ProductDetail", "CollectionListing"] as const) {
      const doc = { version: 1, blocks: [block(`${type}-1`, type, {})] };
      expect(validateBlockDocument(doc).success, type).toBe(true);
    }
    const html = renderToStaticMarkup(<>{renderBlockTree([block("h", "SiteHeader", { links: [{ label: "Shop", href: "/collections/all" }] })], { storeName: "Acme" })}</>);
    expect(html).toContain("Acme");
    expect(html).toContain('href="/collections/all"');
  });

  it("renders custom logoMediaId, branding logoUrl, or store name", () => {
    // 1. Branding logo fallback when no logoText or logoMediaId
    const brandingHtml = renderToStaticMarkup(
      <>{renderBlockTree([block("h", "SiteHeader", {})], { storeName: "Acme", logoUrl: "https://cdn.example/brand-logo.png" })}</>,
    );
    expect(brandingHtml).toContain('src="https://cdn.example/brand-logo.png"');

    // 2. Custom logoMediaId overrides branding logo
    const customHtml = renderToStaticMarkup(
      <>{renderBlockTree([block("h", "SiteHeader", { logoMediaId: "med-123" })], {
        storeName: "Acme",
        logoUrl: "https://cdn.example/brand-logo.png",
        mediaUrl: (id) => `https://cdn.example/media/${id}.png`,
      })}</>,
    );
    expect(customHtml).toContain('src="https://cdn.example/media/med-123.png"');

    // 3. logoText overrides branding logo
    const textHtml = renderToStaticMarkup(
      <>{renderBlockTree([block("h", "SiteHeader", { logoText: "Custom Brand" })], {
        storeName: "Acme",
        logoUrl: "https://cdn.example/brand-logo.png",
      })}</>,
    );
    expect(textHtml).toContain("Custom Brand");
    expect(textHtml).not.toContain("brand-logo.png");
  });

  it("uses the storefront's link, cart and page-core renderers when the host provides them", () => {
    const html = renderToStaticMarkup(
      <>
        {renderBlockTree(
          [block("h", "SiteHeader", { links: [{ label: "Shop", href: "/x" }] }), block("p", "ProductDetail", {}), block("c", "CollectionListing", {})],
          {
            renderLink: ({ href, children }) => <a data-host-link href={href}>{children}</a>,
            renderCart: () => <span data-host-cart>cart</span>,
            renderProductDetail: (o) => <div data-product-core={o.galleryPosition} />,
            renderCollectionListing: (o) => <div data-collection-core={o.columns} />,
          },
        )}
      </>,
    );
    expect(html).toContain("data-host-link");
    expect(html).toContain("data-host-cart");
    expect(html).toContain('data-product-core="left"');
    expect(html).toContain('data-collection-core="4"');
  });

  it("draws labelled placeholders in the editor (no host renderers)", () => {
    const html = renderToStaticMarkup(<>{renderBlockTree([block("p", "ProductDetail", {}), block("c", "CollectionListing", {})], {})}</>);
    expect(html).toContain("Product page");
    expect(html).toContain("Collection page");
  });

  it("rejects links that are not safe", () => {
    const r = validateBlockDocument({ version: 1, blocks: [block("h", "SiteHeader", { links: [{ label: "x", href: "javascript:alert(1)" }] })] });
    expect(r.success).toBe(false);
  });

  it("renders resolved menu with desktop dropdowns and mobile drawer accordion", () => {
    const menuItems = [
      { id: "1", label: "Home", url: "/", href: "/" },
      {
        id: "2",
        label: "Shop",
        url: "/collections/all",
        href: "/collections/all",
        children: [
          {
            id: "2a",
            label: "Apparel",
            url: "/collections/apparel",
            href: "/collections/apparel",
            children: [{ id: "2a1", label: "T-Shirts", url: "/collections/t-shirts", href: "/collections/t-shirts" }],
          },
          { id: "2b", label: "Accessories", url: "/collections/accessories", href: "/collections/accessories" },
        ],
      },
    ];

    const html = renderToStaticMarkup(
      <>
        {renderBlockTree([block("hdr", "SiteHeader", {})], {
          storeName: "Acme Store",
          data: { hdr: { kind: "menu", items: menuItems } },
        })}
      </>,
    );

    // Desktop dropdown
    expect(html).toContain("bsb-has-dropdown");
    expect(html).toContain("bsb-dropdown-menu");
    expect(html).toContain('href="/collections/t-shirts"');
    expect(html).toContain("T-Shirts");

    // Mobile drawer accordion
    expect(html).toContain("bsb-mobile-menu");
    expect(html).toContain("bsb-mobile-drawer");
    expect(html).toContain("bsb-mobile-accordion");
    expect(html).toContain("All Shop");
  });

  it("falls back to block inline links when no menu exists (exact snapshot preservation)", () => {
    const inlineLinks = [
      { label: "Home", href: "/" },
      { label: "Products", href: "/products" },
    ];

    const htmlWithoutMenu = renderToStaticMarkup(
      <>{renderBlockTree([block("hdr", "SiteHeader", { links: inlineLinks })], { storeName: "Acme" })}</>,
    );

    // No mobile drawer should be rendered in fallback mode
    expect(htmlWithoutMenu).not.toContain("bsb-mobile-menu");
    expect(htmlWithoutMenu).not.toContain("bsb-has-dropdown");
    expect(htmlWithoutMenu).toContain('href="/products"');
    expect(htmlWithoutMenu).toContain("Products");
  });

  it("renders footer with resolved menu columns and fallback to inline links", () => {
    const htmlWithMenu = renderToStaticMarkup(
      <>
        {renderBlockTree(
          [
            block("ftr", "SiteFooter", {
              columns: [
                { title: "Quick Links", links: [{ label: "Old", href: "/old" }] },
                { title: "Help", links: [{ label: "FAQ", href: "/faq" }] },
              ],
            }),
          ],
          {
            storeName: "Acme",
            data: {
              ftr: {
                kind: "footer-menus",
                columns: [
                  [{ id: "m1", label: "New Shop", url: "/shop", href: "/shop" }],
                  null, // Column 2 falls back to inline links
                ],
              },
            },
          },
        )}
      </>,
    );

    expect(htmlWithMenu).toContain("New Shop");
    expect(htmlWithMenu).toContain('href="/shop"');
    expect(htmlWithMenu).toContain("FAQ");
    expect(htmlWithMenu).not.toContain("Old");
  });

  it("round-trips through document rendering", () => {
    const r = renderBlockDocument({ version: 1, blocks: [block("f", "SiteFooter", {})] });
    expect(r.success).toBe(true);
  });
});

describe("cart contents block", () => {
  it("validates with defaults, and the cart is a theme system page", () => {
    expect(validateBlockDocument({ version: 1, blocks: [block("c", "CartContents", {})] }).success).toBe(true);
    expect(THEME_SYSTEM_PAGES.cart.type).toBe("cart_template");
  });

  it("uses the storefront cart when provided and draws a placeholder in the editor", () => {
    const doc = [block("c", "CartContents", { summaryPosition: "left" })];
    const host = renderToStaticMarkup(<>{renderBlockTree(doc, { renderCartContents: (o) => <div data-cart-core={o.summaryPosition} /> })}</>);
    expect(host).toContain('data-cart-core="left"');
    expect(renderToStaticMarkup(<>{renderBlockTree(doc, {})}</>)).toContain("Cart page");
  });
});

describe("conversion settings", () => {
  it("keeps documents saved before the settings existed valid, with the old look as defaults", () => {
    const r = validateBlockDocument({ version: 1, blocks: [block("p", "ProductDetail", { galleryPosition: "left" }), block("c", "CollectionListing", {}), block("k", "CartContents", {})] });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data.blocks[0]?.props).toMatchObject({ stickyMobileBar: false, showTrustPoints: false, showSku: true });
      expect(r.data.blocks[1]?.props).toMatchObject({ columnsMobile: "1", cardStyle: "bordered", imageRatio: "square" });
      expect(r.data.blocks[2]?.props).toMatchObject({ checkoutLabel: "Proceed to Checkout", showFreeShippingBar: false });
    }
  });

  it("limits reassurance lines to four short ones", () => {
    const many = ["a", "b", "c", "d", "e"];
    expect(validateBlockDocument({ version: 1, blocks: [block("k", "CartContents", { trustPoints: many })] }).success).toBe(false);
    expect(validateBlockDocument({ version: 1, blocks: [block("p", "ProductDetail", { trustPoints: ["x".repeat(61)] })] }).success).toBe(false);
  });
});

describe("heading levels and sizes", () => {
  it("supports H1 to H6 and a size that follows the level", () => {
    const doc = { version: 1 as const, blocks: [block("h", "Heading", { text: "Hi", level: "h5", size: "auto" })] };
    expect(validateBlockDocument(doc).success).toBe(true);
    expect(renderToStaticMarkup(<>{renderBlockTree(doc.blocks, {})}</>)).toContain("bsb-lvl-h5");
    expect(validateBlockDocument({ version: 1, blocks: [block("h", "Heading", { text: "Hi", level: "h7" })] }).success).toBe(false);
  });
});

describe("theme system pages", () => {
  it("keeps header, footer and layouts off the public /pages/<slug> namespace", () => {
    for (const def of Object.values(THEME_SYSTEM_PAGES)) {
      expect(def.slug.startsWith("template-")).toBe(true);
    }
  });
});

describe("theme tokens: fonts, buttons and precedence", () => {
  it("reads the editable shape and the first-launch shape", () => {
    const current = computeThemeTokens(null, { colors: { primary: "#112233" }, fonts: { heading: "Playfair Display", body: "Lora" }, radius: "lg" });
    expect(current["--font-heading"]).toBe("Playfair Display"); // bare name: the legacy contract
    expect(current["--bs-font-heading"]).toContain("Playfair Display");
    expect(current["--bs-font-body"]).toContain("Lora");
    expect(current["--bs-radius"]).toBe("0.75rem");

    const legacy = computeThemeTokens(null, { typography: { headingFont: "Poppins", bodyFont: "Inter" }, shape: { radius: "0.5rem", buttonStyle: "rounded" } });
    expect(legacy["--bs-font-heading"]).toContain("Poppins");
    expect(legacy["--bs-radius"]).toBe("0.5rem");
  });

  it("styles buttons by choice: solid, outline, soft, own radius, uppercase", () => {
    const base = { colors: { primary: "#0b6b42" } };
    expect(computeThemeTokens(null, { ...base, buttons: { style: "solid" } })["--bs-btn-bg"]).toBe("#0b6b42");
    const outline = computeThemeTokens(null, { ...base, buttons: { style: "outline" } });
    expect(outline["--bs-btn-bg"]).toBe("transparent");
    expect(outline["--bs-btn-fg"]).toBe("#0b6b42");
    expect(computeThemeTokens(null, { ...base, buttons: { style: "soft" } })["--bs-btn-bg"]).toContain("color-mix");
    const pill = computeThemeTokens(null, { ...base, radius: "sm", buttons: { radius: "full", uppercase: true } });
    expect(pill["--bs-btn-radius"]).toBe("9999px");
    expect(pill["--bs-radius"]).toBe("0.25rem");
    expect(pill["--bs-btn-case"]).toBe("uppercase");
  });

  it("pill corners round the buttons fully but keep cards and images from becoming circles", () => {
    const out = computeThemeTokens(null, { radius: "full" });
    expect(out["--bs-btn-radius"]).toBe("9999px");
    expect(out["--bs-radius"]).toBe("1.25rem");
    expect(out["--radius"]).toBe("1.25rem");
  });

  it("never lets a font or colour value inject CSS", () => {
    const out = computeThemeTokens(null, { fonts: { heading: 'Evil"; background:url(x)' }, colors: { primary: "red; x:y" } });
    expect(out["--bs-font-heading"]).not.toContain("url");
    expect(out["--bs-primary"]).toBe("#0f172a");
  });

  it("loads only curated Google fonts", () => {
    expect(googleFontsHref({ fonts: { heading: "Playfair Display", body: "Inter" } })).toContain("family=Playfair+Display");
    expect(googleFontsHref({ fonts: { heading: "Some Unknown Font" } })).toBeNull();
    expect(googleFontsHref(null)).toBeNull();
  });

  it("theme tokens beat Branding only when the store opted in (source: theme)", () => {
    const brand = { primaryColor: "#ff0000" };
    expect(resolveThemeTokens(brand, { source: "theme", colors: { primary: "#00ff00" } })["--bs-primary"]).toBe("#00ff00");
    expect(resolveThemeTokens(brand, { colors: { primary: "#00ff00" } })["--bs-primary"]).toBe("#ff0000");
    expect(resolveThemeTokens(brand, null)["--bs-primary"]).toBe("#ff0000");
  });
});
