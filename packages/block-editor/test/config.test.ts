import { describe, expect, it } from "vitest";
import { BLOCK_TYPES, SLOT_BLOCK_TYPES, SLOT_PROP, getBlockDefinition, validateBlockDocument, type BlockInstance } from "@bs/blocks";
import { BLOCK_SPECS, buildPuckConfig, dataSignature } from "../src/index.ts";

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

  it("builds a Puck config with categories covering all components once", () => {
    const config = buildPuckConfig({ themeVars: {} }) as unknown as {
      components: Record<string, unknown>;
      categories: Record<string, { components: string[] }>;
    };
    expect(Object.keys(config.components).sort()).toEqual([...BLOCK_TYPES].sort());
    const listed = Object.values(config.categories).flatMap((c) => c.components);
    expect([...listed].sort()).toEqual([...BLOCK_TYPES].sort());
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
