import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { MARKETING_BLOCK_DEFINITIONS, MARKETING_STARTERS, hasMarketingBlocks, onlyMarketingBlocks, renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

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
