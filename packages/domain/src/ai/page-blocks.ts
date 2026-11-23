/**
 * What an AI app needs to edit website pages (docs/MCP-CONTENT-MAP.md): the block types a store may use, the description of one
 * type's properties, and small pure edits of a block tree. It never saves anything: the capability layer saves through
 * `savePageDraft`, which runs the same ADR-009 validation as the page builder (enumerated props, sanitised text, unique ids,
 * depth and count limits). No merchant-controlled code can pass through here.
 */
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { BLOCK_DEFINITIONS, MARKETING_BLOCK_TYPES, SLOT_BLOCK_TYPES, SLOT_PROP, bricksLayoutSchema, type BlockInstance, type BlockType } from "@bs/blocks";

export interface BlockTypeInfo {
  type: string;
  version: number;
  /** Holds other blocks in its `content` list. */
  container: boolean;
}

/** The block types a store's pages may hold: everything except the platform's own website sections. */
export function storeBlockTypes(): BlockTypeInfo[] {
  return (Object.keys(BLOCK_DEFINITIONS) as BlockType[])
    .filter((t) => !MARKETING_BLOCK_TYPES.has(t))
    .map((t) => ({ type: t, version: BLOCK_DEFINITIONS[t].version, container: SLOT_BLOCK_TYPES.has(t) }));
}

export function isStoreBlockType(type: string): type is BlockType {
  return type in BLOCK_DEFINITIONS && !MARKETING_BLOCK_TYPES.has(type);
}

const LAYOUT_KEYS = new Set(Object.keys(bricksLayoutSchema.shape));

/** One block type: its default props and the shape of its own props. Spacing, colour and layout options common to every block are listed by name only, to keep this short. */
export function describeBlockType(type: string): { type: string; version: number; container: boolean; defaultProps: unknown; props: unknown; commonLayoutProps: string[]; note?: string } {
  if (!isStoreBlockType(type)) throw new Error("Not Found: that block type does not exist for stores. Use list_block_types.");
  const def = BLOCK_DEFINITIONS[type];
  let props: unknown = null;
  let note: string | undefined;
  try {
    const json = z.toJSONSchema(def.schema as z.ZodType, { unrepresentable: "any", io: "input" }) as { properties?: Record<string, unknown>; required?: string[] };
    const properties = Object.fromEntries(Object.entries(json.properties ?? {}).filter(([k]) => !LAYOUT_KEYS.has(k) || k === SLOT_PROP));
    props = { properties, required: (json.required ?? []).filter((k) => !LAYOUT_KEYS.has(k)) };
  } catch {
    note = "The property shape could not be described; use the default props as a guide and read an existing block of this type with get_page_block.";
  }
  return {
    type,
    version: def.version,
    container: SLOT_BLOCK_TYPES.has(type),
    defaultProps: def.defaultProps,
    props,
    commonLayoutProps: [...LAYOUT_KEYS].filter((k) => k !== SLOT_PROP),
    ...(note ? { note } : {}),
  };
}

/** A new block with a fresh id, the type's default props and the given props on top (the page validation decides if the result is valid). */
export function newBlock(type: string, props: Record<string, unknown> = {}): BlockInstance {
  if (!isStoreBlockType(type)) throw new Error("Bad Request: that block type is not available for store pages. Use list_block_types.");
  const def = BLOCK_DEFINITIONS[type];
  return {
    id: `ai-${randomBytes(6).toString("hex")}`,
    type,
    version: def.version,
    props: { ...structuredClone(def.defaultProps as Record<string, unknown>), ...props },
  };
}

const TEXT_KEYS = ["text", "label", "heading", "title", "eyebrow", "name", "question"];

export interface BlockOutline {
  id: string;
  type: string;
  hidden?: boolean;
  text?: string;
  children?: BlockOutline[];
}

function childrenOf(block: BlockInstance): BlockInstance[] | null {
  const c = (block.props as Record<string, unknown>)[SLOT_PROP];
  return SLOT_BLOCK_TYPES.has(block.type) && Array.isArray(c) ? (c as BlockInstance[]) : null;
}

/** The page as a short tree: ids, types, a text hint and children. The full props of one block come from get_page_block. */
export function outlineBlocks(blocks: readonly BlockInstance[]): BlockOutline[] {
  return blocks.map((b) => {
    const props = b.props as Record<string, unknown>;
    const hint = TEXT_KEYS.map((k) => props[k]).find((v): v is string => typeof v === "string" && v.trim().length > 0);
    const kids = childrenOf(b);
    return {
      id: b.id,
      type: b.type,
      ...(b.hidden ? { hidden: true } : {}),
      ...(hint ? { text: hint.replace(/\s+/g, " ").slice(0, 90) } : {}),
      ...(kids?.length ? { children: outlineBlocks(kids) } : {}),
    };
  });
}

export interface BlockLocation {
  block: BlockInstance;
  list: BlockInstance[];
  index: number;
  parent: BlockInstance | null;
}

export function findBlock(blocks: BlockInstance[], id: string, parent: BlockInstance | null = null): BlockLocation | null {
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (!b) continue;
    if (b.id === id) return { block: b, list: blocks, index: i, parent };
    const kids = childrenOf(b);
    if (kids) {
      const hit = findBlock(kids, id, b);
      if (hit) return hit;
    }
  }
  return null;
}

/** A copy of the block with its nested blocks replaced by a count, so one block can be read without the whole subtree. */
export function shallowBlock(block: BlockInstance): unknown {
  const kids = childrenOf(block);
  if (!kids) return block;
  const { [SLOT_PROP]: _drop, ...rest } = block.props as Record<string, unknown>;
  return { ...block, props: { ...rest, [SLOT_PROP]: { blocks: kids.length, outline: outlineBlocks(kids) } } };
}

export class BlockEditError extends Error {}

const fail = (message: string): never => {
  throw new BlockEditError(`Bad Request: ${message}`);
};

/** Puts `block` into the root list or into a container's content list. `position` is 0-based; omitted means at the end. */
export function insertBlock(blocks: BlockInstance[], block: BlockInstance, parentId: string | undefined, position: number | undefined): BlockInstance[] {
  const next = structuredClone(blocks);
  let list = next;
  if (parentId) {
    const parent = findBlock(next, parentId)?.block;
    if (!parent) return fail("The parent block was not found on this page.");
    if (!SLOT_BLOCK_TYPES.has(parent.type)) return fail(`A ${parent.type} block cannot hold other blocks. Only Section, Container and Block can.`);
    const props = parent.props as Record<string, unknown>;
    if (!Array.isArray(props[SLOT_PROP])) props[SLOT_PROP] = [];
    list = props[SLOT_PROP] as BlockInstance[];
  }
  const at = position === undefined ? list.length : Math.max(0, Math.min(position, list.length));
  list.splice(at, 0, block);
  return next;
}

export function removeBlock(blocks: BlockInstance[], id: string): { blocks: BlockInstance[]; removed: BlockInstance } {
  const next = structuredClone(blocks);
  const hit = findBlock(next, id);
  if (!hit) return fail("That block was not found on this page.");
  hit.list.splice(hit.index, 1);
  return { blocks: next, removed: hit.block };
}

export function moveBlock(blocks: BlockInstance[], id: string, parentId: string | undefined, position: number | undefined): BlockInstance[] {
  const hit = findBlock(blocks, id);
  if (!hit) return fail("That block was not found on this page.");
  if (parentId && (parentId === id || findBlock(childrenOf(hit.block) ?? [], parentId))) return fail("A block cannot be moved into itself.");
  const { blocks: without, removed } = removeBlock(blocks, id);
  return insertBlock(without, removed, parentId, position);
}

/** Merges `patch` into the block's own props (keys set to null are removed). Nested blocks cannot be changed this way. */
export function patchBlockProps(blocks: BlockInstance[], id: string, patch: Record<string, unknown>): BlockInstance[] {
  if (SLOT_PROP in patch) return fail("Nested blocks cannot be set through props. Use add_page_block, move_page_block and remove_page_block.");
  const next = structuredClone(blocks);
  const hit = findBlock(next, id);
  if (!hit) return fail("That block was not found on this page.");
  const props = hit.block.props as Record<string, unknown>;
  for (const [k, v] of Object.entries(patch)) {
    if (v === null) Reflect.deleteProperty(props, k);
    else props[k] = v;
  }
  return next;
}

export function setBlockHidden(blocks: BlockInstance[], id: string, hidden: boolean): BlockInstance[] {
  const next = structuredClone(blocks);
  const hit = findBlock(next, id);
  if (!hit) return fail("That block was not found on this page.");
  if (hidden) hit.block.hidden = true;
  else delete hit.block.hidden;
  return next;
}
