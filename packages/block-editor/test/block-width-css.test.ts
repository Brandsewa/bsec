import { describe, it, expect } from "vitest";
import { blockWidthCss } from "../src/config.tsx";

describe("blockWidthCss (canvas wrapper sizing for a Block)", () => {
  it("is empty when the Block has no width, so it keeps sharing the row", () => {
    expect(blockWidthCss("abc", {})).toBe("");
  });

  it("sizes the wrapper per device: desktop width, then full line on tablet/mobile unless set", () => {
    const css = blockWidthCss("abc", { sizing: { width: "30%" } });
    expect(css).toContain('i[data-blk="abc"]){flex:0 1 auto;width:30%}');
    expect(css).toContain("@media(max-width:1023px){");
    expect(css.match(/width:100%/g)).toHaveLength(2);
  });

  it("uses an explicit tablet width for tablet and mobile, and a mobile width for mobile only", () => {
    const css = blockWidthCss("abc", { sizing: { width: "30%" }, responsive: { tablet: { sizing: { width: "45%" } }, mobile: { sizing: { width: "80%" } } } });
    expect(css).toMatch(/max-width:1023px\)\{[^}]*width:45%\}\}/);
    expect(css).toMatch(/max-width:767px\)\{[^}]*width:80%\}\}/);
  });

  it("treats a bare number as pixels and keeps unsafe characters out of the selector", () => {
    const css = blockWidthCss('a"]{}b', { sizing: { width: "300" } });
    expect(css).toContain("width:300px");
    expect(css).toContain('data-blk="ab"');
    expect(css).not.toContain('"]{}');
  });
});
