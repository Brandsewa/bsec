import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("per-widget layout box (blocks.css)", () => {
  it("is full width unless a width is set, so a flex-column page does not shrink it to its content", () => {
    const css = readFileSync(new URL("../src/blocks.css", import.meta.url), "utf8");
    // The storefront lists blocks in a flex column and the box has auto side margins: without a fallback width the
    // hero slider (all slides absolutely placed) collapsed to 0px wide and its banner images never showed.
    expect(css).toMatch(/\.bsb-lay \{[^}]*width: var\(--w, 100%\)/s);
  });
});
