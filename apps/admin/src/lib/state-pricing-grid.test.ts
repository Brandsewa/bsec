import { describe, expect, it } from "vitest";
import { buildChanges, buildExportCsv, cellProblem, planImport, toMajor, toMinor } from "./state-pricing-grid.ts";

const states = [
  { code: "MH", name: "Maharashtra" },
  { code: "KA", name: "Karnataka" },
  { code: "JK", name: "Jammu and Kashmir" },
];

describe("money text", () => {
  it("parses rupees with commas, symbol and up to two decimals", () => {
    expect(toMinor("900")).toBe(90000);
    expect(toMinor("₹ 1,299.50")).toBe(129950);
    expect(toMinor("0.99")).toBe(99);
  });
  it("rejects empty, zero, negative, three decimals and text", () => {
    for (const bad of ["", "0", "-5", "1.234", "abc", "1e3"]) expect(toMinor(bad)).toBeNull();
    expect(cellProblem("")).toBeNull();
    expect(cellProblem("abc")).toMatch(/above zero/);
  });
  it("shows paise as plain rupees", () => {
    expect(toMajor(90000)).toBe("900");
    expect(toMajor(95050)).toBe("950.5");
  });
});

describe("buildChanges", () => {
  const known = new Map([["v1", { MH: { price: 90000 }, KA: { price: 95050 } }]]);
  it("sends only real changes and removals", () => {
    const { changes, invalid } = buildChanges({ "v1:MH": "900", "v1:KA": "", "v1:TN": "800", "v1:AP": "" }, known);
    expect(invalid).toBeNull();
    expect(changes).toEqual([
      { variantId: "v1", state: "KA", price: null },
      { variantId: "v1", state: "TN", price: 80000 },
    ]);
  });
  it("always sends an edit for a variant it has never loaded, and reports an invalid cell", () => {
    expect(buildChanges({ "v9:MH": "10" }, known).changes).toEqual([{ variantId: "v9", state: "MH", price: 1000 }]);
    expect(buildChanges({ "v1:MH": "x" }, known)).toEqual({ changes: [], invalid: "v1:MH" });
  });
});

describe("export and import", () => {
  const products = [
    {
      productId: "p1",
      productTitle: "Orange Squash",
      variants: [
        { variantId: "v1", title: "360ml", sku: "OS360", basePrice: 13000, prices: { MH: { price: 10000, compareAtPrice: null } } },
        { variantId: "v2", title: "660ml", sku: "OS660", basePrice: 20000, prices: {} },
      ],
    },
  ];
  it("exports the sheet layout with a state column per chosen state", () => {
    const csv = buildExportCsv(products, states, ["MH", "KA"]);
    expect(csv.split("\r\n")).toEqual(["SKU,Product Name,Variant,Default Price,Maharashtra,Karnataka", "OS360,Orange Squash,360ml,130,100,", "OS660,Orange Squash,660ml,200,,"]);
  });
  it("plans an import by SKU, state-name headers, and reports the rest", () => {
    const rows = [
      ["SKU", "Product Name", "Variant", "Default Price", "Maharashtra", "Jammu & Kashmir", "Add a State"],
      ["OS360", "x", "x", "130", "₹100", "", ""],
      ["OS660", "x", "x", "200", "abc", "150", ""],
      ["NOPE", "x", "x", "1", "5", "", ""],
    ];
    const plan = planImport(rows, states, new Map([["OS360", "v1"], ["OS660", "v2"]]));
    expect(plan.edits).toEqual({ "v1:MH": "₹100", "v2:JK": "150" });
    expect(plan.rowsMatched).toBe(2);
    expect(plan.unmatchedSkus).toEqual(["NOPE"]);
    expect(plan.badCells).toEqual(["OS660 / MH"]);
    expect(plan.ignoredColumns).toEqual(expect.arrayContaining(["Product Name", "Variant", "Default Price", "Add a State"]));
    expect(plan.stateCodes).toEqual(["MH", "JK"]);
  });
  it("needs a SKU column", () => {
    expect(() => planImport([["Name"], ["x"]], states, new Map())).toThrow(/SKU column/);
  });
});
