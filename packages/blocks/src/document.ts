import { BLOCK_DEFINITIONS, type BlockType, BLOCK_TYPES } from "./registry.ts";
import {
  MAX_BLOCKS_PER_DOCUMENT,
  MAX_BLOCK_DEPTH,
  SLOT_BLOCK_TYPES,
  SLOT_PROP,
  type BlockInstance,
  type BlockDocument,
} from "./types.ts";
import { sanitizeRichText } from "./sanitize.ts";

export type ValidationError = {
  path: string;
  message: string;
};

export type ValidationResult =
  | { success: true; data: BlockDocument }
  | { success: false; errors: ValidationError[] };

export type MigrationFunction = (props: Record<string, unknown>) => Record<string, unknown>;

// Migration registry: BlockType -> fromVersion -> migrator to next version
const MIGRATION_REGISTRY = new Map<string, Map<number, MigrationFunction>>();

/**
 * Register a migration function to upgrade a block's props from fromVersion to fromVersion + 1.
 */
export function registerBlockMigration(
  type: BlockType,
  fromVersion: number,
  migrator: MigrationFunction,
): void {
  let typeMigrations = MIGRATION_REGISTRY.get(type);
  if (!typeMigrations) {
    typeMigrations = new Map<number, MigrationFunction>();
    MIGRATION_REGISTRY.set(type, typeMigrations);
  }
  typeMigrations.set(fromVersion, migrator);
}

/**
 * Clear all registered block migrations.
 */
export function clearBlockMigrations(): void {
  MIGRATION_REGISTRY.clear();
}

/**
 * Validates a block document JSON payload against the block registry.
 * Validates document version, block schema props, enforces ID uniqueness across the whole
 * tree, recurses through layout-block slots (depth and total-count limits), and sanitizes
 * rich text per ADR-009.
 */
export function validateBlockDocument(doc: unknown): ValidationResult {
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return {
      success: false,
      errors: [{ path: "", message: "Block document must be a non-null object" }],
    };
  }

  const rawDoc = doc as Record<string, unknown>;

  if (rawDoc.version !== 1) {
    return {
      success: false,
      errors: [{ path: "version", message: "Only document version 1 is currently supported" }],
    };
  }

  if (!Array.isArray(rawDoc.blocks)) {
    return {
      success: false,
      errors: [{ path: "blocks", message: "Document must contain an array of blocks" }],
    };
  }

  const state: WalkState = { errors: [], seenIds: new Set<string>(), count: 0 };
  const blocks = validateBlockList(rawDoc.blocks, "blocks", 1, state);

  if (state.errors.length > 0) {
    return { success: false, errors: state.errors };
  }

  return { success: true, data: { version: 1, blocks } };
}

interface WalkState {
  errors: ValidationError[];
  seenIds: Set<string>;
  count: number;
}

function validateBlockList(
  rawList: unknown[],
  listPath: string,
  depth: number,
  state: WalkState,
): BlockInstance[] {
  const out: BlockInstance[] = [];

  if (depth > MAX_BLOCK_DEPTH) {
    state.errors.push({ path: listPath, message: `Blocks are nested deeper than ${MAX_BLOCK_DEPTH} levels` });
    return out;
  }

  for (let idx = 0; idx < rawList.length; idx++) {
    const rawBlock = rawList[idx] as Record<string, unknown> | null;
    const blockPath = `${listPath}[${idx}]`;

    if (++state.count > MAX_BLOCKS_PER_DOCUMENT) {
      if (state.count === MAX_BLOCKS_PER_DOCUMENT + 1) {
        state.errors.push({ path: blockPath, message: `A page can hold at most ${MAX_BLOCKS_PER_DOCUMENT} blocks` });
      }
      continue;
    }

    if (!rawBlock || typeof rawBlock !== "object") {
      state.errors.push({ path: blockPath, message: "Block must be an object" });
      continue;
    }

    const id = rawBlock.id;
    if (typeof id !== "string" || !id.trim()) {
      state.errors.push({ path: `${blockPath}.id`, message: "Block ID must be a non-empty string" });
      continue;
    }

    if (state.seenIds.has(id)) {
      state.errors.push({ path: `${blockPath}.id`, message: `Duplicate block ID: "${id}"` });
    } else {
      state.seenIds.add(id);
    }

    const type = rawBlock.type as BlockType;
    if (!type || !BLOCK_TYPES.includes(type)) {
      state.errors.push({
        path: `${blockPath}.type`,
        message: `Unknown block type: "${String(type)}"`,
      });
      continue;
    }

    const def = BLOCK_DEFINITIONS[type];
    const version = typeof rawBlock.version === "number" ? rawBlock.version : 1;

    const props: Record<string, unknown> =
      rawBlock.props && typeof rawBlock.props === "object" && !Array.isArray(rawBlock.props)
        ? { ...(rawBlock.props as Record<string, unknown>) }
        : {};

    if (type === "RichText" && typeof props.content === "string") {
      props.content = sanitizeRichText(props.content);
    }

    // Children are validated by this walker, not by the block's zod schema.
    let children: BlockInstance[] | undefined;
    if (SLOT_BLOCK_TYPES.has(type)) {
      const rawChildren = props[SLOT_PROP];
      if (rawChildren !== undefined && !Array.isArray(rawChildren)) {
        state.errors.push({ path: `${blockPath}.props.${SLOT_PROP}`, message: "Slot must be an array of blocks" });
        continue;
      }
      children = validateBlockList((rawChildren as unknown[] | undefined) ?? [], `${blockPath}.props.${SLOT_PROP}`, depth + 1, state);
      props[SLOT_PROP] = [];
    }

    const parseResult = def.schema.safeParse(props);
    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        state.errors.push({
          path: `${blockPath}.props.${issue.path.join(".")}`,
          message: issue.message,
        });
      }
      continue;
    }

    const parsed = parseResult.data as Record<string, unknown>;
    if (children) {
      parsed[SLOT_PROP] = children;
    }

    const validatedBlock: BlockInstance = { id, type, version, props: parsed };
    if (typeof rawBlock.hidden === "boolean") {
      validatedBlock.hidden = rawBlock.hidden;
    }
    out.push(validatedBlock);
  }

  return out;
}

/**
 * Migrates a single block from its current version to the registry's target version.
 */
export function migrateBlock(block: BlockInstance): BlockInstance {
  if (!block || typeof block !== "object") {
    return block;
  }
  const def = BLOCK_DEFINITIONS[block.type];
  if (!def) {
    return block;
  }

  let currentVersion = block.version;
  let currentProps = { ...block.props };

  const typeMigrations = MIGRATION_REGISTRY.get(block.type);

  while (currentVersion < def.version && typeMigrations?.has(currentVersion)) {
    const migrator = typeMigrations.get(currentVersion);
    if (!migrator) {
      break;
    }
    currentProps = migrator(currentProps);
    currentVersion += 1;
  }

  const slot = currentProps[SLOT_PROP];
  if (SLOT_BLOCK_TYPES.has(block.type) && Array.isArray(slot)) {
    currentProps[SLOT_PROP] = (slot as BlockInstance[]).map(migrateBlock);
  }

  return {
    ...block,
    version: currentVersion,
    props: currentProps,
  };
}

/**
 * Migrates all blocks in a document that are below the current registry version.
 */
export function migrateBlockDocument(doc: BlockDocument): BlockDocument {
  if (!doc || !Array.isArray(doc.blocks)) {
    return doc;
  }
  const migratedBlocks = doc.blocks.map(migrateBlock);
  return {
    ...doc,
    blocks: migratedBlocks,
  };
}
