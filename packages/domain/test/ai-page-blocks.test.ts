import { describe, expect, it } from "vitest";
import { describeBlockType, findBlock, insertBlock, moveBlock, newBlock, outlineBlocks, patchBlockProps, removeBlock, setBlockHidden, storeBlockTypes } from "../src/index.ts";

const section = () => ({ ...newBlock("Section"), id: "s1" });
const heading = (id: string, text: string) => ({ ...newBlock("Heading", { text }), id });

describe("page block helpers for AI access", () => {
  it("offers store block types only, never the platform website sections", () => {
    const names = storeBlockTypes().map((t) => t.type);
    expect(names).toEqual(expect.arrayContaining(["Heading", "Text", "Button", "Section"]));
    expect(names.some((n) => n.startsWith("Mk"))).toBe(false);
    expect(() => newBlock("MkHero")).toThrow(/not available/);
    expect(() => describeBlockType("MkHero")).toThrow(/Not Found/);
  });

  it("describes a block type with its props and without the shared layout options", () => {
    const d = describeBlockType("Heading");
    expect(JSON.stringify(d.props)).toContain("text");
    expect(d.commonLayoutProps.length).toBeGreaterThan(0);
    expect(d.container).toBe(false);
  });

  it("inserts into containers, refuses leaves, moves, hides and removes without touching the input", () => {
    const root = [section(), heading("h-top", "Top")];
    const a = insertBlock(root, heading("h1", "One"), "s1", undefined);
    const b = insertBlock(a, heading("h2", "Two"), "s1", 0);
    expect(root).toHaveLength(2);
    expect(outlineBlocks(b)[0]?.children?.map((c) => c.id)).toEqual(["h2", "h1"]);
    expect(() => insertBlock(b, heading("h3", "x"), "h1", undefined)).toThrow(/cannot hold/);
    const moved = moveBlock(b, "h-top", "s1", 1);
    expect(outlineBlocks(moved).map((n) => n.id)).toEqual(["s1"]);
    expect(() => moveBlock(moved, "s1", "s1", 0)).toThrow(/itself/);
    const hidden = setBlockHidden(moved, "h1", true);
    expect(findBlock(hidden, "h1")?.block.hidden).toBe(true);
    const { blocks, removed } = removeBlock(hidden, "h2");
    expect(removed.id).toBe("h2");
    expect(findBlock(blocks, "h2")).toBeNull();
  });

  it("patches props, removes a prop with null and refuses to overwrite nested blocks", () => {
    const root = [section(), heading("h1", "Old")];
    const next = patchBlockProps(root, "h1", { text: "New", align: "center" });
    expect((findBlock(next, "h1")?.block.props as { text: string }).text).toBe("New");
    const cleared = patchBlockProps(next, "h1", { align: null });
    expect("align" in (findBlock(cleared, "h1")?.block.props ?? {})).toBe(false);
    expect(() => patchBlockProps(root, "s1", { content: [] })).toThrow(/Nested blocks/);
    expect((findBlock(root, "h1")?.block.props as { text: string }).text).toBe("Old");
  });
});
