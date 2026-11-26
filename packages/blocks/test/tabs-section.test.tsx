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

describe("Tabs: spacing, custom fields, accordion icon", () => {
  it("has no padding or width of its own", () => {
    const html = render(widget());
    expect(html).not.toContain("bsb-py");
    expect(html).not.toContain("bsb-w ");
    expect(html).toContain("bsb-tb-wrap");
  });

  it("title and body padding take four sides, falling back to the older two values", () => {
    const four = render(widget({ titlePadding: { top: 1, right: 2, bottom: 3, left: 4 }, bodyPadding: { top: 5, right: 6, bottom: 7, left: 8 } }));
    expect(four).toContain("--tb-pt:1px;--tb-pr:2px;--tb-pb:3px;--tb-pl:4px");
    expect(four).toContain("--tb-body-pt:5px;--tb-body-pr:6px;--tb-body-pb:7px;--tb-body-pl:8px");
    const legacy = render(widget({ titlePaddingX: 20, titlePaddingY: 9 }));
    expect(legacy).toContain("--tb-pt:9px;--tb-pr:20px;--tb-pb:9px;--tb-pl:20px");
    const partial = render(widget({ titlePadding: { left: 30 }, titlePaddingX: 20, titlePaddingY: 9 }));
    expect(partial).toContain("--tb-pt:9px;--tb-pr:20px;--tb-pb:9px;--tb-pl:30px");
  });

  it("rejects padding outside 0-96 and an accordion icon outside 8-32", () => {
    expect(TabsSectionSchema.safeParse({ titlePadding: { top: 120 } }).success).toBe(false);
    expect(TabsSectionSchema.safeParse({ accordionIconSize: 4 }).success).toBe(false);
    expect(render(widget({ accordionIconSize: 20 }))).toContain("--tb-acc-icon:20px");
  });

  it("pulls a custom field into the content where its token is, and nothing when the product has no value", () => {
    const items = [{ title: "T", content: "Before\n\n{{field:ingredients}}\n\nAfter {{field:missing}}" }];
    const live = render(widget({ items }), { renderCustomFieldValue: (k: string) => (k === "ingredients" ? <p>Flour and water</p> : null) });
    expect(live).toContain("Flour and water");
    expect(live).toContain('data-custom-field="ingredients"');
    expect(live).not.toContain("missing");
    expect(live).not.toContain("{{field");
    expect(live.indexOf("Before")).toBeLessThan(live.indexOf("Flour and water"));
    expect(live.indexOf("Flour and water")).toBeLessThan(live.indexOf("After"));
  });

  it("shows a labelled sample where there is no product (editor, previews)", () => {
    const html = render(widget({ items: [{ title: "T", content: "{{field:ingredients}}" }] }));
    expect(html).toContain("Custom field: ingredients");
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
