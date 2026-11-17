import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/**
 * Regression: switching pages in the theme builder kept the previous page's blocks (the editor copies them once on
 * mount) and the next save wrote them into the new page, overwriting a store's Header and Home. The editor must be a
 * fresh instance per page and must refuse to mount on data that belongs to another page.
 */
describe("page editor page switching", () => {
  it("remounts the editor for every page id", () => {
    expect(read("../src/routes/_editor/online-store/editor/$pageId.tsx")).toMatch(/<PageVisualEditor\s+key=\{pageId\}/);
    expect(read("../src/components/page-editor/PageVisualEditor.tsx")).toMatch(/<BlockEditor\s+key=\{page\.id\}/);
  });

  it("does not render the editor with another page's data", () => {
    expect(read("../src/components/page-editor/PageVisualEditor.tsx")).toContain("pageQuery.data.id !== pageId");
  });
});
