import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { HeroSliderSchema, BlogShowcaseSchema, CollectionProductsSchema, MultiCardSchema, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const block = (type: string, props: Record<string, unknown> = {}): BlockInstance => ({ id: "w", type: type as never, version: 1, props });
const render = (b: BlockInstance, base: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree([b], base as never)}</>);

describe("Multi card", () => {
  it("validates with defaults and keeps settings inside their limits", () => {
    expect(validateBlockDocument({ version: 1, blocks: [block("MultiCard")] }).success).toBe(true);
    expect(MultiCardSchema.parse({})).toMatchObject({ perRowDesktop: "3", perRowTablet: "2", perRowMobile: "1", tabletLayout: "grid", mobileLayout: "slider" });
    expect(MultiCardSchema.safeParse({ perRowDesktop: "5" }).success).toBe(false);
    expect(MultiCardSchema.safeParse({ cardRadius: 100 }).success).toBe(false);
    expect(MultiCardSchema.safeParse({ items: [] }).success).toBe(false);
    expect(MultiCardSchema.safeParse({ items: [{ heading: "x", linkHref: "javascript:alert(1)" }] }).success).toBe(false);
    expect(MultiCardSchema.safeParse({ cardBg: "red; background:url(x)" }).success).toBe(false);
  });

  it("draws one card per item with escaped text and passes the look as CSS variables", () => {
    const html = render(block("MultiCard", { cardPadding: 30, cardRadius: 20, borderWidth: 2, borderColor: "#112233", gap: 24, items: [{ icon: "star", heading: "A <b>b</b>", text: "Text", linkLabel: "Go", linkHref: "/x" }, { heading: "Two" }] }));
    expect(html.match(/class="bsb-mc-card/g)).toHaveLength(2);
    expect(html).toContain("A &lt;b&gt;b&lt;/b&gt;");
    expect(html).toContain("--mc-pad:30px");
    expect(html).toContain("--mc-rad:20px");
    expect(html).toContain("--mc-bw:2px");
    expect(html).toContain("--mc-bc:#112233");
    expect(html).toContain("--psc-gap:24px");
    expect(html).toContain('href="/x"');
  });

  it("switches each element off, and is a plain grid (no slider markup) when both devices are grids", () => {
    const off = render(block("MultiCard", { showIcon: false, showHeading: false, showText: false, showLink: false, mobileLayout: "grid" }));
    for (const gone of ["bsb-mc-icon", "bsb-mc-title", "bsb-mc-text", "bsb-mc-link"]) expect(off).not.toContain(gone);
    expect(off).toContain("bsb-mc-grid");
    expect(off).not.toContain("data-psc-track");
  });

  it("has slider controls when a device slides, and a background picture with its darkening", () => {
    const html = render(block("MultiCard", { cardOverlay: 50, items: [{ heading: "Pic", bgMediaId: "m1" }] }), { mediaUrl: (id: string) => `/media/${id}.jpg` });
    expect(html).toContain("data-psc-track");
    expect(html).toContain("data-psc-dots");
    expect(html).toContain('src="/media/m1.jpg"');
    expect(html).toContain("opacity:0.5");
  });

  it("aligns the content vertically", () => {
    expect(render(block("MultiCard", { contentAlign: "end" }))).toContain("bsb-mc-v-end");
  });
});

describe("Collection products widget", () => {
  it("validates, defaults to a bare grid with the collection name only, and has the recommended settings", () => {
    expect(validateBlockDocument({ version: 1, blocks: [block("CollectionProducts")] }).success).toBe(true);
    expect(CollectionProductsSchema.parse({})).toMatchObject({ showTitle: true, showDescription: false, showLongDescription: false, columns: "4", width: "wide" });
    expect(CollectionProductsSchema.safeParse({ columns: "9" }).success).toBe(false);
  });

  it("hands the storefront its options with the bare flag set", () => {
    let seen: Record<string, unknown> | undefined;
    render(block("CollectionProducts", { columns: "3", showLongDescription: true }), {
      renderCollectionListing: (o: Record<string, unknown>) => {
        seen = o;
        return null;
      },
    });
    expect(seen).toMatchObject({ bare: true, columns: "3", showLongDescription: true, showTitle: true });
  });

  it("draws a labelled sample in the editors", () => {
    expect(render(block("CollectionProducts"))).toContain("Collection products");
  });
});

describe("Blog slider", () => {
  const posts = Array.from({ length: 4 }, (_, i) => ({ slug: `p${i}`, title: `Post ${i} <b>x</b>`, excerpt: "Summary", publishedAt: "2026-01-02T00:00:00Z", categoryName: "News" }));
  const data = { w: { kind: "blog-posts", posts, viewAllHref: "/blog" } };

  it("validates with defaults and limits the cards per row", () => {
    expect(validateBlockDocument({ version: 1, blocks: [block("BlogShowcase")] }).success).toBe(true);
    expect(BlogShowcaseSchema.parse({})).toMatchObject({ layout: "slider", perViewDesktop: 3, perViewTablet: 2, perViewMobile: 1, mobileLayout: "slider", listThumbnail: true });
    expect(BlogShowcaseSchema.safeParse({ perViewDesktop: 6 }).success).toBe(false);
    expect(BlogShowcaseSchema.safeParse({ mobileLayout: "carousel" }).success).toBe(false);
  });

  it("draws a slide per post with the cards per row for each device and escaped text", () => {
    const html = render(block("BlogShowcase", { perViewDesktop: 4, perViewTablet: 3, perViewMobile: 2 }), { data });
    expect(html.match(/data-psc-item/g)).toHaveLength(4);
    expect(html).toContain("--psc-d:4");
    expect(html).toContain("--psc-t:3");
    expect(html).toContain("--psc-m:2");
    expect(html).toContain("Post 0 &lt;b&gt;x&lt;/b&gt;");
    expect(html).toContain("data-psc-dots");
  });

  it("offers a phone list with or without thumbnails, and hides the dots on desktop by default", () => {
    expect(render(block("BlogShowcase", { mobileLayout: "list" }), { data })).toContain("bsb-bs-m-list");
    expect(render(block("BlogShowcase", { mobileLayout: "list", listThumbnail: false }), { data })).toContain("bsb-bs-nothumb");
    expect(render(block("BlogShowcase"), { data })).toContain("bsb-hs-dots-mobile");
    expect(render(block("BlogShowcase", { dotsDesktop: true }), { data })).not.toContain("bsb-hs-dots-mobile");
  });

  it("draws nothing without posts when asked to hide, and a message otherwise", () => {
    const empty = { w: { kind: "blog-posts", posts: [], viewAllHref: "/blog" } };
    expect(render(block("BlogShowcase"), { data: empty })).toBe("");
    expect(render(block("BlogShowcase", { hideWhenEmpty: false }), { data: empty })).toContain("No posts to show yet");
  });
});

describe("slider dots", () => {
  it("are hidden on desktop and tablet (arrows take over) unless asked for, for the hero slider and product showcase", () => {
    const one = HeroSliderSchema.parse({}).slides[0]!;
    const slides = [one, one];
    expect(render(block("HeroSlider", { slides }))).toContain("bsb-hs-dots-mobile");
    expect(render(block("HeroSlider", { slides, dotsDesktop: true }))).not.toContain("bsb-hs-dots-mobile");
    expect(render(block("HeroSlider", { slides, arrows: false }))).not.toContain("bsb-hs-dots-mobile");
  });
});
