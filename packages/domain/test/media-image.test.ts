import { describe, expect, it } from "vitest";
import { mediaImage, buildDerivativeUrl } from "../src/media/image-helper.ts";

describe("mediaImage pure helper (Phase 4 Plan S2, S3)", () => {
  it("returns empty src when item is null or undefined", () => {
    expect(mediaImage(null)).toEqual({ src: "" });
    expect(mediaImage(undefined)).toEqual({ src: "" });
  });

  it("prioritizes worker derivatives over CDN_BASE_URL and originalUrl", () => {
    const item = {
      url: "/media/store1/products/hero.jpg",
      width: 2000,
      height: 1000,
      dominantColor: "#1a2b3c",
      focalX: 0.35,
      focalY: 0.65,
      derivatives: [
        { w: 320, h: 160, bytes: 12000, key: "store1/_derived/img1/w320.webp" },
        { w: 640, h: 320, bytes: 34000, key: "store1/_derived/img1/w640.webp" },
        { w: 1024, h: 512, bytes: 78000, key: "store1/_derived/img1/w1024.webp" },
        { w: 1600, h: 800, bytes: 150000, key: "store1/_derived/img1/w1600.webp" },
      ],
    };

    const res = mediaImage(item, { cdnBaseUrl: "https://cdn.example.com" });

    // Largest derivative <= 1024px is 1024px
    expect(res.src).toBe("/media/store1/_derived/img1/w1024.webp");
    expect(res.srcSet).toContain("/media/store1/_derived/img1/w320.webp 320w");
    expect(res.srcSet).toContain("/media/store1/_derived/img1/w640.webp 640w");
    expect(res.srcSet).toContain("/media/store1/_derived/img1/w1024.webp 1024w");
    expect(res.srcSet).toContain("/media/store1/_derived/img1/w1600.webp 1600w");
    expect(res.width).toBe(2000);
    expect(res.height).toBe(1000);
    expect(res.placeholderColor).toBe("#1a2b3c");
    expect(res.objectPosition).toBe("35% 65%");
  });

  it("preserves absolute origin in derivative URLs when originalUrl is absolute", () => {
    const item = {
      url: "https://pub-r2.store.com/store1/products/sample.png",
      derivatives: [
        { w: 320, h: 240, key: "store1/_derived/img2/w320.webp" },
      ],
    };

    const res = mediaImage(item);
    expect(res.src).toBe("https://pub-r2.store.com/store1/_derived/img2/w320.webp");
    expect(res.srcSet).toBe("https://pub-r2.store.com/store1/_derived/img2/w320.webp 320w");
  });

  it("uses CDN_BASE_URL when derivatives are missing but CDN is configured", () => {
    const item = {
      url: "/media/store1/products/shoe.jpg",
      width: 1200,
      height: 800,
    };

    const res = mediaImage(item, { cdnBaseUrl: "https://images.example.com" });

    // 1600 is > original width 1200, so it must not upscale
    expect(res.srcSet).toContain("https://images.example.com/cdn-cgi/image/width=320,format=auto/media/store1/products/shoe.jpg 320w");
    expect(res.srcSet).toContain("https://images.example.com/cdn-cgi/image/width=640,format=auto/media/store1/products/shoe.jpg 640w");
    expect(res.srcSet).toContain("https://images.example.com/cdn-cgi/image/width=1024,format=auto/media/store1/products/shoe.jpg 1024w");
    expect(res.srcSet).not.toContain("width=1600");
    expect(res.src).toBe("https://images.example.com/cdn-cgi/image/width=1024,format=auto/media/store1/products/shoe.jpg");
  });

  it("falls back cleanly to original URL when no derivatives and no CDN_BASE_URL", () => {
    const item = {
      url: "/media/store1/products/mug.jpg",
      width: 500,
      height: 500,
      dominantColor: "#ffffff",
    };

    const res = mediaImage(item);
    expect(res.src).toBe("/media/store1/products/mug.jpg");
    expect(res.srcSet).toBeUndefined();
    expect(res.width).toBe(500);
    expect(res.height).toBe(500);
    expect(res.placeholderColor).toBe("#ffffff");
    expect(res.objectPosition).toBeUndefined();
  });

  it("formats focal point as objectPosition and rejects out-of-range coordinates", () => {
    expect(mediaImage({ url: "a.jpg", focalX: 0, focalY: 1 }).objectPosition).toBe("0% 100%");
    expect(mediaImage({ url: "a.jpg", focalX: 0.5, focalY: 0.5 }).objectPosition).toBe("50% 50%");
    expect(mediaImage({ url: "a.jpg", focalX: -0.1, focalY: 0.5 }).objectPosition).toBeUndefined();
    expect(mediaImage({ url: "a.jpg", focalX: 0.5, focalY: 1.2 }).objectPosition).toBeUndefined();
    expect(mediaImage({ url: "a.jpg", focalX: 0.5, focalY: null }).objectPosition).toBeUndefined();
  });
});
