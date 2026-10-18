import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BannerSchema, SiteFooterSchema, SiteHeaderSchema, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const header = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "h", type: "SiteHeader", version: 1, props });
const footer = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "f", type: "SiteFooter", version: 1, props });
const render = (blocks: BlockInstance[], base: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree(blocks, base as never)}</>);

describe("site header options", () => {
  it("accepts every layout and keeps older documents valid", () => {
    for (const layout of ["left", "navCenter", "logoCenter", "logoRight", "center"]) {
      expect(SiteHeaderSchema.safeParse({ layout }).success, layout).toBe(true);
    }
    expect(SiteHeaderSchema.safeParse({ layout: "diagonal" }).success).toBe(false);
    expect(SiteHeaderSchema.parse({})).toMatchObject({ layout: "left", showAccount: false, showSearch: true, showCart: true });
    expect(validateBlockDocument({ version: 1, blocks: [header({ layout: "left", links: [] })] }).success).toBe(true);
  });

  it("puts the layout class on the header and the account icon only when asked", () => {
    for (const layout of ["left", "navCenter", "logoCenter", "logoRight", "center"]) expect(render([header({ layout })])).toContain(`bsb-hl-${layout}`);
    expect(render([header({ layout: "center" })])).toContain("bsb-site-header-center");
    expect(render([header()])).not.toContain('href="/account"');
    expect(render([header({ showAccount: true })])).toContain('href="/account"');
    expect(render([header({ showSearch: false, showCart: false })])).not.toContain('href="/search"');
  });
});

describe("site footer options", () => {
  const cols = [
    { title: "Shop", links: [{ label: "All", href: "/collections/all" }] },
    { title: "Help", menuHandle: "footer-help", links: [{ label: "Fallback", href: "/x" }] },
  ];

  it("accepts the layouts and defaults to the old look", () => {
    expect(SiteFooterSchema.parse({})).toMatchObject({ layout: "columns", mobileAccordion: true });
    expect(SiteFooterSchema.safeParse({ layout: "mega" }).success).toBe(false);
    expect(SiteFooterSchema.safeParse({ columns: Array.from({ length: 5 }, (_, i) => ({ title: `c${i}` })) }).success).toBe(false);
  });

  it("draws columns, centred and compact layouts", () => {
    const columnsHtml = render([footer({ columns: cols })]);
    expect(columnsHtml).toContain("bsb-fl-columns");
    expect(columnsHtml).toContain("bsb-site-footer-grid");
    expect(render([footer({ layout: "centered", columns: cols })])).toContain("bsb-site-footer-stack");
    expect(render([footer({ layout: "compact", columns: cols })])).toContain("bsb-fl-compact");
  });

  it("folds each column into an accordion for phones unless switched off", () => {
    const on = render([footer({ columns: cols })]);
    expect(on).toContain("bsb-fl-accordion");
    expect(on.match(/<details class="bsb-site-footer-fold"/g)).toHaveLength(2);
    const off = render([footer({ columns: cols, mobileAccordion: false })]);
    expect(off).not.toContain("bsb-site-footer-fold");
    expect(off).not.toContain("bsb-fl-accordion");
  });

  it("uses the store's menu links for a column that has a menu, and the typed links otherwise", () => {
    const data = { f: { kind: "footer-menus", columns: [null, [{ id: "1", label: "Returns", url: "/policies/refund", href: "/policies/refund" }]] } };
    const html = render([footer({ columns: cols })], { data });
    expect(html).toContain("Returns");
    expect(html).not.toContain("Fallback");
    expect(html).toContain("All");
  });

  it("shows the logo image or the brand name", () => {
    expect(render([footer({ logoText: "Acme" })])).toContain("Acme");
    const withLogo = render([footer({ logoMediaId: "m1", logoText: "Acme" })], { mediaUrl: (id: string) => (id === "m1" ? "https://media.example/logo.png" : null) });
    expect(withLogo).toContain("https://media.example/logo.png");
  });
});

describe("logo size per device", () => {
  const withLogo = (size: Record<string, unknown>) => ({ logoMediaId: "m1", logoSize: size });
  const media = { mediaUrl: (id: string) => (id === "m1" ? "https://media.example/logo.png" : null) };

  it("sets CSS variables only for the sizes that are set", () => {
    const html = render([header(withLogo({ desktop: { width: 160 }, tablet: {}, mobile: { height: 28 } }))], media);
    expect(html).toContain("--lg-d-w:160px");
    expect(html).toContain("--lg-m-h:28px");
    expect(html).not.toContain("--lg-t-");
    expect(html).toContain("bsb-logo-img");
    expect(render([footer(withLogo({ desktop: { height: 50 } }))], media)).toContain("--lg-d-h:50px");
  });

  it("keeps the sizes inside their limits and defaults to none", () => {
    expect(SiteHeaderSchema.parse({}).logoSize).toEqual({ desktop: {}, tablet: {}, mobile: {} });
    expect(SiteHeaderSchema.safeParse({ logoSize: { desktop: { width: 5000 } } }).success).toBe(false);
    expect(SiteFooterSchema.safeParse({ logoSize: { mobile: { height: 5 } } }).success).toBe(false);
  });
});

describe("announcement bar", () => {
  const bar = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "b", type: "Banner", version: 1, props: { text: "First", ...props } });

  it("stays a plain single message by default", () => {
    const html = render([bar()]);
    expect(html).toContain("First");
    expect(html).not.toContain("bsb-ann-rotate");
  });

  it("rotates through several messages with the chosen interval, and not when switched off", () => {
    const html = render([bar({ messages: [{ text: "Second", link: "/sale" }], interval: 8 })]);
    expect(html).toContain("bsb-ann-rotate");
    expect(html).toContain("bsb-ann-n2");
    expect(html).toContain("--ann-iv:8s");
    expect(html).toContain('href="/sale"');
    expect(render([bar({ messages: [{ text: "Second" }], rotate: false })])).not.toContain("bsb-ann-rotate");
  });

  it("applies colours, font and alignment, and rejects bad values", () => {
    const html = render([bar({ bgColor: "#112233", textColor: "#ffffff", fontSize: 16, fontWeight: "700", font: "heading", align: "left" })]);
    expect(html).toContain("background:#112233");
    expect(html).toContain("color:#ffffff");
    expect(html).toContain("font-size:1rem");
    expect(html).toContain("bsb-align-left");
    expect(BannerSchema.safeParse({ text: "x", bgColor: "red" }).success).toBe(false);
    expect(BannerSchema.safeParse({ text: "x", interval: 1 }).success).toBe(false);
    expect(BannerSchema.safeParse({ text: "x", messages: Array.from({ length: 6 }, () => ({ text: "m" })) }).success).toBe(false);
  });
});
