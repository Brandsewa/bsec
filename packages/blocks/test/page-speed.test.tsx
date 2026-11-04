import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockTree, responsiveImgAttrs, type BlockInstance, type RenderContext } from "../src/index.ts";

const section = (id: string, props: Record<string, unknown>): BlockInstance => ({ id, type: "Section", version: 1, props });
const render = (blocks: BlockInstance[], ctx: RenderContext = {}) => renderToStaticMarkup(<>{renderBlockTree(blocks, ctx)}</>);

describe("page speed: hero image and background video", () => {
  it("loads only the first background picture of a tree eagerly", () => {
    const html = render([
      section("a", { background: { imageUrl: "https://m.example/one.webp" } }),
      section("b", { background: { imageUrl: "https://m.example/two.webp" } }),
    ]);
    const imgs = html.match(/<img[^>]*bsb-hero-bg[^>]*>/g) ?? [];
    expect(imgs).toHaveLength(2);
    expect(imgs[0]).toContain('loading="eager"');
    expect(imgs[0]).toMatch(/fetchPriority="high"/i);
    expect(imgs[1]).toContain('loading="lazy"');
  });

  it("each tree starts a fresh claim, so a second page render is eager again", () => {
    const blocks = [section("a", { background: { imageUrl: "https://m.example/one.webp" } })];
    expect(render(blocks)).toContain('loading="eager"');
    expect(render(blocks)).toContain('loading="eager"');
  });

  it("does not put the video file in the server HTML or autoplay it", () => {
    const html = render([section("v", { background: { videoUrl: "https://m.example/big.webm" } })]);
    expect(html).toContain("<video");
    expect(html).toContain('preload="none"');
    expect(html).not.toContain("big.webm");
    expect(html).not.toContain("autoPlay");
    expect(html).not.toContain("autoplay");
  });

  it("uses the chosen poster, else falls back to the background image", () => {
    const ctx: RenderContext = { mediaUrl: (id: string) => `https://m.example/${id}.webp` };
    const withPoster = render([section("v", { background: { mediaId: "bg", videoUrl: "https://m.example/a.webm", videoPosterMediaId: "pst" } })], ctx);
    expect(withPoster).toMatch(/<video[^>]*poster="https:\/\/m\.example\/pst\.webp"/);
    const fallback = render([section("v", { background: { imageUrl: "https://m.example/bg.jpg", videoUrl: "https://m.example/a.webm" } })]);
    expect(fallback).toMatch(/<video[^>]*poster="https:\/\/m\.example\/bg\.jpg"/);
  });
});

describe("page speed: responsive image attributes", () => {
  const derivatives = {
    w320: { key: "t/_derived/m/f/w320.webp", width: 320, height: 320, bytes: 1 },
    w640: { key: "t/_derived/m/f/w640.webp", width: 640, height: 640, bytes: 2 },
  };
  const ctx: RenderContext = {
    mediaUrl: () => "https://media.example/t/catalog/orig.png",
    mediaDetails: () => ({ url: "https://media.example/t/catalog/orig.png", width: 1600, height: 1600, derivatives }),
  };

  it("builds a srcSet from derivatives", () => {
    const r = responsiveImgAttrs(ctx, "m", "320px");
    expect(r.srcSet).toContain("320w");
    expect(r.srcSet).toContain("640w");
    expect(r.sizes).toBe("320px");
  });

  it("falls back to the plain URL without derivatives or details", () => {
    expect(responsiveImgAttrs({ mediaUrl: () => "https://x/y.png" }, "m", "320px")).toEqual({ src: "https://x/y.png" });
    expect(responsiveImgAttrs({}, "m", "320px", "https://fallback/z.png")).toEqual({ src: "https://fallback/z.png" });
    expect(responsiveImgAttrs(ctx, undefined, "320px").src).toBeNull();
  });
});

describe("page speed: font fallbacks", () => {
  it("emits a metric-matched fallback face and puts it in the font stack", async () => {
    const { themeFontFallbackCss, computeThemeTokens } = await import("../src/theme-vars.ts");
    const tokens = { fonts: { heading: "Playfair Display", body: "DM Sans" } };
    const css = themeFontFallbackCss(tokens);
    expect(css).toContain('font-family:"DM Sans Fallback"');
    expect(css).toContain("size-adjust:104.53%");
    expect(css).toContain('local("Times New Roman")');
    const vars = computeThemeTokens(null, tokens) as Record<string, string>;
    expect(vars["--bs-font-body"]).toBe('"DM Sans", "DM Sans Fallback", ui-sans-serif, system-ui, sans-serif');
    expect(themeFontFallbackCss({ fonts: { heading: "Custom Font" } })).toBe("");
  });
});

describe("page speed: responsive section background", () => {
  it("gives an uploaded background a srcSet from its derivatives", () => {
    const html = render([section("a", { background: { mediaId: "m1" } })], {
      mediaUrl: () => "https://media.example/t/catalog/orig.webp",
      mediaDetails: () => ({
        url: "https://media.example/t/catalog/orig.webp",
        width: 1600,
        height: 900,
        derivatives: { w640: { key: "t/_derived/m/f/w640.webp", width: 640, height: 360, bytes: 1 } },
      }),
    });
    expect(html).toMatch(/<img[^>]*bsb-hero-bg[^>]*srcSet="[^"]*640w/);
  });

  it("keeps a pasted image URL as is", () => {
    const html = render([section("a", { background: { imageUrl: "https://x.example/a.jpg" } })]);
    expect(html).not.toMatch(/bsb-hero-bg[^>]*srcSet/);
  });
});
