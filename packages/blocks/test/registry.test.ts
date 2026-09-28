import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  getBlockDefinition,
  type BlockType,
} from "../src/registry.ts";

describe("Block Registry v1", () => {
  const expectedBlockTypes: BlockType[] = [
    "Hero",
    "Banner",
    "ProductGrid",
    "CollectionGrid",
    "ProductCarousel",
    "Testimonials",
    "Reviews",
    "RichText",
    "FAQ",
    "Gallery",
    "Newsletter",
    "UspStrip",
  ];

  it("registers all 12 required home-page block types", () => {
    expect(BLOCK_TYPES).toEqual(expect.arrayContaining(expectedBlockTypes));
    expect(BLOCK_TYPES.length).toBe(12);
  });

  for (const type of expectedBlockTypes) {
    describe(`Block: ${type}`, () => {
      it("has a valid version, schema, defaultProps, and renderer", () => {
        const def = getBlockDefinition(type);
        expect(def).toBeDefined();
        expect(def.type).toBe(type);
        expect(def.version).toBeGreaterThanOrEqual(1);
        expect(typeof def.render).toBe("function");

        // defaultProps must satisfy the block's schema
        const parseResult = def.schema.safeParse(def.defaultProps);
        expect(parseResult.success, `defaultProps failed schema validation for ${type}`).toBe(true);
      });

      it("rejects invalid props", () => {
        const def = getBlockDefinition(type);
        // Passing non-object or missing required fields should fail
        const res = def.schema.safeParse("invalid string input");
        expect(res.success).toBe(false);
      });
    });
  }
});
