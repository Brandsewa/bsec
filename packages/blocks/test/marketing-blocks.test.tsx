import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARKETING_BLOCK_DEFINITIONS, MARKETING_STARTERS, MkThemeSchema, websiteThemeCss, hasMarketingBlocks, onlyMarketingBlocks, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const about = MARKETING_STARTERS["about"]!;

describe("website sections", () => {
  it("every default is valid against its own schema", () => {
    for (const def of Object.values(MARKETING_BLOCK_DEFINITIONS)) {
      expect(def.schema.safeParse(def.defaultProps).success, def.type).toBe(true);
    }
  });

  it("the About starter saves as a valid document", () => {
    const result = validateBlockDocument({ version: 1, blocks: about });
    expect(result.success ? "ok" : JSON.stringify(result.errors)).toBe("ok");
  });

  it("draws the About page with the host's checker and company details", () => {
    const html = renderToStaticMarkup(<>{renderBlockTree(about, { renderNameChecker: () => <i>checker</i>, renderCompany: () => <i>company</i> })}</>);
    expect(html).toContain("doc-head");
    expect(html).toContain("<i>checker</i>");
    expect(html).toContain("<i>company</i>");
    expect(html).toContain("<strong>yourname.bcom.si</strong>");
  });

  it("keeps links inside the site in the same tab and sends others to a new one", () => {
    const html = renderToStaticMarkup(<>{renderBlockTree(about, {})}</>);
    expect(html).toMatch(/<a href="\/pricing">pricing<\/a>/);
    expect(html).toMatch(/href="https:\/\/brandsewa\.com"[^>]*target="_blank"/);
  });

  it("strips scripts from section text", () => {
    const block: BlockInstance = { id: "x", type: "MkDocSection", version: 1, props: { heading: "", body: "Hello <script>alert(1)</script> [x](javascript:alert(1))", checks: [], after: "" } };
    const html = renderToStaticMarkup(<>{renderBlockTree([block], {})}</>);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("javascript:");
  });

  it("rejects props outside the schema", () => {
    const result = validateBlockDocument({ version: 1, blocks: [{ id: "x", type: "MkHero", version: 1, props: { title: "" } }] });
    expect(result.success).toBe(false);
  });

  it("tells website documents from store documents, inside layout blocks too", () => {
    const store: BlockInstance = { id: "a", type: "Heading", version: 1, props: { text: "Hi" } };
    const nested: BlockInstance = { id: "b", type: "Section", version: 1, props: { content: [about[0]] } };
    expect(hasMarketingBlocks([store])).toBe(false);
    expect(hasMarketingBlocks([nested])).toBe(true);
    expect(onlyMarketingBlocks(about)).toBe(true);
    expect(onlyMarketingBlocks([...about, store])).toBe(false);
  });

  it("the stylesheet has no gradients", () => {
    expect(readFileSync(join(__dirname, "..", "src", "marketing.css"), "utf8")).not.toMatch(/gradient\(/);
  });
});

describe("website theme settings", () => {
  it("turns the store theme tokens into website CSS, light and dark, only for what was set", () => {
    const theme = MkThemeSchema.parse({
      tokens: {
        colors: { siteBackground: "#fafafa", lightHeading: "#111111", lightButton: "#1f3a5f" },
        darkColors: { siteBackground: "#0b0b0b", lightHeading: "#eeeeee" },
        fonts: { heading: "Lora", body: "Inter", headingWeight: 600 },
        radius: "lg",
        buttons: { uppercase: true, radius: "full" },
        layout: { desktop: { siteWidth: "1100px" } },
      },
    });
    const { css, fontsHref } = websiteThemeCss(theme);
    expect(css).toContain(".mk{--bg:#fafafa;--ink:#111111");
    expect(css).toContain("--pri:#1f3a5f");
    expect(css).toContain("[data-theme=dark] .mk{--bg:#0b0b0b;--ink:#eeeeee");
    expect(css).toContain('--sans:"Inter"');
    expect(css).toContain("font-weight:600");
    expect(css).toContain("border-radius:14px");
    expect(css).toContain("border-radius:9999px");
    expect(css).toContain("max-width:1100px");
    expect(css).not.toContain("--surface");
    expect(fontsHref).toContain("fonts.googleapis.com");
  });

  it("keeps the earlier quick settings working when no tokens are set", () => {
    const { css } = websiteThemeCss(MkThemeSchema.parse({ light: { primary: "#1f3a5f", primaryInk: "", background: "", text: "" }, font: "inter" }));
    expect(css).toContain("--pri:#1f3a5f");
    expect(css).toContain('--sans:"Inter"');
    expect(websiteThemeCss(MkThemeSchema.parse({})).css).toBe("");
  });
});
