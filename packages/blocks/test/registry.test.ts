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

  it("registers the 12 original home-page block types plus layout, content and conversion blocks", () => {
    expect(BLOCK_TYPES).toEqual(expect.arrayContaining(expectedBlockTypes));
    expect(BLOCK_TYPES.length).toBe(27);
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

      if (type === "RichText") {
        it("sanitizes content in render function as defense-in-depth", () => {
          const def = getBlockDefinition("RichText");
          const rendered = def.render({
            props: {
              content: "<p>Safe</p><script>alert('xss')</script><img src=x onerror=alert(1)>",
              alignment: "left",
            },
          }) as React.ReactElement<{ dangerouslySetInnerHTML: { __html: string } }>;

          expect(rendered.props.dangerouslySetInnerHTML.__html).toContain("<p>Safe</p>");
          expect(rendered.props.dangerouslySetInnerHTML.__html).not.toContain("<script");
          expect(rendered.props.dangerouslySetInnerHTML.__html).not.toContain("onerror");
        });
      }
    });
  }
});
