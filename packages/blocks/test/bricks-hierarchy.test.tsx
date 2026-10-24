import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockTree, validateBlockDocument, type BlockInstance } from "../src/index.ts";

const block = (type: string, props: Record<string, unknown> = {}): BlockInstance => ({
  id: "test_" + Math.random().toString(36).substring(7),
  type: type as never,
  version: 1,
  props,
});

const render = (b: BlockInstance) => renderToStaticMarkup(<>{renderBlockTree([b], {} as never)}</>);

describe("Section > Container > 2x Blocks Hierarchy and Styling", () => {
  it("renders the exact requested layout: Section full-width (padding 4rem, bg color) > Container (standard width, different bg color) > 2 Blocks (each 50%, different bg colors)", () => {
    const block1 = block("Block", {
      sizing: { width: "50%" },
      padding: { top: "1.5rem", right: "1.5rem", bottom: "1.5rem", left: "1.5rem" },
      background: { color: "#fef08a" }, // light yellow
      content: [],
    });

    const block2 = block("Block", {
      sizing: { width: "50%" },
      padding: { top: "1.5rem", right: "1.5rem", bottom: "1.5rem", left: "1.5rem" },
      background: { color: "#bbf7d0" }, // light green
      content: [],
    });

    const container = block("Container", {
      direction: "row",
      padding: { top: "2rem", right: "2rem", bottom: "2rem", left: "2rem" },
      background: { color: "#38bdf8" }, // light blue
      content: [block1, block2],
    });

    const section = block("Section", {
      padding: { top: "4rem", right: "4rem", bottom: "4rem", left: "4rem" },
      background: { color: "#f43f5e" }, // rose/red
      content: [container],
    });

    const doc = { version: 1 as const, blocks: [section] };
    const valid = validateBlockDocument(doc);
    expect(valid.success).toBe(true);

    const html = render(section);
    console.log("RENDERED HTML:\n", html);

    // Section asserts
    expect(html).toContain("background-color:#f43f5e");
    expect(html).toContain("padding-top:4rem");

    // Container asserts
    expect(html).toContain("background-color:#38bdf8");
    expect(html).toContain("padding-top:2rem");

    // Blocks asserts
    expect(html).toContain("background-color:#fef08a");
    expect(html).toContain("background-color:#bbf7d0");
    expect(html).toContain("width:50%");
  });

  it("renders responsive settings: direction row on desktop/tablet, vertical on mobile, and responsive padding", () => {
    // Example 1: Direction row on desktop, column on mobile
    // Example 2: Padding 20px on desktop, 16px on tablet, 10px on mobile
    const responsiveContainer = block("Container", {
      direction: "row",
      padding: { top: "20px", right: "20px", bottom: "20px", left: "20px" },
      responsive: {
        tablet: {
          direction: "row",
          padding: { top: "16px", right: "16px", bottom: "16px", left: "16px" },
        },
        mobile: {
          direction: "column",
          padding: { top: "10px", right: "10px", bottom: "10px", left: "10px" },
        },
      },
      content: [],
    });

    const html = render(responsiveContainer);

    // Desktop vars
    expect(html).toContain("--brx-d-dir:row");
    expect(html).toContain("--brx-d-pt:20px");

    // Tablet vars
    expect(html).toContain("--brx-t-dir:row");
    expect(html).toContain("--brx-t-pt:16px");

    // Mobile vars
    expect(html).toContain("--brx-m-dir:column");
    expect(html).toContain("--brx-m-pt:10px");

    // Has responsive class
    expect(html).toContain("brx-resp");
  });
});
