import { describe, expect, it } from "vitest";
import type { PolicyBlock } from "@bs/contracts";
import { docToPolicyBlocks, normalizePolicyHref, policyBlocksToDoc } from "../src/lib/policy-rich-text.ts";

describe("policy rich text conversion", () => {
  it("round-trips headings, marked paragraphs, lists and dividers", () => {
    const blocks: PolicyBlock[] = [
      { type: "heading", level: 2, text: "Overview" },
      {
        type: "paragraph",
        text: "Read our returns terms here.",
        marks: [
          { type: "bold", start: 0, end: 4 },
          { type: "link", start: 21, end: 27, href: "https://example.com/returns" },
        ],
      },
      { type: "list", style: "ordered", items: ["First", "Second"] },
      { type: "divider" },
      { type: "heading", level: 3, text: "Details" },
    ];
    expect(docToPolicyBlocks(policyBlocksToDoc(blocks))).toEqual(blocks);
  });

  it("splits hard line breaks into separate paragraphs and drops empty ones", () => {
    const out = docToPolicyBlocks({
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "one" }, { type: "hardBreak" }, { type: "text", text: "two" }] },
        { type: "paragraph" },
      ],
    });
    expect(out).toEqual([
      { type: "paragraph", text: "one" },
      { type: "paragraph", text: "two" },
    ]);
  });

  it("drops links with unsafe schemes and upgrades http to https", () => {
    const out = docToPolicyBlocks({
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "bad", marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }] },
            { type: "text", text: "ok", marks: [{ type: "link", attrs: { href: "http://example.com" } }] },
          ],
        },
      ],
    });
    expect(out).toEqual([{ type: "paragraph", text: "badok", marks: [{ type: "link", start: 3, end: 5, href: "https://example.com" }] }]);
    expect(normalizePolicyHref("data:text/html,x")).toBeNull();
    expect(normalizePolicyHref("example.com")).toBe("https://example.com");
    expect(normalizePolicyHref("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  it("flattens nested lists to one level and merges adjacent bold runs", () => {
    const out = docToPolicyBlocks({
      type: "doc",
      content: [
        {
          type: "bulletList",
          content: [
            {
              type: "listItem",
              content: [
                { type: "paragraph", content: [{ type: "text", text: "Parent" }] },
                { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Child" }] }] }] },
              ],
            },
          ],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "ab", marks: [{ type: "bold" }] },
            { type: "text", text: "cd", marks: [{ type: "bold" }] },
          ],
        },
      ],
    });
    expect(out[0]).toEqual({ type: "list", style: "unordered", items: ["Parent", "Child"] });
    expect(out[1]).toEqual({ type: "paragraph", text: "abcd", marks: [{ type: "bold", start: 0, end: 4 }] });
  });

  it("opens an empty policy as an empty document", () => {
    expect(policyBlocksToDoc([])).toEqual({ type: "doc", content: [{ type: "paragraph" }] });
  });
});
