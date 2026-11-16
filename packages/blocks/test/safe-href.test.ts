import { describe, expect, it } from "vitest";
import { isSafeHref } from "../src/common.ts";

// Audit A8-02: a link a merchant saves must not be able to leave the store through a parser quirk.
describe("isSafeHref", () => {
  it("accepts internal paths, anchors, https, mailto and tel", () => {
    for (const ok of ["", "/", "/collections/tea?x=1", "#faq", "https://example.com/a", "http://example.com", "mailto:a@b.co", "tel:+911234567890"]) {
      expect(isSafeHref(ok), ok).toBe(true);
    }
  });

  it("refuses script URLs, protocol-relative URLs and the tab, newline and backslash tricks", () => {
    for (const bad of ["javascript:alert(1)", "JaVaScRiPt:alert(1)", "data:text/html,x", "//evil.example", "/\t/evil.example", "/\n/evil.example", "/\r/evil.example", "/\\evil.example", "https://exa\nmple.com"]) {
      expect(isSafeHref(bad), JSON.stringify(bad)).toBe(false);
    }
  });
});
