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

  describe("ImageView alt fallback behavior (Plan S5)", () => {
    // Dynamically import views to keep tests modular
    it("falls back to library item alt if block alt is empty", async () => {
      const { ImageView } = await import("../src/views.tsx");
      const { renderToStaticMarkup } = await import("react-dom/server");

      const element = ImageView({
        props: {
          mediaId: "img-123",
          alt: "",
          ratio: "auto",
          rounded: false,
        },
        ctx: {
          mediaDetails: (id) =>
            id === "img-123"
              ? {
                  url: "https://cdn.example.com/item.jpg",
                  alt: "Library fallback alt text",
                }
              : null,
        },
      });

      const html = renderToStaticMarkup(element as React.ReactElement);
      expect(html).toContain('alt="Library fallback alt text"');
      expect(html).toContain('src="https://cdn.example.com/item.jpg"');
    });

    it("prefers block alt when explicitly provided", async () => {
      const { ImageView } = await import("../src/views.tsx");
      const { renderToStaticMarkup } = await import("react-dom/server");

      const element = ImageView({
        props: {
          mediaId: "img-123",
          alt: "Explicit user alt",
          ratio: "auto",
          rounded: false,
        },
        ctx: {
          mediaDetails: (id) =>
            id === "img-123"
              ? {
                  url: "https://cdn.example.com/item.jpg",
                  alt: "Library fallback alt text",
                }
              : null,
        },
      });

      const html = renderToStaticMarkup(element as React.ReactElement);
      expect(html).toContain('alt="Explicit user alt"');
      expect(html).not.toContain('alt="Library fallback alt text"');
    });

    it("renders empty alt (decorative) when neither block nor library item has alt", async () => {
      const { ImageView } = await import("../src/views.tsx");
      const { renderToStaticMarkup } = await import("react-dom/server");

      const element = ImageView({
        props: {
          mediaId: "img-123",
          alt: "",
          ratio: "auto",
          rounded: false,
        },
        ctx: {
          mediaDetails: (id) =>
            id === "img-123"
              ? {
                  url: "https://cdn.example.com/item.jpg",
                  alt: null,
                }
              : null,
        },
      });

      const html = renderToStaticMarkup(element as React.ReactElement);
      expect(html).toContain('alt=""');
    });
  });
});
