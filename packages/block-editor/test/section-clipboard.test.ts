import { describe, expect, it } from "vitest";
import { cloneWithNewIds, countNested, insertIntoZone } from "../src/section-clipboard.ts";

const section = {
  type: "Section",
  props: {
    id: "Section-1",
    background: "#fff",
    content: [
      { type: "Container", props: { id: "Container-1", content: [{ type: "RichText", props: { id: "RichText-1", content: "hello" } }] } },
      { type: "Gallery", props: { id: "Gallery-1", images: [{ id: "img-a", url: "x" }] } },
    ],
  },
};

describe("section clipboard", () => {
  it("gives the element and everything nested a new id, and keeps the rest", () => {
    const copy = cloneWithNewIds(section);
    const container = (copy.props.content as typeof section.props.content)[0] as { props: { id: string; content: Array<{ props: { id: string; content: string } }> } };
    const ids = [copy.props.id, container.props.id, container.props.content[0]!.props.id];
    expect(new Set(ids).size).toBe(3);
    expect(ids.some((id) => id.endsWith("-1"))).toBe(false);
    expect(copy.props.id.startsWith("Section-")).toBe(true);
    expect(container.props.id.startsWith("Container-")).toBe(true);
    expect(container.props.content[0]!.props.content).toBe("hello");
    expect(copy.props.background).toBe("#fff");
    // A plain `id` inside a prop (not an element) is data, not an element id.
    expect(JSON.stringify(copy)).toContain('"id":"img-a"');
  });

  it("does not change the original", () => {
    cloneWithNewIds(section);
    expect(section.props.id).toBe("Section-1");
  });

  it("counts the elements inside", () => {
    expect(countNested(section)).toBe(3);
    expect(countNested({ type: "Spacer", props: { id: "s" } })).toBe(0);
  });
});

describe("insertIntoZone", () => {
  const page = [section, { type: "Section", props: { id: "Section-2", content: [] } }];
  it("inserts at the page level", () => {
    const copy = { type: "Section", props: { id: "new", content: [] } };
    const out = insertIntoZone(page as never, "root:default-zone", 1, copy as never)!;
    expect(out.map((i) => i.props.id)).toEqual(["Section-1", "new", "Section-2"]);
    expect(page).toHaveLength(2);
  });
  it("inserts into a nested slot without touching siblings", () => {
    const copy = { type: "RichText", props: { id: "new", content: "x" } };
    const out = insertIntoZone(page as never, "Container-1:content", 1, copy as never)!;
    const inner = (out[0]!.props.content as Array<{ props: { content: Array<{ props: { id: string } }> } }>)[0]!.props.content;
    expect(inner.map((i) => i.props.id)).toEqual(["RichText-1", "new"]);
    expect(out[1]).toBe(page[1]);
  });
  it("returns null for an unknown zone", () => {
    expect(insertIntoZone(page as never, "Nope-1:content", 0, {} as never)).toBeNull();
  });
});
