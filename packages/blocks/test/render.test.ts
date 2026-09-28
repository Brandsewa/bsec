import { describe, it, expect, afterEach } from "vitest";
import { renderBlockDocument } from "../src/render.ts";
import { registerBlockMigration, clearBlockMigrations } from "../src/document.ts";
import type { BlockDocument } from "../src/types.ts";

describe("renderBlockDocument", () => {
  afterEach(() => {
    clearBlockMigrations();
  });

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

  it("handles frozen block document inputs without throwing", () => {
    const doc = Object.freeze({
      version: 1,
      blocks: Object.freeze([
        Object.freeze({
          id: "frozen-hero",
          type: "Hero",
          version: 1,
          props: Object.freeze({
            title: "Frozen Hero",
            alignment: "center",
          }),
        }),
        Object.freeze({
          id: "frozen-rich-text",
          type: "RichText",
          version: 1,
          props: Object.freeze({
            content: "<p>Frozen text<script>alert(1)</script></p>",
          }),
        }),
      ]),
    });

    const result = renderBlockDocument(doc);
    expect(result.success).toBe(true);
    expect(result.blocks).toHaveLength(2);
    expect(result.blocks[0]?.props.title).toBe("Frozen Hero");
    expect(result.blocks[1]?.props.content).toContain("<p>Frozen text</p>");
    expect(result.blocks[1]?.props.content).not.toContain("<script");
  });

  it("catches migrator exceptions and returns structured validation errors", () => {
    registerBlockMigration("Hero", 0, () => {
      throw new Error("Migrator failure: database timeout");
    });

    const doc = {
      version: 1,
      blocks: [
        {
          id: "failing-hero",
          type: "Hero",
          version: 0,
          props: { heading: "Old Heading" },
        },
      ],
    };

    const result = renderBlockDocument(doc);
    expect(result.success).toBe(false);
    expect(result.blocks).toEqual([]);
    expect(result.errors).toEqual([
      { path: "", message: "Migrator failure: database timeout" },
    ]);
  });

  it("safely handles invalid block documents without throwing and returns complete errors", () => {
    // null and non-objects
    const nullResult = renderBlockDocument(null);
    expect(nullResult.success).toBe(false);
    expect(nullResult.blocks).toEqual([]);
    expect(nullResult.errors).toEqual([
      { path: "", message: "Block document must be a non-null object" },
    ]);

    const stringResult = renderBlockDocument("not an object");
    expect(stringResult.success).toBe(false);
    expect(stringResult.blocks).toEqual([]);
    expect(stringResult.errors).toEqual([
      { path: "", message: "Block document must be a non-null object" },
    ]);

    const arrayResult = renderBlockDocument([]);
    expect(arrayResult.success).toBe(false);
    expect(arrayResult.blocks).toEqual([]);
    expect(arrayResult.errors).toEqual([
      { path: "", message: "Block document must be a non-null object" },
    ]);

    // missing blocks or malformed blocks
    const emptyObjResult = renderBlockDocument({});
    expect(emptyObjResult.success).toBe(false);
    expect(emptyObjResult.blocks).toEqual([]);
    expect(emptyObjResult.errors).toEqual([
      { path: "version", message: "Only document version 1 is currently supported" },
    ]);

    const missingBlocksResult = renderBlockDocument({ version: 1 });
    expect(missingBlocksResult.success).toBe(false);
    expect(missingBlocksResult.blocks).toEqual([]);
    expect(missingBlocksResult.errors).toEqual([
      { path: "blocks", message: "Document must contain an array of blocks" },
    ]);

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
    expect(malformedResult.errors).toEqual([
      { path: "blocks[0]", message: "Block must be an object" },
      { path: "blocks[1].id", message: "Block ID must be a non-empty string" },
    ]);
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
