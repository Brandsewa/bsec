import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { withShareImage } from "../src/lib/share-image.ts";
import { blocksHaveH1 } from "../src/lib/has-h1.ts";
import { themeChromeIdentity, withThemeLogoFallback } from "../src/lib/theme-brand.ts";

const IMG = { url: "https://media.x/og.png", width: 1200, height: 630, alt: "Shop" };

describe("withShareImage", () => {
  it("adds the default image to an openGraph and twitter that have none", () => {
    const out = withShareImage({ openGraph: { title: "T" }, twitter: { card: "summary", title: "T" } }, IMG);
    expect(out.openGraph).toMatchObject({ title: "T", images: [{ url: IMG.url, width: 1200, height: 630, alt: "Shop" }] });
    expect(out.twitter).toMatchObject({ images: [IMG.url] });
  });

  it("leaves a page's own image alone", () => {
    const own = { openGraph: { title: "T", images: [{ url: "https://media.x/own.png" }] } };
    expect(withShareImage(own, IMG).openGraph).toEqual(own.openGraph);
  });

  it("does nothing without an image or without openGraph", () => {
    const meta = { title: "T" };
    expect(withShareImage(meta, null)).toBe(meta);
    expect(withShareImage(meta, IMG)).toEqual(meta);
  });
});

describe("blocksHaveH1", () => {
  it("finds a Heading at h1 and a slider with an h1 title, however deeply nested", () => {
    expect(blocksHaveH1([{ type: "Section", props: { children: [{ type: "Heading", props: { level: "h1" } }] } }])).toBe(true);
    expect(blocksHaveH1([{ type: "HeroSlider", props: { titleTag: "h1" } }])).toBe(true);
  });
  it("is false when no block asks for an h1", () => {
    expect(blocksHaveH1([{ type: "Heading", props: { level: "h2" } }, { type: "HeroSlider", props: { titleTag: "h2" } }])).toBe(false);
    expect(blocksHaveH1([])).toBe(false);
  });
});

describe("themeChromeIdentity", () => {
  const header = { blocks: [{ type: "SiteHeader", props: { logoMediaId: "m1" } }], renderData: { media: { m1: "https://media.x/logo.png" } } };
  const footer = { blocks: [{ type: "SiteFooter", props: { socials: [{ network: "instagram", url: "https://instagram.com/r" }, { network: "email", url: "mailto:a@b.c" }, { network: "facebook", url: "http://fb.com/r" }] } }] };

  it("reads the logo from the header and https social links from the footer", () => {
    expect(themeChromeIdentity(header, footer)).toEqual({ logoUrl: "https://media.x/logo.png", sameAs: ["https://instagram.com/r"] });
  });
  it("returns nothing when the theme has no header or footer", () => {
    expect(themeChromeIdentity(null, null)).toEqual({ logoUrl: null, sameAs: [] });
  });
});

describe("withThemeLogoFallback", () => {
  const none = { logoUrl: null, faviconUrl: null, appleTouchIconUrl: null, faviconSizes: null, appleTouchIconSizes: null, shareImage: null };
  it("fills the logo and share image from the theme logo when Brand settings have none, never a favicon", () => {
    expect(withThemeLogoFallback(none, "https://media.x/logo.png")).toEqual({ ...none, logoUrl: "https://media.x/logo.png", shareImage: { url: "https://media.x/logo.png" } });
  });
  it("keeps what Brand settings already provide", () => {
    const own = { ...none, logoUrl: "https://media.x/own.png", shareImage: { url: "https://media.x/og.png" } };
    expect(withThemeLogoFallback(own, "https://media.x/theme.png")).toEqual(own);
  });
  it("does nothing without a theme logo", () => {
    expect(withThemeLogoFallback(none, null)).toBe(none);
  });
});
