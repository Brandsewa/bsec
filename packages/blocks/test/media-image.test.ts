import { describe, expect, it } from "vitest";
import { mediaImage, buildDerivativeUrl } from "../src/media-image.ts";

describe("mediaImage helper in @bs/blocks", () => {
  it("returns empty src when item is null or undefined", () => {
    expect(mediaImage(null)).toEqual({ src: "" });
    expect(mediaImage(undefined)).toEqual({ src: "" });
  });

  it("handles derivatives correctly and formats srcSet and sizes", () => {
    const item = {
      url: "https://cdn.example.com/store/image.jpg",
      width: 1920,
      height: 1080,
      dominantColor: "#abcdef",
      focalX: 0.4,
      focalY: 0.6,
      derivatives: {
        w320: { key: "store/_derived/img/w320.webp", width: 320, height: 180, bytes: 5000 },
        w640: { key: "store/_derived/img/w640.webp", width: 640, height: 360, bytes: 15000 },
        w1024: { key: "store/_derived/img/w1024.webp", width: 1024, height: 576, bytes: 45000 },
        w1600: { key: "store/_derived/img/w1600.webp", width: 1600, height: 900, bytes: 95000 },
      },
    };

    const res = mediaImage(item, { sizes: "(max-width: 768px) 100vw, 800px" });
    expect(res.src).toBe("https://cdn.example.com/store/_derived/img/w1024.webp");
    expect(res.srcSet).toContain("https://cdn.example.com/store/_derived/img/w320.webp 320w");
    expect(res.srcSet).toContain("https://cdn.example.com/store/_derived/img/w1600.webp 1600w");
    expect(res.sizes).toBe("(max-width: 768px) 100vw, 800px");
    expect(res.width).toBe(1920);
    expect(res.height).toBe(1080);
    expect(res.aspectRatio).toBe(1.7778);
    expect(res.dominantColor).toBe("#abcdef");
    expect(res.placeholderColor).toBe("#abcdef");
    expect(res.objectPosition).toBe("40% 60%");
  });

  it("buildDerivativeUrl handles relative and absolute paths", () => {
    expect(buildDerivativeUrl("store/_derived/img/w320.webp")).toBe("/media/store/_derived/img/w320.webp");
    expect(buildDerivativeUrl("/store/_derived/img/w320.webp")).toBe("/media/store/_derived/img/w320.webp");
    expect(buildDerivativeUrl("store/_derived/img/w320.webp", "https://cdn.store.com/store/img.jpg")).toBe(
      "https://cdn.store.com/store/_derived/img/w320.webp",
    );
  });
});
