import { describe, expect, it } from "vitest";
import { hasFieldValue, normalizeFieldKey, normalizeFieldOptions, normalizeFieldValue, type FieldDefinitionLike } from "../src/catalog/custom-field-rules.ts";

const ctx = {
  sanitizeHtml: (html: string) => html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/ on\w+="[^"]*"/gi, ""),
  htmlToText: (html: string) => html.replace(/<[^>]+>/g, ""),
};
const def = (type: FieldDefinitionLike["type"], config: FieldDefinitionLike["config"] = {}): FieldDefinitionLike => ({ name: "Ingredients", type, required: false, config });

describe("custom field rules", () => {
  it("normalises keys and rejects bad ones", () => {
    expect(normalizeFieldKey("  Tea Ingredients! ")).toBe("tea_ingredients");
    expect(() => normalizeFieldKey("1abc")).toThrow(/start with a letter/);
    expect(() => normalizeFieldKey("---")).toThrow(/start with a letter/);
    expect(() => normalizeFieldKey("a".repeat(41))).toThrow(/up to 40/);
  });

  it("cleans options and refuses empty or duplicate ones", () => {
    expect(normalizeFieldOptions([{ label: " Green Tea " }, { label: "Black", value: "blk" }])).toEqual([
      { value: "green-tea", label: "Green Tea" },
      { value: "blk", label: "Black" },
    ]);
    expect(() => normalizeFieldOptions([])).toThrow(/at least one option/);
    expect(() => normalizeFieldOptions([{ label: "A" }, { label: "a" }])).toThrow(/listed twice/);
    expect(() => normalizeFieldOptions([{ label: "   " }])).toThrow(/needs a label/);
  });

  it("checks text, rich text and numbers", () => {
    expect(normalizeFieldValue(def("text"), "  Assam tea  ", ctx)).toBe("Assam tea");
    expect(normalizeFieldValue(def("text"), "   ", ctx)).toBeNull();
    expect(() => normalizeFieldValue(def("text"), "x".repeat(501), ctx)).toThrow(/at most 500/);
    expect(() => normalizeFieldValue(def("text"), 5, ctx)).toThrow(/must be text/);

    expect(normalizeFieldValue(def("rich_text"), '<p onclick="x()">Hi</p><script>alert(1)</script>', ctx)).toBe("<p>Hi</p>");
    expect(normalizeFieldValue(def("rich_text"), "<p></p>", ctx)).toBeNull();

    expect(normalizeFieldValue(def("number"), "12.5", ctx)).toBe(12.5);
    expect(normalizeFieldValue(def("number"), "", ctx)).toBeNull();
    expect(() => normalizeFieldValue(def("number"), "abc", ctx)).toThrow(/must be a number/);
    expect(() => normalizeFieldValue(def("number"), 1e15, ctx)).toThrow(/too large/);
  });

  it("checks options for dropdown and multi select, keeping the defined order", () => {
    const options = [{ value: "a", label: "A" }, { value: "b", label: "B" }, { value: "c", label: "C" }];
    expect(normalizeFieldValue(def("dropdown", { options }), "b", ctx)).toBe("b");
    expect(() => normalizeFieldValue(def("dropdown", { options }), "zzz", ctx)).toThrow(/not an option/);
    expect(normalizeFieldValue(def("multi_select", { options }), ["c", "a", "c"], ctx)).toEqual(["a", "c"]);
    expect(normalizeFieldValue(def("multi_select", { options }), [], ctx)).toBeNull();
    expect(() => normalizeFieldValue(def("multi_select", { options }), ["a", "x"], ctx)).toThrow(/not an option/);
    expect(() => normalizeFieldValue(def("multi_select", { options }), "a", ctx)).toThrow(/list of options/);
  });

  it("accepts a media id for images and a real boolean", () => {
    const id = "01a13fa1-725a-76b4-9741-5c3a7ddeafb9";
    expect(normalizeFieldValue(def("image"), id, ctx)).toEqual({ mediaId: id });
    expect(normalizeFieldValue(def("image"), { mediaId: id.toUpperCase() }, ctx)).toEqual({ mediaId: id });
    expect(normalizeFieldValue(def("image"), "", ctx)).toBeNull();
    expect(() => normalizeFieldValue(def("image"), "https://evil.example/x.png", ctx)).toThrow(/media library/);
    expect(normalizeFieldValue(def("boolean"), false, ctx)).toBe(false);
    expect(() => normalizeFieldValue(def("boolean"), "yes", ctx)).toThrow(/yes or no/);
    expect(normalizeFieldValue(def("text"), null, ctx)).toBeNull();
  });

  it("knows which values count as filled in", () => {
    expect(hasFieldValue("x")).toBe(true);
    expect(hasFieldValue("  ")).toBe(false);
    expect(hasFieldValue([])).toBe(false);
    expect(hasFieldValue(false)).toBe(true);
    expect(hasFieldValue(0)).toBe(true);
    expect(hasFieldValue(null)).toBe(false);
  });
});
