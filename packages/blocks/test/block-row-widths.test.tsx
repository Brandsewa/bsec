import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { renderBlockTree, type BlockInstance } from "../src/index.ts";

const block = (type: string, props: Record<string, unknown> = {}): BlockInstance => ({
  id: "t_" + Math.random().toString(36).slice(2, 9),
  type: type as never,
  version: 1,
  props,
});
const render = (b: BlockInstance) => renderToStaticMarkup(<>{renderBlockTree([b], {} as never)}</>);

describe("Block widths inside a row", () => {
  const row = (a: Record<string, unknown>, b: Record<string, unknown>) =>
    render(block("Container", { direction: "row", colGap: "3rem", content: [block("Block", { content: [], ...a }), block("Block", { content: [], ...b })] }));

  it("sizes by width and lets siblings shrink, so two 50% blocks with a gap stay inside the row", () => {
    const html = row({ sizing: { width: "50%" } }, { sizing: { width: "50%" } });
    expect(html).not.toContain("flex:0 0 50%");
    expect(html.match(/flex:0 1 auto/g)).toHaveLength(2);
  });

  it("goes full width on tablet and mobile unless that device sets a width", () => {
    const html = row({ sizing: { width: "50%" } }, {});
    expect(html).toContain("--brx-t-w:100%");
    expect(html).toContain("--brx-m-w:100%");
  });

  it("keeps an explicit tablet width and lets mobile follow it", () => {
    const html = row({ sizing: { width: "50%" }, responsive: { tablet: { sizing: { width: "40%" } } } }, {});
    expect(html).toContain("--brx-t-w:40%");
    expect(html).toContain("--brx-m-w:40%");
  });

  it("leaves a Block with no width sharing the row equally", () => {
    expect(row({}, {})).toContain("flex:1 1 0");
  });
});

describe("slot basis variables for the editor", () => {
  const vars = (props: Record<string, unknown>) => {
    const html = render({ id: "c", type: "Container" as never, version: 1, props: { content: [], ...props } });
    return Object.fromEntries([...html.matchAll(/--slot-fb-([dtm]):([^;"]+)/g)].map((m) => [m[1], m[2]]));
  };

  it("is a row (siblings share the line) while the direction is row, and auto once it stacks", () => {
    expect(vars({ direction: "row" })).toEqual({ d: "0%", t: "0%", m: "0%" });
    expect(vars({ direction: "row", responsive: { tablet: { direction: "column" } } })).toEqual({ d: "0%", t: "auto", m: "auto" });
    expect(vars({})).toEqual({ d: "auto", t: "auto", m: "auto" });
  });

  it("does not depend on a column gap (the inline style text contains 'column-gap')", () => {
    expect(vars({ direction: "row", colGap: "3rem" })).toEqual({ d: "0%", t: "0%", m: "0%" });
  });
});

describe("widgets inside a layout element", () => {
  it("blocks.css lets Section/Container own the side padding and wide measure", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../src/blocks.css", import.meta.url), "utf8");
    expect(css).toMatch(/\.brxe-section \.bsb-w,\s*\.brxe-container \.bsb-w \{\s*padding-inline: 0;/);
    expect(css).toMatch(/\.brxe-container \.bsb-w-wide,[\s\S]*?max-width: none;/);
  });

  it("slot forwarding rules in blocks.css no longer force a direction with !important", async () => {
    const { readFileSync } = await import("node:fs");
    const css = readFileSync(new URL("../src/blocks.css", import.meta.url), "utf8");
    expect(css).not.toMatch(/\[data-puck-dropzone\],[\s\S]{0,60}\{\s*flex-direction: var\(--b-dir\) !important/);
  });
});
