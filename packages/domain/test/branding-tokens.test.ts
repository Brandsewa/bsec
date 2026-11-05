import { describe, expect, it } from "vitest";
import { DEFAULT_BRAND, buildBrandCss, parseBrandTokens } from "../src/platform/branding-tokens.ts";

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
