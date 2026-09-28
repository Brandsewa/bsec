import { describe, it, expect } from "vitest";
import {
  validateBlockDocument,
  migrateBlockDocument,
  registerBlockMigration,
} from "../src/document.ts";
import type { BlockDocument, BlockInstance } from "../src/types.ts";
import { sanitizeRichText } from "../src/sanitize.ts";

describe("sanitizeRichText", () => {
  it("allows safe html formatting tags and safe attributes", () => {
    const input = "<h1>Headline</h1><p>Hello <strong>world</strong> and <em>italic</em> with <a href=\"https://example.com\" target=\"_blank\">link</a></p><ul><li>item 1</li></ul>";
    const sanitized = sanitizeRichText(input);
    expect(sanitized).toContain("<h1>Headline</h1>");
    expect(sanitized).toContain("<p>Hello <strong>world</strong>");
    expect(sanitized).toContain("<a href=\"https://example.com\"");
    expect(sanitized).toContain("rel=\"noopener noreferrer\"");
  });

  it("strips script tags and inner javascript", () => {
    const malicious = "<p>Clean text</p><script>alert('pwned')</script>";
    const sanitized = sanitizeRichText(malicious);
    expect(sanitized).not.toContain("<script");
    expect(sanitized).not.toContain("alert('pwned')");
    expect(sanitized).toContain("<p>Clean text</p>");
  });

  it("strips inline event handlers (onerror, onclick, etc)", () => {
    const malicious = '<img src="invalid.jpg" onerror="alert(1)" /><b onclick="alert(2)">Bold</b>';
    const sanitized = sanitizeRichText(malicious);
    expect(sanitized).not.toContain("onerror");
    expect(sanitized).not.toContain("onclick");
    expect(sanitized).not.toContain("alert");
  });

  it("strips javascript: and data: pseudo-protocols in links", () => {
    const malicious = '<a href="javascript:alert(1)">Click me</a><a href="data:text/html,<script>alert(1)</script>">Data link</a>';
    const sanitized = sanitizeRichText(malicious);
    expect(sanitized).not.toContain("javascript:");
    expect(sanitized).not.toContain("data:");
  });

  it("strips iframe, object, embed, and style tags", () => {
    const malicious = '<iframe src="https://evil.com"></iframe><style>body{display:none}</style><p>Hello</p>';
    const sanitized = sanitizeRichText(malicious);
    expect(sanitized).not.toContain("<iframe");
    expect(sanitized).not.toContain("<style");
    expect(sanitized).toContain("<p>Hello</p>");
  });
});

describe("validateBlockDocument", () => {
  it("validates an empty document successfully", () => {
    const doc = {
      version: 1,
      blocks: [],
    };
    const result = validateBlockDocument(doc);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.version).toBe(1);
      expect(result.data.blocks).toEqual([]);
    }
  });

  it("validates a document with valid blocks and applies defaults", () => {
    const doc: BlockDocument = {
      version: 1,
      blocks: [
        {
          id: "hero-1",
          type: "Hero",
          version: 1,
          props: {
            title: "Summer Collection 2026",
          },
        },
        {
          id: "banner-1",
          type: "Banner",
          version: 1,
          props: {
            text: "Free shipping worldwide",
          },
        },
      ],
    };
    const result = validateBlockDocument(doc);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.blocks).toHaveLength(2);
      expect(result.data.blocks[0]?.props.title).toBe("Summer Collection 2026");
      expect(result.data.blocks[0]?.props.alignment).toBe("center");
      expect(result.data.blocks[1]?.props.variant).toBe("promo");
    }
  });

  it("sanitizes RichText block props during document validation", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "rt-1",
          type: "RichText",
          version: 1,
          props: {
            content: "<h2>Safe Title</h2><script>alert('xss')</script><p>Safe paragraph</p>",
            alignment: "left",
          },
        },
      ],
    };
    const result = validateBlockDocument(doc);
    expect(result.success).toBe(true);
    if (result.success) {
      const rtBlock = result.data.blocks[0];
      expect(rtBlock).toBeDefined();
      if (rtBlock) {
        expect(rtBlock.props.content).toContain("<h2>Safe Title</h2>");
        expect(rtBlock.props.content).toContain("<p>Safe paragraph</p>");
        expect(rtBlock.props.content).not.toContain("<script");
        expect(rtBlock.props.content).not.toContain("alert('xss')");
      }
    }
  });

  it("rejects non-object or missing version", () => {
    expect(validateBlockDocument(null).success).toBe(false);
    expect(validateBlockDocument(undefined).success).toBe(false);
    expect(validateBlockDocument("string").success).toBe(false);
    expect(validateBlockDocument({ blocks: [] }).success).toBe(false);
    expect(validateBlockDocument({ version: 2, blocks: [] }).success).toBe(false);
  });

  it("rejects duplicate block IDs", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "block-dup",
          type: "Banner",
          version: 1,
          props: { text: "Banner 1" },
        },
        {
          id: "block-dup",
          type: "Banner",
          version: 1,
          props: { text: "Banner 2" },
        },
      ],
    };
    const result = validateBlockDocument(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.message.includes("Duplicate block ID"))).toBe(true);
    }
  });

  it("rejects unknown block types", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "inv-1",
          type: "NonExistentBlock",
          version: 1,
          props: {},
        },
      ],
    };
    const result = validateBlockDocument(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.some((e) => e.message.includes("Unknown block type"))).toBe(true);
    }
  });

  it("rejects blocks with invalid props schema", () => {
    const doc = {
      version: 1,
      blocks: [
        {
          id: "hero-1",
          type: "Hero",
          version: 1,
          props: {
            // missing required 'title'
            alignment: "invalid-alignment",
          },
        },
      ],
    };
    const result = validateBlockDocument(doc);
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

describe("migrateBlockDocument", () => {
  it("returns document unchanged if all blocks are at their target version", () => {
    const doc: BlockDocument = {
      version: 1,
      blocks: [
        {
          id: "hero-1",
          type: "Hero",
          version: 1,
          props: {
            title: "Original Title",
          },
        },
      ],
    };
    const migrated = migrateBlockDocument(doc);
    expect(migrated).toEqual(doc);
  });

  it("runs registered block migrations sequentially", () => {
    // Register test migration from v0 -> v1
    registerBlockMigration("Hero", 0, (props: Record<string, unknown>) => {
      return {
        ...props,
        title: (props.heading as string) || "Migrated Title",
      };
    });

    const oldBlock: BlockInstance = {
      id: "legacy-hero",
      type: "Hero",
      version: 0,
      props: {
        heading: "Legacy Heading",
      },
    };

    const doc: BlockDocument = {
      version: 1,
      blocks: [oldBlock],
    };

    const migrated = migrateBlockDocument(doc);
    expect(migrated.blocks[0]?.version).toBe(1);
    expect(migrated.blocks[0]?.props.title).toBe("Legacy Heading");
  });
});
