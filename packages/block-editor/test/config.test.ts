import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, SLOT_BLOCK_TYPES, SLOT_PROP, getBlockDefinition, validateBlockDocument, type BlockInstance } from "@bs/blocks";
import { BLOCK_SPECS, blockAllowed, buildPuckConfig, dataSignature, type EditorPageKind } from "../src/index.ts";

describe("editor config", () => {
  it("has an editor panel for every registered block (none can be added without one)", () => {
    expect(Object.keys(BLOCK_SPECS).sort()).toEqual([...BLOCK_TYPES].sort());
  });

  it("only offers fields that exist in the block's schema", () => {
    for (const type of BLOCK_TYPES) {
      const def = getBlockDefinition(type);
      const shape = (def.schema as unknown as { shape: Record<string, unknown> }).shape;
      for (const field of Object.keys(BLOCK_SPECS[type].fields)) {
        expect(Object.keys(shape), `${type}.${field}`).toContain(field);
      }
    }
  });

  it("layout blocks expose exactly one slot and content blocks none", () => {
    for (const type of BLOCK_TYPES) {
      const hasSlot = BLOCK_SPECS[type].fields[SLOT_PROP]?.type === "slot";
      expect(hasSlot, type).toBe(SLOT_BLOCK_TYPES.has(type));
    }
  });

  it("every default props object produces a valid document block", () => {
    for (const type of BLOCK_TYPES) {
      const def = getBlockDefinition(type);
      const props = SLOT_BLOCK_TYPES.has(type) ? { ...def.defaultProps, [SLOT_PROP]: [] } : (def.defaultProps as Record<string, unknown>);
      const r = validateBlockDocument({ version: 1, blocks: [{ id: "x", type, version: def.version, props }] });
      expect(r.success, `${type}: ${JSON.stringify(r)}`).toBe(true);
    }
  });

  it("builds a Puck config whose categories list each component exactly once, for every page kind", () => {
    const union = new Set<string>();
    for (const pageKind of ["home", "collection", "product", "header", "footer", "custom"] as const) {
      const config = buildPuckConfig({ themeVars: {}, pageKind }) as unknown as {
        components: Record<string, unknown>;
        categories: Record<string, { components: string[] }>;
      };
      const listed = Object.values(config.categories).flatMap((c) => c.components);
      expect([...listed].sort(), pageKind).toEqual(Object.keys(config.components).sort());
      Object.keys(config.components).forEach((t) => union.add(t));
    }
    expect([...union].sort()).toEqual([...BLOCK_TYPES].sort());
  });
});

describe("dataSignature", () => {
  const block = (id: string, type: BlockInstance["type"], props: Record<string, unknown>): BlockInstance => ({ id, type, version: 1, props });

  it("ignores text edits but changes when products or images change", () => {
    const base = [block("a", "ProductCarousel", { title: "One", source: "newest", limit: 8 }), block("h", "Heading", { text: "Hi" })];
    const textEdit = [block("a", "ProductCarousel", { title: "Renamed", source: "newest", limit: 8 }), block("h", "Heading", { text: "Changed" })];
    expect(dataSignature(textEdit)).toBe(dataSignature(base));
    expect(dataSignature([block("a", "ProductCarousel", { title: "One", source: "featured", limit: 8 })])).not.toBe(dataSignature(base));
    expect(dataSignature([...base, block("i", "Image", { mediaId: "m1" })])).not.toBe(dataSignature(base));
  });

  it("sees blocks nested inside layout blocks", () => {
    const nested = [block("s", "Section", { content: [block("a", "ProductGrid", { title: "x", source: "manual", productSlugs: ["a"] })] })];
    expect(dataSignature(nested)).toContain('"a"');
  });
});

describe("block picker by page kind", () => {
  const offered = (kind: EditorPageKind) =>
    Object.keys(buildPuckConfig({ themeVars: {}, pageKind: kind }).components);

  it("header and footer pages only offer chrome-appropriate blocks", () => {
    expect([...offered("header")].sort()).toEqual(["Banner", "SiteHeader"]);
    expect(offered("footer")).toContain("SiteFooter");
    expect(offered("footer")).not.toContain("ProductGrid");
  });

  it("the product core is only offered on the product page, the collection core on the collection page", () => {
    expect(offered("product")).toContain("ProductDetail");
    expect(offered("product")).not.toContain("CollectionListing");
    expect(offered("collection")).toContain("CollectionListing");
    expect(offered("collection")).not.toContain("ProductDetail");
    for (const kind of ["home", "custom"] as const) {
      expect(offered(kind)).not.toContain("ProductDetail");
      expect(offered(kind)).not.toContain("SiteHeader");
    }
  });

  it("every block is offered somewhere", () => {
    for (const type of BLOCK_TYPES) {
      const kinds = ["home", "collection", "product", "header", "footer"] as const;
      expect(kinds.some((k) => blockAllowed(type, k)), type).toBe(true);
    }
  });
});
