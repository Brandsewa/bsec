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
