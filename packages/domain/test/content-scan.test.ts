import { describe, expect, it } from "vitest";
import { countBlocksWithoutAlt, countImagesWithoutAlt, hrefsInHtml } from "../src/admin/content-scan.ts";

describe("countImagesWithoutAlt", () => {
  it("counts pictures with a missing, empty or blank alt and ignores described and decorative ones", () => {
    const html = [
      '<img src="/a.png">',
      '<img src="/b.png" alt="">',
      "<img src='/c.png' alt='  '>",
      '<img src="/d.png" alt="A cup of tea">',
      '<img src="/e.png" role="presentation">',
      "<p>text</p>",
    ].join("");
    expect(countImagesWithoutAlt(html)).toBe(3);
    expect(countImagesWithoutAlt("<p>no pictures</p>")).toBe(0);
  });
});

describe("countBlocksWithoutAlt", () => {
  it("counts Image blocks that have a picture and no alt text, however deep", () => {
    const doc = {
      blocks: [
        { type: "Image", props: { mediaId: "m1", alt: "" } },
        { type: "Image", props: { imageUrl: "https://cdn.example/x.webp" } },
        { type: "Image", props: { mediaId: "m2", alt: "Tea leaves" } },
        { type: "Image", props: { alt: "" } },
        { type: "Section", props: {}, children: [{ type: "Image", props: { mediaId: "m3", alt: "   " } }] },
      ],
    };
    expect(countBlocksWithoutAlt(doc)).toBe(3);
  });
});

describe("hrefsInHtml", () => {
  it("reads link addresses in order, with either quote style and decoded ampersands", () => {
    const html = '<p><a class="x" href="/products/tea?a=1&amp;b=2">Tea</a> <a href=\'https://example.com\'>Out</a> <a href="">Empty</a><a name="top">Anchor</a></p>';
    expect(hrefsInHtml(html)).toEqual(["/products/tea?a=1&b=2", "https://example.com"]);
  });
});
