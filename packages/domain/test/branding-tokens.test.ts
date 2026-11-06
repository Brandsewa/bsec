import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND, PLATFORM_BRAND_FONTS, brandLogoPair, buildBrandCss, parseBrandTokens, shadeRamp } from "../src/platform/branding-tokens.ts";

describe("parseBrandTokens", () => {
  it("accepts valid colours and normalises short hex", () => {
    const { tokens, issues } = parseBrandTokens({ color: { primary: "#abc" } });
    expect(issues).toEqual([]);
    expect(tokens.color.primary).toBe("#aabbcc");
  });
  it("rejects bad hex and non-https logos, keeping the base", () => {
    const { tokens, issues } = parseBrandTokens({ color: { primary: "red" }, favicon: { url: "http://x.test/a.png" } });
    expect(issues.map((i) => i.field).sort()).toEqual(["color.primary", "favicon"]);
    expect(tokens.color.primary).toBe(DEFAULT_BRAND.color.primary);
    expect(tokens.favicon).toBeNull();
  });
  it("flags an unreadable button pair and replaces the text colour", () => {
    const { tokens, issues } = parseBrandTokens({ button: { light: { background: "#ffffff", text: "#fefefe" } } });
    expect(issues[0]?.field).toBe("button.light.text");
    expect(tokens.button.light.text).toBe("#111111");
  });
  it("accepts https and root-relative assets, rejects protocol-relative", () => {
    expect(parseBrandTokens({ favicon: { url: "/media/f.png" } }).issues).toEqual([]);
    expect(parseBrandTokens({ favicon: { url: "//evil.test/f.png" } }).issues).toHaveLength(1);
  });
  it("builds css from validated values only", () => {
    const css = buildBrandCss(DEFAULT_BRAND);
    expect(css).toContain("--brand-primary:#1f6f4a");
    expect(css).toContain(".dark{");
  });
});

import { emailBaseFromBrand } from "../src/notifications/branding-loader.ts";
describe("emailBaseFromBrand", () => {
  it("uses the light logo, primary colour and light button; drops non-https logos", () => {
    const { tokens } = parseBrandTokens({
      logo: { light: { full: { url: "https://cdn.test/l.png" } }, dark: { full: { url: "https://cdn.test/d.png" } } },
      color: { primary: "#112233" },
      button: { light: { background: "#112233", text: "#ffffff" } },
    });
    const e = emailBaseFromBrand(tokens);
    expect(e.logoUrl).toBe("https://cdn.test/l.png");
    expect(e.accent).toBe("#112233");
    expect(e.buttonBackground).toBe("#112233");
    expect(emailBaseFromBrand(parseBrandTokens({ favicon: { url: "/media/f.png" }, logo: { light: { full: { url: "/media/l.png" } } } }).tokens).logoUrl).toBeNull();
  });
});

describe("phase 3 tokens", () => {
  it("cleans identity text and caps its length", () => {
    const { tokens, issues } = parseBrandTokens({ identity: { name: "  <b>Acme</b>  Co ", tagline: "x".repeat(300) } });
    expect(issues).toEqual([]);
    expect(tokens.identity.name).toBe("Acme Co");
    expect(tokens.identity.tagline).toHaveLength(140);
  });
  it("accepts only enumerated fonts", () => {
    expect(parseBrandTokens({ font: "serif" }).tokens.font).toBe("serif");
    const bad = parseBrandTokens({ font: "url(javascript:x)" });
    expect(bad.issues[0]?.field).toBe("font");
    expect(bad.tokens.font).toBe("system");
  });
  it("keeps old rows (no identity or font) valid with defaults", () => {
    const { tokens, issues } = parseBrandTokens({ color: { primary: "#123456" } });
    expect(issues).toEqual([]);
    expect(tokens.identity).toEqual({ name: "", tagline: "" });
    expect(tokens.font).toBe("system");
  });
  it("derives a ramp that keeps the colour at 500, lightens below and darkens above", () => {
    const r = shadeRamp("#1f6f4a");
    expect(r[500]).toBe("#1f6f4a");
    expect(r[50]).not.toBe(r[500]);
    expect(parseInt(r[50].slice(1), 16)).toBeGreaterThan(parseInt(r[500].slice(1), 16));
    expect(parseInt(r[900].slice(1), 16)).toBeLessThan(parseInt(r[500].slice(1), 16));
    expect(Object.keys(r)).toHaveLength(10);
  });
  it("emits the ramp and the font variable in css", () => {
    const css = buildBrandCss({ ...DEFAULT_BRAND, font: "mono" });
    expect(css).toContain("--brand-primary-50:");
    expect(css).toContain("--brand-primary-900:");
    expect(css).toContain(`--brand-font:${PLATFORM_BRAND_FONTS.mono}`);
  });
});

describe("logo size and the full-logo pair", () => {
  it("accepts 8 to 600 px or null, rejects the rest", () => {
    expect(parseBrandTokens({ logoSize: { width: 180, height: null } }).tokens.logoSize).toEqual({ width: 180, height: null });
    const bad = parseBrandTokens({ logoSize: { width: 2, height: 9999 } });
    expect(bad.issues.map((i) => i.field).sort()).toEqual(["logoSize.height", "logoSize.width"]);
  });
  it("emits size variables only when a size is set, with auto for the other side", () => {
    expect(buildBrandCss(DEFAULT_BRAND)).not.toContain("--brand-logo");
    expect(buildBrandCss({ ...DEFAULT_BRAND, logoSize: { width: null, height: 48 } })).toContain("--brand-logo-w:auto;--brand-logo-h:48px;");
  });
  it("uses full logos only, one serving both surfaces when alone, never the icon", () => {
    const asset = { url: "https://x.test/l.png", width: null, height: null, alt: "" };
    const icon = { url: "https://x.test/i.png", width: null, height: null, alt: "" };
    const t = { ...DEFAULT_BRAND, logo: { dark: { full: null, icon }, light: { full: asset, icon: null } } };
    expect(brandLogoPair(t)).toEqual({ dark: asset, light: asset });
    expect(brandLogoPair({ ...DEFAULT_BRAND, logo: { dark: { full: null, icon }, light: { full: null, icon } } })).toEqual({ dark: null, light: null });
  });
});
