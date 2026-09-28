import { describe, it, expect } from "vitest";
import { renderBlockDocument } from "../src/render.ts";
import { registerBlockMigration } from "../src/document.ts";
import type { BlockDocument } from "../src/types.ts";

describe("renderBlockDocument", () => {
  it("renders valid block document and strips hidden blocks", () => {
    const doc: BlockDocument = {
      version: 1,
      blocks: [
        {
          id: "hero-visible",
          type: "Hero",
          version: 1,
          props: {
            title: "Summer Collection 2026",
          },
        },
        {
          id: "banner-hidden",
          type: "Banner",
          version: 1,
          hidden: true,
          props: {
            text: "Hidden promo",
          },
        },
      ],
    };

    const result = renderBlockDocument(doc);
    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.id).toBe("hero-visible");
    expect(result.blocks[0]?.props.title).toBe("Summer Collection 2026");
  });

  it("migrates older-version block to current registry version before rendering", () => {
    // Register migration for Hero from version 0 to 1
    registerBlockMigration("Hero", 0, (props: Record<string, unknown>) => {
      return {
        ...props,
        title: (props.heading as string) || "Default Migrated Title",
        alignment: "center",
      };
    });

    const doc = {
      version: 1,
      blocks: [
        {
          id: "legacy-hero-1",
          type: "Hero",
          version: 0,
          props: {
            heading: "Legacy Hero Heading",
          },
        },
      ],
    };

    const result = renderBlockDocument(doc);
    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(1);
    expect(result.blocks[0]?.version).toBe(1);
    expect(result.blocks[0]?.props.title).toBe("Legacy Hero Heading");
    expect(result.blocks[0]?.props.alignment).toBe("center");
  });

  it("safely handles invalid block documents without throwing", () => {
    // null and non-objects
    const nullResult = renderBlockDocument(null);
    expect(nullResult.success).toBe(false);
    expect(nullResult.blocks).toEqual([]);
    expect(nullResult.errors && nullResult.errors.length > 0).toBe(true);

    const stringResult = renderBlockDocument("not an object");
    expect(stringResult.success).toBe(false);
    expect(stringResult.blocks).toEqual([]);
    expect(stringResult.errors && stringResult.errors.length > 0).toBe(true);

    const arrayResult = renderBlockDocument([]);
    expect(arrayResult.success).toBe(false);
    expect(arrayResult.blocks).toEqual([]);

    // missing blocks or malformed blocks
    const emptyObjResult = renderBlockDocument({});
    expect(emptyObjResult.success).toBe(false);
    expect(emptyObjResult.blocks).toEqual([]);

    const malformedResult = renderBlockDocument({
      version: 1,
      blocks: [
        null,
        {
          id: "",
          type: "InvalidType",
          version: 1,
          props: {},
        },
      ],
    });
    expect(malformedResult.success).toBe(false);
    expect(malformedResult.blocks).toEqual([]);
    expect(malformedResult.errors && malformedResult.errors.length > 0).toBe(true);
  });

  it("sanitizes rich text blocks during render", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "rich-1",
          type: "RichText",
          version: 1,
          props: {
            content: '<h2>Header</h2><script>alert("xss")</script><p onclick="steal()">Body text</p>',
          },
        },
      ],
    };

    const result = renderBlockDocument(doc);
    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(1);
    const content = result.blocks[0]?.props.content as string;
    expect(content).toContain("<h2>Header</h2>");
    expect(content).toContain("<p>Body text</p>");
    expect(content).not.toContain("<script");
    expect(content).not.toContain("alert");
    expect(content).not.toContain("onclick");
    expect(content).not.toContain("steal");
  });
});
