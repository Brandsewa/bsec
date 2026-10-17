import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CollectionShowcaseSchema, renderBlockTree, validateBlockDocument, buildSampleRenderData, type BlockInstance } from "../src/index.ts";

const widget = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "c", type: "CollectionShowcase", version: 1, props });
const cols = (n: number) => Array.from({ length: n }, (_, i) => ({ slug: `c-${i + 1}`, title: `Collection ${i + 1} <b>x</b>`, description: "Desc" }));
const render = (props: Record<string, unknown>, n = 3) =>
  renderToStaticMarkup(<>{renderBlockTree([widget(props)], { data: { c: { kind: "collections", collections: cols(n) } } as never })}</>);

describe("Collection showcase", () => {
  it("validates with defaults and keeps settings inside their limits", () => {
    expect(validateBlockDocument({ version: 1, blocks: [widget()] }).success).toBe(true);
    expect(CollectionShowcaseSchema.parse({})).toMatchObject({ columns: "4", tabletLayout: "grid", mobileLayout: "carousel", headerAlign: "left" });
    expect(CollectionShowcaseSchema.safeParse({ columns: "7" }).success).toBe(false);
    expect(CollectionShowcaseSchema.safeParse({ mobileLayout: "slider" }).success).toBe(false);
    expect(CollectionShowcaseSchema.safeParse({ buttonHref: "javascript:alert(1)" }).success).toBe(false);
    expect(CollectionShowcaseSchema.safeParse({ collectionSlugs: Array.from({ length: 25 }, (_, i) => `c${i}`) }).success).toBe(false);
  });

  it("draws every collection as a link card with escaped text, with no row limit", () => {
    const html = render({}, 8);
    expect(html.match(/class="bsb-ccard bsb-cs-card"/g)).toHaveLength(8);
    expect(html).toContain('href="/collections/c-8"');
    expect(html).toContain("Collection 1 &lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("--cols:4");
  });

  it("moves the heading and shows the button only with a link", () => {
    expect(render({ headerAlign: "right" })).toContain("bsb-cs-head-right");
    expect(render({ headerAlign: "center" })).toContain("bsb-cs-head-center");
    expect(render({})).toContain('href="/collections"');
    const none = render({ buttonHref: "" });
    expect(none).not.toContain("bsb-cs-btn");
    expect(render({ buttonHref: "/collections/all", buttonLabel: "See all" })).toContain("See all");
  });

  it("lets tablets and phones choose grid or carousel", () => {
    const html = render({ tabletLayout: "carousel", mobileLayout: "grid", columnsTablet: "3", columnsMobile: "2" });
    expect(html).toContain("bsb-cs-t-carousel");
    expect(html).toContain("bsb-cs-m-grid");
    expect(html).toContain("--cols-t:3");
    expect(html).toContain("--cols-m:2");
  });

  it("shows a note when nothing is selected, and eight samples in the theme editor", () => {
    expect(render({}, 0)).toContain("No collections selected yet.");
    const sample = buildSampleRenderData([widget()]);
    expect(sample.data["c"]?.kind === "collections" ? sample.data["c"].collections : []).toHaveLength(8);
  });
});
