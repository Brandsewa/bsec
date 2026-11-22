import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { BannerSchema, normalizeStoreHref, renderBlockTree, type BlockInstance } from "../src/index.ts";

const banner = (props: Record<string, unknown>): BlockInstance => ({ id: "b1", type: "Banner", version: 1, props: BannerSchema.parse(props) });
const render = (blocks: BlockInstance[], ctx: Record<string, unknown> = {}) => renderToStaticMarkup(<>{renderBlockTree(blocks, ctx as never)}</>);

describe("normalizeStoreHref (storefront audit: staging host and pasted URLs)", () => {
  it("turns a link to the store's own platform host into a relative path", () => {
    expect(normalizeStoreHref("https://shop.bcom.si/products/tea?x=1#top")).toBe("/products/tea?x=1#top");
    expect(normalizeStoreHref("http://shop.bcom.si")).toBe("/");
    expect(normalizeStoreHref("https://shop.bcom.si?ref=a")).toBe("/?ref=a");
  });

  it("leaves other hosts, platform app hosts and ordinary paths alone", () => {
    expect(normalizeStoreHref("https://admin.bcom.si")).toBe("https://admin.bcom.si");
    expect(normalizeStoreHref("https://www.bcom.si/pricing")).toBe("https://www.bcom.si/pricing");
    expect(normalizeStoreHref("https://bcom.si/pricing")).toBe("https://bcom.si/pricing");
    expect(normalizeStoreHref("https://example.com/a")).toBe("https://example.com/a");
    expect(normalizeStoreHref("https://evil-bcom.si/a")).toBe("https://evil-bcom.si/a");
    expect(normalizeStoreHref("/collections/teas")).toBe("/collections/teas");
    expect(normalizeStoreHref("mailto:hi@shop.in")).toBe("mailto:hi@shop.in");
  });

  it("keeps only the URL when one was pasted after a path prefix", () => {
    expect(normalizeStoreHref("/collections/https://shop.example/collections/teas-for-cold")).toBe("https://shop.example/collections/teas-for-cold");
    expect(normalizeStoreHref("/collections/https://shop.bcom.si/collections/teas")).toBe("/collections/teas");
  });

  it("is applied to a banner link, so old saved content is fixed when it renders", () => {
    const html = render([banner({ text: "Back in stock", link: "https://shop.bcom.si/products/pack" })]);
    expect(html).toContain('href="/products/pack"');
    expect(html).not.toContain("bcom.si");
  });

  it("still refuses unsafe links", () => {
    expect(BannerSchema.safeParse({ text: "x", link: "javascript:alert(1)" }).success).toBe(false);
  });
});

describe("announcement bar free-shipping token", () => {
  const withToken = banner({ text: "Free shipping on orders over {{free_shipping_threshold}}" });
  const data = (paise: number | null) => ({ data: { b1: { kind: "banner", freeShippingThresholdPaise: paise } } });

  it("shows the store's real threshold in the shopper's currency format", () => {
    expect(render([withToken], data(149700))).toContain("Free shipping on orders over ₹1,497");
    expect(render([withToken], { ...data(99900), currency: "INR", locale: "en-IN" })).toContain("over ₹999<");
  });

  it("draws no bar when the store has no free-shipping threshold, instead of quoting a number", () => {
    expect(render([withToken], data(null))).not.toContain("Free shipping");
  });

  it("keeps the other messages when only the free-shipping one is dropped", () => {
    const two = banner({ text: "Free shipping over {{free_shipping_threshold}}", messages: [{ text: "New teas in" }] });
    const html = render([two], data(null));
    expect(html).toContain("New teas in");
    expect(html).not.toContain("Free shipping");
  });

  it("leaves the token visible where there is no store data (the editors)", () => {
    expect(render([withToken])).toContain("{{free_shipping_threshold}}");
  });

  it("does not touch a banner with no token", () => {
    expect(render([banner({ text: "Sale on now" })], data(null))).toContain("Sale on now");
  });
});
