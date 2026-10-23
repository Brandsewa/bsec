import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { RichBlocks } from "../src/components/storefront/RichBlocks.tsx";

const render = (blocks: Parameters<typeof RichBlocks>[0]["blocks"]) => renderToStaticMarkup(React.createElement(RichBlocks, { blocks }));

describe("RichBlocks (category, collection and policy text)", () => {
  it("draws headings, lists and dividers", () => {
    const html = render([
      { type: "heading", level: 2, text: "Care" },
      { type: "heading", level: 3, text: "Washing" },
      { type: "list", style: "ordered", items: ["One", "Two"] },
      { type: "list", style: "unordered", items: ["A"] },
      { type: "divider" },
    ]);
    expect(html).toContain("<h2");
    expect(html).toContain("<h3");
    expect(html).toContain("<ol");
    expect(html).toContain("<ul");
    expect(html).toContain("<hr");
  });

  it("applies bold, italic and link marks, including overlapping ones", () => {
    const html = render([
      {
        type: "paragraph",
        text: "Hand made in the hills",
        marks: [
          { type: "bold", start: 0, end: 9 },
          { type: "italic", start: 5, end: 9 },
          { type: "link", start: 13, end: 22, href: "https://example.com/hills" },
        ],
      },
    ]);
    expect(html).toContain("<strong>Hand </strong>");
    expect(html).toContain("<em><strong>made</strong></em>");
    expect(html).toContain('href="https://example.com/hills"');
    expect(html).toContain("rel=\"noopener noreferrer\"");
  });

  it("escapes text, so nothing in a paragraph becomes markup", () => {
    const html = render([{ type: "paragraph", text: "<script>alert(1)</script>" }]);
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
