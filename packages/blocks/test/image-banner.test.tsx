import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ImageBannerSchema, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const widget = (props: Record<string, unknown> = {}): BlockInstance => ({ id: "b", type: "ImageBanner", version: 1, props });
const render = (props: Record<string, unknown> = {}, media: Record<string, string> = {}) =>
  renderToStaticMarkup(<>{renderBlockTree([widget(props)], { mediaUrl: (id: string) => media[id] ?? null })}</>);

describe("Image banner", () => {
  it("validates with defaults and rejects bad settings", () => {
    expect(validateBlockDocument({ version: 1, blocks: [widget()] }).success).toBe(true);
    expect(ImageBannerSchema.parse({})).toMatchObject({ imageFit: "cover", contentAlign: "left", contentVertical: "top", height: "lg" });
    expect(ImageBannerSchema.safeParse({ contentVertical: "split" }).success).toBe(false);
    expect(ImageBannerSchema.safeParse({ titleColor: "red" }).success).toBe(false);
    expect(ImageBannerSchema.safeParse({ button1Href: "javascript:alert(1)" }).success).toBe(false);
  });

  it("draws the uploaded image, the text group and the chosen position classes", () => {
    const html = render({ backgroundMediaId: "m1", imageFit: "contain", contentAlign: "right", contentVertical: "bottom", textAlign: "center", eyebrow: "E <b>x</b>" }, { m1: "https://media.example/a.jpg" });
    expect(html).toContain("https://media.example/a.jpg");
    expect(html).toContain("bsb-ib-fit-contain");
    expect(html).toContain("bsb-ib-hz-right");
    expect(html).toContain("bsb-ib-v-bottom");
    expect(html).toContain("bsb-align-center");
    expect(html).toContain("E &lt;b&gt;x&lt;/b&gt;");
  });

  it("works without an image, hides empty text and shows buttons only with a link", () => {
    const bare = render({ eyebrow: "", title: "", description: "" });
    expect(bare).not.toContain("<img");
    expect(bare).not.toContain("bsb-ib-eyebrow");
    expect(bare).not.toContain("bsb-ib-btns");
    const two = render({ button1Href: "/shop", button2Href: "https://example.com" });
    expect(two).toContain('href="/shop"');
    expect(two).toContain("Learn more");
    expect(render({ button1Href: "/shop" })).not.toContain("Learn more");
  });

  it("applies custom text colours as variables", () => {
    expect(render({ titleColor: "#b45309" })).toContain("--ib-title:#b45309");
  });
});
