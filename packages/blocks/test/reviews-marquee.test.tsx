import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ReviewsMarqueeSchema, renderBlockTree, validateBlockDocument, type BlockInstance, type BlockReview } from "../src/index.ts";

const widget = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "w", type: "ReviewsMarquee", version: 1, props });
const review = (n: number, over: Partial<BlockReview> = {}): BlockReview => ({
  id: `r${n}`,
  rating: 5,
  title: `Title ${n} <b>x</b>`,
  body: `Body ${n}`,
  reviewerName: `Reviewer ${n}`,
  verified: true,
  productTitle: `Product ${n}`,
  createdAt: "2026-03-01T10:00:00.000Z",
  ...over,
});
const render = (blocks: BlockInstance[], data: Record<string, unknown> | undefined) =>
  renderToStaticMarkup(<>{renderBlockTree(blocks, { data: data as never })}</>);

describe("Floating reviews widget", () => {
  it("validates with defaults and keeps its settings inside their limits", () => {
    expect(validateBlockDocument({ version: 1, blocks: [widget()] }).success).toBe(true);
    expect(ReviewsMarqueeSchema.parse({})).toMatchObject({ textSide: "right", source: "top", minRating: 4, columns: "2", hideWhenEmpty: true });
    expect(ReviewsMarqueeSchema.safeParse({ limit: 25 }).success).toBe(false);
    expect(ReviewsMarqueeSchema.safeParse({ minRating: 0 }).success).toBe(false);
    expect(ReviewsMarqueeSchema.safeParse({ speed: "turbo" }).success).toBe(false);
  });

  it("draws each review's title, text, stars, name and details, with text escaped", () => {
    const html = render([widget({ showDate: true })], { w: { kind: "reviews", reviews: [review(1), review(2)] } });
    expect(html).toContain("Body 1");
    expect(html).toContain("Reviewer 2");
    expect(html).toContain("5 out of 5 stars");
    expect(html).toContain('aria-label="Verified buyer"');
    expect(html).not.toContain("Verified buyer</span>");
    expect(html).toContain("on Product 1");
    expect(html).toContain("Title 1 &lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("bsb-rm-track");
    expect(html).toContain("Loved by our customers");
  });

  it("repeats the list once, hidden from assistive tech, so the loop has no jump", () => {
    const html = render([widget({ columns: "1" })], { w: { kind: "reviews", reviews: [review(1), review(2)] } });
    expect(html.match(/bsb-rm-card/g)).toHaveLength(4);
    expect(html.match(/aria-hidden="true"><span class="bsb-stars"|aria-hidden="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it("follows the toggles and the heading side", () => {
    const data = { w: { kind: "reviews", reviews: [review(1)] } };
    const bare = render([widget({ showProduct: false, showVerified: false, showTitle: false })], data);
    expect(bare).not.toContain("on Product 1");
    expect(bare).not.toContain("Verified buyer");
    expect(bare).not.toContain("Title 1");
    expect(render([widget({ textSide: "left" })], data)).toContain("bsb-rm-flip");
    expect(render([widget()], data)).not.toContain("bsb-rm-flip");
  });

  it("hides when there are no reviews unless asked to stay, and shows labelled samples without a store", () => {
    expect(render([widget()], { w: { kind: "reviews", reviews: [] } })).toBe("");
    expect(render([widget({ hideWhenEmpty: false })], { w: { kind: "reviews", reviews: [] } })).toContain("No reviews to show yet.");
    expect(render([widget()], {})).toContain("bsb-rm-card");
  });

  it("shows a button only when its link is filled in, side by side", () => {
    const data = { w: { kind: "reviews", reviews: [review(1)] } };
    expect(render([widget()], data)).not.toContain("bsb-rm-btns");
    const one = render([widget({ button1Href: "/reviews" })], data);
    expect(one).toContain('href="/reviews"');
    expect(one).toContain("See more reviews");
    expect(one).not.toContain("Learn more");
    const two = render([widget({ button1Href: "/reviews", button2Href: "https://example.com/about" })], data);
    expect(two).toContain("Learn more");
    expect(ReviewsMarqueeSchema.safeParse({ button1Href: "javascript:alert(1)" }).success).toBe(false);
  });

  it("places the heading text on top, middle, bottom or split", () => {
    const data = { w: { kind: "reviews", reviews: [review(1)] } };
    for (const pos of ["top", "middle", "bottom", "split"]) expect(render([widget({ textPosition: pos })], data)).toContain(`bsb-rm-pos-${pos}`);
  });

  it("opens each review in a pop-up with the full text and a link to its product", () => {
    const html = render([widget()], { w: { kind: "reviews", reviews: [review(1, { productSlug: "thing" })] } });
    expect(html).toContain('for="rm-w-r1"');
    expect(html).toContain('id="rm-w-r1"');
    expect(html).toContain('href="/products/thing"');
  });

  it("shows the small line above the heading only when it is filled in", () => {
    const data = { w: { kind: "reviews", reviews: [review(1)] } };
    expect(render([widget()], data)).not.toContain("bsb-rm-eyebrow");
    expect(render([widget({ eyebrow: "Testimonials" })], data)).toContain('<p class="bsb-rm-eyebrow">Testimonials</p>');
  });

  it("draws a picture under the text by default, or above it, only when one is chosen", () => {
    const data = { w: { kind: "reviews", reviews: [review(1)] } };
    const withCtx = (props: Record<string, unknown>) =>
      renderToStaticMarkup(<>{renderBlockTree([widget(props)], { data: data as never, mediaUrl: (id: string) => `https://img.test/${id}.jpg` })}</>);
    expect(render([widget()], data)).not.toContain("bsb-rm-img");
    const below = withCtx({ imageMediaId: "11111111-1111-4111-8111-111111111111", imageAlt: "Our farm" });
    expect(below).toContain("bsb-rm-img");
    expect(below).toContain('alt="Our farm"');
    expect(below).not.toContain("bsb-rm-img-above");
    expect(withCtx({ imageMediaId: "11111111-1111-4111-8111-111111111111", imagePlace: "above" })).toContain("bsb-rm-img-above");
  });
});
