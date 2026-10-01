import { BLOCK_DEFINITIONS } from "./registry.ts";
import { SLOT_BLOCK_TYPES, SLOT_PROP, type BlockDocument, type BlockInstance, type BlockType } from "./types.ts";

/**
 * Converts between our versioned block documents (the stored source of truth, ADR-009) and
 * Puck's editor data shape. Puck is an editing UI only: nothing Puck-specific is persisted,
 * so the editor can be swapped without a data migration. Structural types only; this module
 * does not import Puck.
 */
export interface PuckItem {
  type: string;
  props: { id: string } & Record<string, unknown>;
}
export interface PuckData {
  root: { props?: Record<string, unknown> };
  content: PuckItem[];
}

function toItem(block: BlockInstance): PuckItem {
  // `content` is only a slot on layout blocks; RichText has an ordinary `content` string prop.
  const props: PuckItem["props"] = { ...block.props, id: block.id };
  if (SLOT_BLOCK_TYPES.has(block.type)) {
    const slot = block.props[SLOT_PROP];
    props[SLOT_PROP] = Array.isArray(slot) ? (slot as BlockInstance[]).map(toItem) : [];
  }
  return { type: block.type, props };
}

export function documentToPuck(doc: BlockDocument): PuckData {
  return { root: { props: {} }, content: doc.blocks.map(toItem) };
}

function fromItem(item: PuckItem): BlockInstance | null {
  const def = BLOCK_DEFINITIONS[item.type as BlockType];
  if (!def) return null;
  const { id, ...rest } = item.props;
  const props: Record<string, unknown> = { ...rest };
  if (SLOT_BLOCK_TYPES.has(item.type as BlockType)) {
    const slot = rest[SLOT_PROP];
    props[SLOT_PROP] = Array.isArray(slot)
      ? (slot as PuckItem[]).map(fromItem).filter((b): b is BlockInstance => b !== null)
      : [];
  }
  return { id: String(id), type: item.type as BlockType, version: def.version, props };
}

export function puckToDocument(data: PuckData): BlockDocument {
  return {
    version: 1,
    blocks: data.content.map(fromItem).filter((b): b is BlockInstance => b !== null),
  };
}
