import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  BLOCK_DEFINITIONS,
  MAX_BLOCK_DEPTH,
  MAX_BLOCKS_PER_DOCUMENT,
  documentToPuck,
  puckToDocument,
  renderBlockDocument,
  validateBlockDocument,
  walkBlocks,
  type BlockDocument,
  type BlockInstance,
  type RenderContext,
} from "../src/index.ts";

const block = (id: string, type: BlockInstance["type"], props: Record<string, unknown> = {}): BlockInstance => ({
  id,
  type,
  version: 1,
  props,
});

const doc = (...blocks: BlockInstance[]): BlockDocument => ({ version: 1, blocks });

describe("nested layout blocks", () => {
  it("validates children inside a Section > Grid > Heading tree and keeps them", () => {
    const tree = doc(
      block("s1", "Section", {
        content: [block("g1", "Grid", { columns: 2, content: [block("h1", "Heading", { text: "Hi" }), block("t1", "Text", { text: "Body" })] })],
      }),
    );
    const result = validateBlockDocument(tree);
    expect(result.success).toBe(true);
    if (!result.success) return;
    const ids: string[] = [];
    walkBlocks(result.data.blocks, (b) => ids.push(b.id));
    expect(ids).toEqual(["s1", "g1", "h1", "t1"]);
  });

  it("applies schema defaults to nested blocks", () => {
    const result = validateBlockDocument(doc(block("c1", "Container", { content: [block("b1", "Button", { label: "Go" })] })));
    expect(result.success).toBe(true);
    if (!result.success) return;
    const inner = (result.data.blocks[0]?.props.content as BlockInstance[])[0];
    expect(inner?.props.variant).toBe("primary");
    expect(inner?.props.href).toBe("/");
  });

  it("reports errors from nested blocks with their tree path", () => {
    const result = validateBlockDocument(doc(block("c1", "Container", { content: [block("b1", "Button", { label: "" })] })));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors[0]?.path).toContain("blocks[0].props.content[0].props.label");
  });

  it("rejects duplicate ids across different nesting levels", () => {
    const result = validateBlockDocument(doc(block("dup", "Spacer"), block("c1", "Container", { content: [block("dup", "Spacer")] })));
    expect(result.success).toBe(false);
  });

  it("rejects trees deeper than the limit", () => {
    let inner: BlockInstance = block("leaf", "Spacer");
    for (let i = 0; i < MAX_BLOCK_DEPTH + 1; i++) inner = block(`c${i}`, "Container", { content: [inner] });
    const result = validateBlockDocument(doc(inner));
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.errors.some((e) => e.message.includes("nested deeper"))).toBe(true);
  });

  it("rejects documents over the block-count limit", () => {
    const many = Array.from({ length: MAX_BLOCKS_PER_DOCUMENT + 1 }, (_, i) => block(`s${i}`, "Spacer"));
    const result = validateBlockDocument(doc(...many));
    expect(result.success).toBe(false);
  });

  it("rejects a non-array slot", () => {
    const result = validateBlockDocument(doc(block("c1", "Container", { content: "nope" })));
    expect(result.success).toBe(false);
  });

  it("drops hidden blocks at every level when rendering", () => {
    const r = renderBlockDocument(
      doc(block("c1", "Container", { content: [block("a", "Spacer"), { ...block("b", "Spacer"), hidden: true }] })),
    );
    expect(r.success).toBe(true);
    const ids: string[] = [];
    walkBlocks(r.blocks, (b) => ids.push(b.id));
    expect(ids).toEqual(["c1", "a"]);
  });
});

describe("safe props (ADR-010: no merchant code)", () => {
  it.each([
    ["javascript:alert(1)"],
    ["data:text/html,<script>1</script>"],
    ["//evil.example/x"],
    ["vbscript:x"],
  ])("rejects unsafe button href %s", (href) => {
    expect(validateBlockDocument(doc(block("b", "Button", { label: "x", href }))).success).toBe(false);
  });

  it.each([["/products/x"], ["#faq"], ["https://example.com/a"], ["mailto:a@b.co"], ["tel:+911234567890"]])(
    "accepts safe href %s",
    (href) => {
      expect(validateBlockDocument(doc(block("b", "Button", { label: "x", href }))).success).toBe(true);
    },
  );

  it("only allows YouTube, Vimeo or direct video links", () => {
    const ok = (url: string) => validateBlockDocument(doc(block("v", "Video", { url }))).success;
    expect(ok("https://www.youtube.com/watch?v=abcdefghijk")).toBe(true);
    expect(ok("https://vimeo.com/12345")).toBe(true);
    expect(ok("https://cdn.example.com/a.mp4")).toBe(true);
    expect(ok("https://evil.example/page.html")).toBe(false);
    expect(ok("javascript:alert(1)")).toBe(false);
  });

  it("rejects unknown enum values (no arbitrary styling)", () => {
    expect(validateBlockDocument(doc(block("s", "Section", { tone: "url(javascript:1)" }))).success).toBe(false);
  });
});

describe("Puck adapter", () => {
  it("round-trips a nested document without losing structure", () => {
    const tree = doc(
      block("s1", "Section", { content: [block("h1", "Heading", { text: "Hi" }), block("g1", "Grid", { content: [block("i1", "Icon", { name: "truck" })] })] }),
      block("p1", "ProductCarousel", { title: "New" }),
    );
    const back = puckToDocument(documentToPuck(tree));
    expect(back).toEqual(tree);
  });

  it("keeps RichText's own `content` string (it shares its name with the layout slot)", () => {
    const tree = doc(block("r1", "RichText", { content: "<h2>About</h2><p>Hello</p>", alignment: "left" }));
    const puck = documentToPuck(tree);
    expect(puck.content[0]?.props.content).toBe("<h2>About</h2><p>Hello</p>");
    expect(puckToDocument(puck)).toEqual(tree);
  });

  it("drops widgets the registry does not know (removed block types)", () => {
    const back = puckToDocument({ root: {}, content: [{ type: "Ghost", props: { id: "x" } }, { type: "Spacer", props: { id: "y", size: "md" } }] });
    expect(back.blocks.map((b) => b.id)).toEqual(["y"]);
  });
});

describe("rendering", () => {
  const html = (type: BlockInstance["type"], props: Record<string, unknown>, ctx?: RenderContext, children?: React.ReactNode) => {
    const def = BLOCK_DEFINITIONS[type];
    return renderToStaticMarkup(<>{def.render({ props: def.schema.parse(props), ctx, children })}</>);
  };

  it("renders layout children through the slot", () => {
    expect(html("Container", {}, undefined, <p>child</p>)).toContain("<p>child</p>");
  });

  it("renders products supplied in the data map and uses the host card renderer", () => {
    const ctx: RenderContext = {
      blockId: "pc",
      data: { pc: { kind: "products", products: [{ id: "1", title: "Jar", slug: "jar", priceMin: 49900, compareAtPriceMin: 69900 }] } },
    };
    const out = html("ProductCarousel", { title: "Best" }, ctx);
    expect(out).toContain("Jar");
    expect(out).toContain("₹499");
    expect(out).toContain("₹699");
    expect(out).toContain('href="/products/jar"');

    const custom = html("ProductCarousel", { title: "Best" }, { ...ctx, renderProductCard: (p) => <b>{`custom:${p.title}`}</b> });
    expect(custom).toContain("<b>custom:Jar</b>");
  });

  it("shows an empty state instead of crashing when no data resolved", () => {
    expect(html("ProductGrid", { title: "Empty" })).toContain("No products to show yet.");
  });

  it("resolves media ids through the host and never emits raw ids as URLs", () => {
    const ctx: RenderContext = { mediaUrl: (id) => `https://cdn.test/${id}` };
    expect(html("Image", { mediaId: "m1", alt: "x" }, ctx)).toContain("https://cdn.test/m1");
    expect(html("Image", { mediaId: "m1", alt: "x" })).toContain("Add an image");
  });

  it("still shows the main button for starter templates that used buttonText/buttonUrl", () => {
    const out = html("Hero", { title: "Welcome", buttonText: "Shop Catalog", buttonUrl: "/collections/all" });
    expect(out).toContain("Shop Catalog");
    expect(out).toContain('href="/collections/all"');
  });

  it("renders testimonial stars and author", () => {
    const out = html("Testimonials", { items: [{ quote: "Great", author: "Asha", rating: 4 }] });
    expect(out).toContain("Asha");
    expect(out).toContain("4 out of 5 stars");
  });

  it("escapes text props (no HTML injection through headings)", () => {
    expect(html("Heading", { text: "<img src=x onerror=alert(1)>" })).not.toContain("<img");
  });
});

import { renderToStaticMarkup as renderMarkup } from "react-dom/server";
import { renderBlockTree as renderTree, validateBlockDocument as validateDoc } from "../src/index.ts";

describe("hero slider", () => {
  const slider = (props: Record<string, unknown> = {}) => ({ id: "hs", type: "HeroSlider" as const, version: 1, props });

  it("validates with defaults, and bounds its settings", () => {
    expect(validateDoc({ version: 1, blocks: [slider()] }).success).toBe(true);
    const slides = (n: number) => Array.from({ length: n }, (_, i) => ({ title: `Slide ${i}` }));
    expect(validateDoc({ version: 1, blocks: [slider({ slides: slides(6) })] }).success).toBe(true);
    expect(validateDoc({ version: 1, blocks: [slider({ slides: slides(7) })] }).success).toBe(false);
    expect(validateDoc({ version: 1, blocks: [slider({ interval: 1 })] }).success).toBe(false);
    expect(validateDoc({ version: 1, blocks: [slider({ shadeStrength: 120 })] }).success).toBe(false);
  });

  it("only accepts a direct https video file and #rrggbb colours (no free-form CSS or script)", () => {
    const ok = validateDoc({ version: 1, blocks: [slider({ slides: [{ videoUrl: "https://cdn.example.com/bg.mp4?x=1" }], primaryBg: "#1f3a5f" })] });
    expect(ok.success).toBe(true);
    for (const bad of ["http://cdn.example.com/bg.mp4", "https://www.youtube.com/watch?v=abcdef123", "javascript:alert(1)", "https://x.com/a.mp4;evil"]) {
      expect(validateDoc({ version: 1, blocks: [slider({ slides: [{ videoUrl: bad }] })] }).success, bad).toBe(false);
    }
    expect(validateDoc({ version: 1, blocks: [slider({ primaryBg: "red; background:url(x)" })] }).success).toBe(false);
    expect(validateDoc({ version: 1, blocks: [slider({ slides: [{ primaryHref: "javascript:alert(1)" }] })] }).success).toBe(false);
  });

  it("renders every slide with its buttons, loads only the first image eagerly, and wires the host behaviour", () => {
    const blocks = [
      slider({
        slides: [
          { backgroundMediaId: "m1", title: "One", primaryLabel: "Shop", primaryHref: "/a", secondaryLabel: "Story", secondaryHref: "/b" },
          { backgroundMediaId: "m2", title: "Two", videoUrl: "https://cdn.example.com/two.mp4" },
        ],
        titleTag: "h1",
      }),
    ];
    const html = renderMarkup(<>{renderTree(blocks, { mediaUrl: (id) => `https://img.test/${id}.jpg` })}</>);
    expect(html).toContain("<h1");
    expect(html).toContain(">Two</h2>"); // only the first slide may be an h1
    expect(html).toContain("bsb-btn-primary");
    expect(html).toContain("bsb-btn-secondary");
    expect(html.match(/loading="eager"/g)?.length).toBe(1);
    expect(html).toContain('loading="lazy"');
    expect(html).toContain("two.mp4");
    expect(html).toContain("data-hs-dot");
    let seen: unknown;
    renderMarkup(<>{renderTree(blocks, { renderHeroSlider: ({ options, children }) => { seen = options; return <div data-host>{children}</div>; } })}</>);
    expect(seen).toMatchObject({ autoplay: true, loop: true, interval: 6 });
  });

  it("shows no controls for a single slide and honours the arrow and dot switches", () => {
    const one = renderMarkup(<>{renderTree([slider({ slides: [{ title: "Solo" }] })], {})}</>);
    expect(one).not.toContain("data-hs-dot");
    expect(one).not.toContain("data-hs-prev");
    const two = renderMarkup(<>{renderTree([slider({ slides: [{ title: "A" }, { title: "B" }], dots: false, arrows: false })], {})}</>);
    expect(two).not.toContain("data-hs-dot");
    expect(two).not.toContain("data-hs-prev");
  });
});

describe("product showcase", () => {
  const showcase = (props: Record<string, unknown> = {}) => ({ id: "ps", type: "ProductShowcase" as const, version: 1, props });
  const products = [
    { id: "p1", title: "Mango Jam", slug: "mango-jam", priceMin: 11900, priceMax: 14900, compareAtPriceMin: 13000, ratingAvg: "4.0", ratingCount: 3, categoryName: "Jams", quickAddVariantId: "v1" },
    { id: "p2", title: "Rhododendron Juice", slug: "juice", priceMin: 9000, ratingAvg: "4.5", ratingCount: 4 },
  ];
  const render = (props: Record<string, unknown>, tabsData = 1) =>
    renderMarkup(<>{renderTree([showcase(props)], { data: { ps: { kind: "product-tabs", tabs: Array.from({ length: tabsData }, () => ({ products })) } } })}</>);

  it("validates with defaults and bounds its settings", () => {
    expect(validateDoc({ version: 1, blocks: [showcase()] }).success).toBe(true);
    expect(validateDoc({ version: 1, blocks: [showcase({ perViewDesktop: 9 })] }).success).toBe(false);
    expect(validateDoc({ version: 1, blocks: [showcase({ tabs: [] })] }).success).toBe(false);
    expect(validateDoc({ version: 1, blocks: [showcase({ cardOrder: [{ item: "stock" }] })] }).success).toBe(false);
  });

  it("turns the tab bar on only when there is more than one collection", () => {
    expect(render({})).not.toContain("data-psc-tab");
    const two = render({ tabs: [{ label: "New arrivals", source: "newest" }, { label: "Featured", source: "featured" }] }, 2);
    expect(two).toContain("data-psc-tab");
    expect(two.match(/data-psc-panel/g)?.length).toBe(2);
    expect(two).toContain("hidden"); // the second panel waits until its tab is chosen
  });

  it("draws card rows in the configured order and hides the ones switched off", () => {
    const order = (cardOrder: unknown) => {
      const html = render({ cardOrder });
      return ["bsb-psc-rating", "bsb-psc-title", "bsb-psc-price"].map((c) => html.indexOf(`class="${c}`)).filter((i) => i >= 0);
    };
    const priceFirst = render({ cardOrder: [{ item: "price", show: true }, { item: "title", show: true }, { item: "rating", show: true }] });
    expect(priceFirst.indexOf("bsb-psc-price")).toBeLessThan(priceFirst.indexOf("bsb-psc-title"));
    expect(priceFirst.indexOf("bsb-psc-title")).toBeLessThan(priceFirst.indexOf("class=\"bsb-psc-rating\""));
    const noRating = render({ cardOrder: [{ item: "title", show: true }, { item: "rating", show: false }] });
    expect(noRating).not.toContain("bsb-psc-rating-num");
    expect(order([{ item: "title", show: true }]).length).toBe(1);
  });

  it("shows prices, the starts-from label, the sale badge and the cart button as configured", () => {
    const html = render({});
    expect(html).toContain("₹119");
    expect(html).toContain("Starts from"); // first product has a price range
    expect(html).toContain("Save 8%");
    expect(html).toContain("Jams"); // category badge
    expect(html).toContain('data-variant="v1"'); // single variant: quick add
    expect(html).toContain("Choose options for Rhododendron Juice"); // no quick-add variant: opens the page
    const bare = render({ showAddToCart: false, showSaleBadge: false, showCompareAt: false, startsFrom: "never", badge: "none" });
    for (const gone of ["data-psc-add", "Save 8%", "Starts from", "<s>"]) expect(bare).not.toContain(gone);
  });
});

describe("per-device layout (margin, padding, sizing) on the BCOM widgets", () => {
  const widgets = ["HeroSlider", "ProductShowcase"] as const;
  const doc = (type: (typeof widgets)[number], props: Record<string, unknown> = {}) => ({ id: "w", type, version: 1, props });
  const ok = (box: unknown, type: (typeof widgets)[number] = "HeroSlider") => validateDoc({ version: 1, blocks: [doc(type, { box })] }).success;

  it("accepts lengths in px, rem, em and %, keywords, negative margins and aspect ratios", () => {
    expect(
      ok({
        desktop: { marginTop: "-12px", marginLeft: "auto", paddingTop: "2rem", paddingLeft: "1.5em", width: "80%", minWidth: "320px", maxWidth: "none", height: "40rem", minHeight: "300px", maxHeight: "none", aspectRatio: "16 / 9" },
        tablet: { width: "100%", paddingTop: "24px" },
        mobile: { aspectRatio: "4/5", marginBottom: "0px" },
      }),
    ).toBe(true);
    expect(ok({})).toBe(true);
    for (const type of widgets) expect(ok({ desktop: { paddingTop: "10px" } }, type), type).toBe(true);
  });

  it("rejects anything that is not a plain length (no CSS functions, no script, no wrong units)", () => {
    for (const bad of [
      { paddingTop: "-4px" }, // padding cannot be negative
      { paddingTop: "10%" }, // padding has no percent
      { height: "50%" }, // heights have no percent
      { minWidth: "auto" },
      { width: "calc(100% - 20px)" },
      { width: "10vw" },
      { width: "10" },
      { marginTop: "10px; background:url(x)" },
      { maxWidth: "9999999px" },
      { aspectRatio: "wide" },
    ]) {
      expect(ok({ desktop: bad }), JSON.stringify(bad)).toBe(false);
    }
  });

  it("turns a layout into one CSS variable per device and property, and resolves inheritance", async () => {
    const { layoutStyle, inheritedLayoutValue, layoutHasAspectRatio } = await import("../src/index.ts");
    const layout = { desktop: { paddingTop: "64px", width: "1200px" }, tablet: { paddingTop: "40px" }, mobile: { aspectRatio: "4 / 5" } };
    expect(layoutStyle(layout)).toEqual({ "--l-d-pt": "64px", "--l-d-w": "1200px", "--l-t-pt": "40px", "--l-m-ar": "4 / 5" });
    expect(inheritedLayoutValue(layout, "mobile", "paddingTop")).toBe("40px"); // tablet's value, which overrides desktop's
    expect(inheritedLayoutValue(layout, "mobile", "width")).toBe("1200px");
    expect(inheritedLayoutValue(layout, "desktop", "paddingTop")).toBeUndefined();
    expect(layoutHasAspectRatio(layout)).toBe(true);
    expect(layoutHasAspectRatio({ desktop: { width: "1px" } })).toBe(false);
  });

  it("renders the layout as variables on the widget and keeps the older padding as the showcase default", () => {
    const box = { desktop: { paddingTop: "80px", marginBottom: "2rem", maxWidth: "900px" }, tablet: { paddingTop: "50px" }, mobile: { paddingTop: "20px", aspectRatio: "4/5" } };
    for (const type of widgets) {
      const html = renderMarkup(<>{renderTree([doc(type, { box })], { data: { w: { kind: "product-tabs", tabs: [{ products: [] }] } } })}</>);
      for (const v of ["--l-d-pt:80px", "--l-d-mb:2rem", "--l-d-mxw:900px", "--l-t-pt:50px", "--l-m-pt:20px", "--l-m-ar:4/5"]) expect(html, `${type} ${v}`).toContain(v);
      expect(html).toContain("bsb-lay");
    }
    expect(renderMarkup(<>{renderTree([doc("HeroSlider", { box })], {})}</>)).toContain("bsb-hs-ar"); // an aspect ratio frees the slide height
    const showcase = validateDoc({ version: 1, blocks: [doc("ProductShowcase")] });
    if (showcase.success) expect(showcase.data.blocks[0]?.props).toMatchObject({ box: { desktop: { paddingTop: "64px", paddingBottom: "64px" }, mobile: { paddingTop: "48px" } } });
    const slider = validateDoc({ version: 1, blocks: [doc("HeroSlider")] });
    if (slider.success) expect(slider.data.blocks[0]?.props).toMatchObject({ box: {} });
  });
});
