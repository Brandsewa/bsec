import { describe, expect, it } from "vitest";
import { richBlocksToText, textHasStructure, textToRichBlocks } from "../src/rich-text.ts";

describe("textToRichBlocks", () => {
  it("turns blank-line paragraphs, headings, lists and dividers into blocks", () => {
    const text = [
      "# Tasting notes",
      "Bright, floral and lightly muscatel.",
      "Brewed at 85 degrees",
      "for three minutes.",
      "",
      "## Brewing",
      "- 2 g per 100 ml",
      "* 85 degrees",
      "",
      "1. Warm the pot",
      "2) Add the leaves",
      "---",
      "### FAQ",
      "Is it organic? Yes.",
    ].join("\n");
    expect(textToRichBlocks(text)).toEqual([
      { type: "heading", level: 2, text: "Tasting notes" },
      { type: "paragraph", text: "Bright, floral and lightly muscatel. Brewed at 85 degrees for three minutes." },
      { type: "heading", level: 2, text: "Brewing" },
      { type: "list", style: "unordered", items: ["2 g per 100 ml", "85 degrees"] },
      { type: "list", style: "ordered", items: ["Warm the pot", "Add the leaves"] },
      { type: "divider" },
      { type: "heading", level: 3, text: "FAQ" },
      { type: "paragraph", text: "Is it organic? Yes." },
    ]);
  });

  it("keeps Windows line endings and a bullet character", () => {
    expect(textToRichBlocks("Intro\r\n\r\n• one\r\n• two")).toEqual([
      { type: "paragraph", text: "Intro" },
      { type: "list", style: "unordered", items: ["one", "two"] },
    ]);
  });

  it("cuts a paragraph longer than the limit into several instead of losing text", () => {
    const long = "word ".repeat(900).trim();
    const blocks = textToRichBlocks(long);
    expect(blocks.length).toBeGreaterThan(1);
    expect(blocks.every((b) => b.type === "paragraph" && b.text.length <= 2000)).toBe(true);
    expect(blocks.map((b) => (b as { text: string }).text).join(" ")).toBe(long);
  });

  it("stops at 80 blocks and 50 list items", () => {
    expect(textToRichBlocks(Array.from({ length: 200 }, (_, i) => `Para ${i}`).join("\n\n"))).toHaveLength(80);
    const list = textToRichBlocks(Array.from({ length: 70 }, (_, i) => `- item ${i}`).join("\n"))[0] as { items: string[] };
    expect(list.items).toHaveLength(50);
  });

  it("returns nothing for empty text", () => {
    expect(textToRichBlocks("  \n \n")).toEqual([]);
  });
});

describe("textHasStructure and richBlocksToText", () => {
  it("is false for one plain paragraph and true for anything with shape", () => {
    expect(textHasStructure("A single plain description.")).toBe(false);
    expect(textHasStructure("One.\n\nTwo.")).toBe(true);
    expect(textHasStructure("# Heading")).toBe(true);
    expect(textHasStructure("- only a list")).toBe(true);
  });

  it("reads blocks back as text, one line per block and per list item", () => {
    expect(richBlocksToText([{ type: "heading", text: "H" }, { type: "paragraph", text: "P" }, { type: "list", items: ["a", "b"] }, { type: "divider" }])).toBe("H\nP\na\nb");
  });
});

describe("richBlocksToImportText", () => {
  it("round-trips through textToRichBlocks", async () => {
    const { richBlocksToImportText } = await import("../src/rich-text.ts");
    const blocks = [
      { type: "heading", level: 2, text: "Notes" },
      { type: "paragraph", text: "Floral." },
      { type: "list", style: "ordered", items: ["one", "two"] },
      { type: "divider" },
      { type: "heading", level: 3, text: "FAQ" },
      { type: "list", style: "unordered", items: ["a"] },
    ] as const;
    expect(textToRichBlocks(richBlocksToImportText(blocks))).toEqual(blocks);
  });
});
