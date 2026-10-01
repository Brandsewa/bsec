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
