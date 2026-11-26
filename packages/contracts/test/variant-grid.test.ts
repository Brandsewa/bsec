import { describe, expect, it } from "vitest";
import { planVariantGrid } from "../src/variant-grid.ts";

const colour = { name: "Colour", values: ["Red", "Blue"] };
const size = { name: "Size", values: ["S", "M"] };

describe("planVariantGrid", () => {
  it("keeps exact matches and creates the rest", () => {
    const plan = planVariantGrid([colour], [{ optionValues: { Colour: "Blue" } }]);
    expect(plan.assigned).toEqual([{ index: 0, combo: { Colour: "Blue" }, changed: false }]);
    expect(plan.toCreate).toEqual([{ Colour: "Red" }]);
  });

  it("turns a lone option-less variant into the first combination", () => {
    const plan = planVariantGrid([colour, size], [{ optionValues: null }]);
    expect(plan.assigned).toEqual([{ index: 0, combo: { Colour: "Red", Size: "S" }, changed: true }]);
    expect(plan.toCreate).toHaveLength(3);
  });

  it("extends existing variants when an option is added, so none is left outside the grid", () => {
    const plan = planVariantGrid([colour, size], [{ optionValues: { Colour: "Red" } }, { optionValues: { Colour: "Blue" } }]);
    expect(plan.assigned).toEqual([
      { index: 0, combo: { Colour: "Red", Size: "S" }, changed: true },
      { index: 1, combo: { Colour: "Blue", Size: "S" }, changed: true },
    ]);
    expect(plan.toCreate).toEqual([
      { Colour: "Red", Size: "M" },
      { Colour: "Blue", Size: "M" },
    ]);
  });

  it("prefers an exact match over extending, and never moves a variant to another value", () => {
    const plan = planVariantGrid([colour, size], [{ optionValues: { Colour: "Red" } }, { optionValues: { Colour: "Red", Size: "S" } }, { optionValues: { Colour: "Green" } }]);
    expect(plan.assigned).toContainEqual({ index: 1, combo: { Colour: "Red", Size: "S" }, changed: false });
    expect(plan.assigned).toContainEqual({ index: 0, combo: { Colour: "Red", Size: "M" }, changed: true });
    expect(plan.assigned.find((a) => a.index === 2)).toBeUndefined(); // Green is not offered any more: left alone
    expect(plan.toCreate).toEqual([
      { Colour: "Blue", Size: "S" },
      { Colour: "Blue", Size: "M" },
    ]);
  });
});
