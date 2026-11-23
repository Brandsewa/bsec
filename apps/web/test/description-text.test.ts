import { describe, expect, it } from "vitest";
import { descriptionText, paragraphs } from "../src/lib/description-text.ts";

describe("descriptionText", () => {
  it("reads plain text in either stored form", () => {
    expect(descriptionText("  plain  ")).toBe("plain");
    expect(descriptionText({ type: "text", text: " Old text. " })).toBe("Old text.");
    expect(descriptionText(null)).toBe("");
  });

  it("reads a formatted description as one paragraph per block, so the Read more popup keeps its shape", () => {
    const rich = { v: 1, blocks: [{ type: "heading", level: 2, text: "Notes" }, { type: "paragraph", text: "Floral and bright." }, { type: "list", style: "unordered", items: ["2 g", "85 degrees"] }, { type: "divider" }] };
    expect(descriptionText(rich)).toBe("Notes\n\nFloral and bright.\n\n2 g\n85 degrees");
    expect(paragraphs(descriptionText(rich))).toEqual(["Notes", "Floral and bright.", "2 g\n85 degrees"]);
  });
});
