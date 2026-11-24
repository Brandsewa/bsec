import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { TabsSectionSchema, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const widget = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "t1", type: "TabsSection", version: 1, props });
const render = (b: BlockInstance, ctx: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree([b], ctx as never)}</>);

describe("Tabs", () => {
  it("has sensible defaults: underline titles, accordion on phones, first tab open", () => {
    const p = TabsSectionSchema.parse({});
    expect(p).toMatchObject({ tabsPosition: "top", titleStyle: "underline", mobileMode: "accordion", defaultTab: 1, accordionOpenFirst: true });
    expect(p.items.length).toBeGreaterThanOrEqual(2);
  });

  it("rejects values outside the editor's choices", () => {
    expect(TabsSectionSchema.safeParse({ titleStyle: "pill" }).success).toBe(false);
    expect(TabsSectionSchema.safeParse({ mobileMode: "stack" }).success).toBe(false);
    expect(TabsSectionSchema.safeParse({ cardRadius: 99 }).success).toBe(false);
    expect(TabsSectionSchema.safeParse({ items: [] }).success).toBe(false);
    expect(TabsSectionSchema.safeParse({ items: [{ title: "", content: "x" }] }).success).toBe(false);
  });

  it("validates as a document block", () => {
    const r = validateBlockDocument({ version: 1, blocks: [widget()] });
    expect(r.success).toBe(true);
  });

  it("renders one tablist, one panel per tab, rich-text bodies and the first tab current", () => {
    const html = render(widget({ items: [{ title: "One", content: "**bold** and *it*\n\n- a\n- b" }, { title: "Two", content: "second" }] }));
    expect(html).toContain('role="tablist"');
    expect((html.match(/role="tab"/g) ?? []).length).toBe(2);
    expect((html.match(/role="tabpanel"/g) ?? []).length).toBe(2);
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<ul><li>a</li><li>b</li></ul>");
    // only the first row is current and (accordion default) open
    expect((html.match(/data-current/g) ?? []).length).toBe(1);
    expect((html.match(/data-open/g) ?? []).length).toBe(1);
    expect(html).toContain('aria-selected="true"');
  });

  it("opens the tab chosen as default and keeps tabs on phones when asked", () => {
    const html = render(widget({ defaultTab: 2, mobileMode: "tabs", accordionOpenFirst: false, titleStyle: "cards", cardRadius: 14 }));
    expect(html).toContain("bsb-tb-mobile-tabs");
    expect(html).toContain("bsb-tb-style-cards");
    expect(html).toContain("--tb-radius:14px");
    expect(html).not.toContain("data-open");
    const items = html.split("data-tb-item").slice(1);
    expect(items[1]).toContain("data-current");
    expect(items[0]).not.toContain("data-current");
  });

  it("sanitises script in a body", () => {
    const html = render(widget({ items: [{ title: "T", content: "<script>alert(1)</script>hi [x](javascript:alert(1))" }] }));
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });
});

describe("product reviews block", () => {
  it("draws the live reviews where it sits when the product page provides them", () => {
    const b: BlockInstance = { id: "r1", type: "Reviews", version: 1, props: {} };
    const live = render(b, { renderProductReviews: () => <div data-testid="live-reviews">live</div> });
    expect(live).toContain("live-reviews");
    expect(render(b)).not.toContain("live-reviews");
  });
});
