import { describe, expect, it } from "vitest";
import { comboTitle, nextSku, normalizeOptions, optionCombinations, sameCombo } from "../src/catalog/variant-options.ts";

describe("variant option rules", () => {
  it("trims, drops empty and duplicate values and keeps order", () => {
    const out = normalizeOptions([{ name: "  Size ", values: [" S ", "M", "s", "", "L"] }]);
    expect(out).toEqual([{ name: "Size", values: ["S", "M", "L"] }]);
  });

  it("enforces the limits with plain messages", () => {
    expect(() => normalizeOptions([1, 2, 3, 4].map((n) => ({ name: `O${n}`, values: ["a"] })))).toThrow(/at most 3 options/);
    expect(() => normalizeOptions([{ name: "Size", values: ["a"] }, { name: "size", values: ["b"] }])).toThrow(/listed twice/);
    expect(() => normalizeOptions([{ name: "", values: ["a"] }])).toThrow(/needs a name/);
    expect(() => normalizeOptions([{ name: "Size", values: ["  "] }])).toThrow(/at least one value/);
    const many = (n: number) => Array.from({ length: n }, (_, i) => `v${i}`);
    expect(() => normalizeOptions([{ name: "A", values: many(31) }])).toThrow(/at most 30 values/);
    // 30 x 9 = 270 > 250
    expect(() => normalizeOptions([{ name: "A", values: many(30) }, { name: "B", values: many(9) }])).toThrow(/at most 250/);
    expect(normalizeOptions([{ name: "A", values: many(25) }, { name: "B", values: many(10) }])).toHaveLength(2); // 250 is allowed
  });

  it("builds every combination, first option varying slowest", () => {
    const options = [
      { name: "Size", values: ["S", "M"] },
      { name: "Color", values: ["Red", "Blue"] },
    ];
    const combos = optionCombinations(options);
    expect(combos).toEqual([
      { Size: "S", Color: "Red" },
      { Size: "S", Color: "Blue" },
      { Size: "M", Color: "Red" },
      { Size: "M", Color: "Blue" },
    ]);
    expect(comboTitle(combos[1] as Record<string, string>, options)).toBe("S / Blue");
    expect(optionCombinations([])).toEqual([]);
  });

  it("compares combinations and picks free SKUs", () => {
    expect(sameCombo({ Size: "S" }, { Size: "S" })).toBe(true);
    expect(sameCombo({ Size: "S" }, { Size: "M" })).toBe(false);
    expect(sameCombo({ Size: "S" }, { Size: "S", Color: "Red" })).toBe(false);
    expect(sameCombo(null, {})).toBe(true);
    const taken = new Set(["tea-1", "tea-2"]);
    expect(nextSku("TEA", taken)).toBe("TEA-3");
    expect(nextSku("TEA", taken)).toBe("TEA-4");
  });
});
