import { describe, expect, it } from "vitest";
import { cleanOptions, optionCombinations, previewGrid } from "../src/lib/variant-grid.ts";

describe("variant grid preview", () => {
  it("cleans option values like the server does", () => {
    expect(cleanOptions([{ name: " Size ", values: [" S", "s", "M ", ""] }])).toEqual([{ name: "Size", values: ["S", "M"] }]);
  });

  it("counts new variants and reuses the single existing variant on first use", () => {
    const options = [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Red", "Blue"] },
    ];
    expect(optionCombinations(options)).toHaveLength(4);
    expect(previewGrid(options, [{ optionValues: null }])).toEqual({ error: null, total: 4, toCreate: 3 });
    expect(previewGrid(options, [{ optionValues: { Size: "S", Color: "Red" } }])).toEqual({ error: null, total: 4, toCreate: 3 });
    expect(previewGrid(options, [{ optionValues: { Size: "S", Color: "Red" } }, { optionValues: { Size: "M", Color: "Blue" } }]).toCreate).toBe(2);
  });

  it("explains invalid sets", () => {
    expect(previewGrid([{ name: "", values: ["a"] }], []).error).toMatch(/needs a name/);
    expect(previewGrid([{ name: "A", values: [] }], []).error).toMatch(/at least one value/);
    expect(previewGrid([{ name: "A", values: ["x"] }, { name: "a", values: ["y"] }], []).error).toMatch(/twice/);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    expect(previewGrid([{ name: "A", values: many(30) }, { name: "B", values: many(9) }], []).error).toMatch(/limit is 250/);
  });
});
