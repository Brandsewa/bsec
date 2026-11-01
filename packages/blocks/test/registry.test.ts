import { describe, expect, it } from "vitest";
import {
  BLOCK_TYPES,
  getBlockDefinition,
  type BlockType,
} from "../src/registry.ts";

describe("Block Registry v1", () => {
  const expectedBlockTypes: BlockType[] = ["Banner", "CollectionGrid", "Reviews", "Gallery", "TrustStrip"];

  it("registers the kept widgets plus layout, content, store-chrome and cart blocks", () => {
    expect(BLOCK_TYPES).toEqual(expect.arrayContaining(expectedBlockTypes));
    expect(BLOCK_TYPES.length).toBe(32);
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

  it("no longer registers the retired widgets (their saved copies are dropped when a page is read)", () => {
    for (const gone of ["Hero", "ProductGrid", "ProductCarousel", "Testimonials", "RichText", "FAQ", "Newsletter", "UspStrip", "Grid", "FlexRow", "FlexColumn", "Spacer", "Divider", "FileDownload", "Icon", "Link", "CallToAction", "BlogPosts"]) {
      expect(BLOCK_TYPES as string[]).not.toContain(gone);
    }
  });

  describe("Block: Video", () => {
    it("accepts mediaId, posterMediaId, autoplayLoop and url", () => {
      const def = getBlockDefinition("Video");
      const valid = def.schema.safeParse({
        mediaId: "11111111-1111-4111-8111-111111111111",
        posterMediaId: "22222222-2222-4222-8222-222222222222",
        autoplayLoop: true,
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      });
      expect(valid.success).toBe(true);
    });
  });
});

