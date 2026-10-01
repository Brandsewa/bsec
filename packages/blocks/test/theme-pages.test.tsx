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

  it("round-trips through document rendering", () => {
    const r = renderBlockDocument({ version: 1, blocks: [block("f", "SiteFooter", {})] });
    expect(r.success).toBe(true);
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
