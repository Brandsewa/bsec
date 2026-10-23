import { describe, expect, it } from "vitest";
import { cleanRichDescription } from "../src/rich-description.ts";

describe("cleanRichDescription (category and collection long description)", () => {
  it("stores nothing for empty content", () => {
    expect(cleanRichDescription(null)).toBeNull();
    expect(cleanRichDescription(undefined)).toBeNull();
    expect(cleanRichDescription({ v: 1, blocks: [] })).toBeNull();
  });

  it("keeps valid blocks", () => {
    const content = { v: 1, blocks: [{ type: "heading", level: 2, text: "Buying guide" }, { type: "paragraph", text: "Pick the jar that suits you." }] };
    expect(cleanRichDescription(content)).toMatchObject({ v: 1, blocks: [{ type: "heading" }, { type: "paragraph" }] });
  });

  it("rejects unknown block types and unsafe links instead of storing raw HTML", () => {
    expect(() => cleanRichDescription({ v: 1, blocks: [{ type: "html", html: "<script>x</script>" }] })).toThrow(/Bad Request/);
    expect(() => cleanRichDescription({ v: 1, blocks: [{ type: "paragraph", text: "click", marks: [{ type: "link", start: 0, end: 5, href: "javascript:alert(1)" }] }] })).toThrow(/Bad Request/);
  });
});
