import { migrateBlockDocument, validateBlockDocument, type ValidationError } from "./document.ts";
import type { BlockDocument, BlockInstance } from "./types.ts";
import { filterVisibleBlocks } from "./tree.ts";

export type RenderBlockResult =
  | { success: true; blocks: BlockInstance[]; errors?: never }
  | { success: false; blocks: []; errors: ValidationError[] };

/**
 * Prepares a block document for public storefront rendering.
 * 1. Safely checks document structure.
 * 2. Migrates older-version blocks to the current registry version.
 * 3. Validates block props against schemas and sanitizes rich text.
 * 4. Filters out hidden blocks so they are not rendered.
 */
export function renderBlockDocument(doc: unknown): RenderBlockResult {
  try {
    if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
      return {
        success: false,
        blocks: [],
        errors: [{ path: "", message: "Block document must be a non-null object" }],
      };
    }

    // Cast candidate to BlockDocument for migration
    const candidate = doc as BlockDocument;
    const migrated = migrateBlockDocument(candidate);
    const validated = validateBlockDocument(migrated);

    if (!validated.success) {
      return {
        success: false,
        blocks: [],
        errors: validated.errors,
      };
    }

    const visibleBlocks = filterVisibleBlocks(validated.data.blocks);

    return {
      success: true,
      blocks: visibleBlocks,
    };
  } catch (err) {
    return {
      success: false,
      blocks: [],
      errors: [{ path: "", message: err instanceof Error ? err.message : String(err) }],
    };
  }
}
