import { BLOCK_DEFINITIONS, type BlockType, BLOCK_TYPES } from "./registry.ts";
import type { BlockInstance, BlockDocument } from "./types.ts";
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
 * Validates a block document JSON payload against the block registry.
 * Validates document version, block schema props, enforces ID uniqueness,
 * and automatically sanitizes rich text blocks per ADR-009.
 */
export function validateBlockDocument(doc: unknown): ValidationResult {
  const errors: ValidationError[] = [];

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

  const seenIds = new Set<string>();
  const validatedBlocks: BlockInstance[] = [];

  for (let idx = 0; idx < rawDoc.blocks.length; idx++) {
    const rawBlock = rawDoc.blocks[idx] as Record<string, unknown> | null;
    const blockPath = `blocks[${idx}]`;

    if (!rawBlock || typeof rawBlock !== "object") {
      errors.push({ path: blockPath, message: "Block must be an object" });
      continue;
    }

    const id = rawBlock.id;
    if (typeof id !== "string" || !id.trim()) {
      errors.push({ path: `${blockPath}.id`, message: "Block ID must be a non-empty string" });
      continue;
    }

    if (seenIds.has(id)) {
      errors.push({ path: `${blockPath}.id`, message: `Duplicate block ID: "${id}"` });
    } else {
      seenIds.add(id);
    }

    const type = rawBlock.type as BlockType;
    if (!type || !BLOCK_TYPES.includes(type)) {
      errors.push({
        path: `${blockPath}.type`,
        message: `Unknown block type: "${String(type)}"`,
      });
      continue;
    }

    const def = BLOCK_DEFINITIONS[type];
    const version = typeof rawBlock.version === "number" ? rawBlock.version : 1;

    let props = rawBlock.props;
    if (!props || typeof props !== "object" || Array.isArray(props)) {
      props = {};
    }

    // Auto-sanitize rich text content before schema parsing
    if (type === "RichText" && typeof (props as Record<string, unknown>).content === "string") {
      (props as Record<string, unknown>).content = sanitizeRichText(
        (props as Record<string, unknown>).content as string,
      );
    }

    const parseResult = def.schema.safeParse(props);
    if (!parseResult.success) {
      for (const issue of parseResult.error.issues) {
        errors.push({
          path: `${blockPath}.props.${issue.path.join(".")}`,
          message: issue.message,
        });
      }
      continue;
    }

    const validatedBlock: BlockInstance = {
      id,
      type,
      version,
      props: parseResult.data as Record<string, unknown>,
    };
    if (typeof rawBlock.hidden === "boolean") {
      validatedBlock.hidden = rawBlock.hidden;
    }
    validatedBlocks.push(validatedBlock);
  }

  if (errors.length > 0) {
    return { success: false, errors };
  }

  return {
    success: true,
    data: {
      version: 1,
      blocks: validatedBlocks,
    },
  };
}

/**
 * Migrates a single block from its current version to the registry's target version.
 */
export function migrateBlock(block: BlockInstance): BlockInstance {
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
  const migratedBlocks = doc.blocks.map(migrateBlock);
  return {
    ...doc,
    blocks: migratedBlocks,
  };
}
