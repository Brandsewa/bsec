import { SLOT_BLOCK_TYPES, SLOT_PROP, type BlockInstance } from "./types.ts";

/** Children of a block's `content` slot (empty for non-layout blocks). */
export function childrenOf(block: BlockInstance): BlockInstance[] {
  const slot = block.props[SLOT_PROP];
  return SLOT_BLOCK_TYPES.has(block.type) && Array.isArray(slot) ? (slot as BlockInstance[]) : [];
}

/** Depth-first walk over every block in the tree. */
export function walkBlocks(blocks: BlockInstance[], visit: (block: BlockInstance) => void): void {
  for (const b of blocks) {
    visit(b);
    walkBlocks(childrenOf(b), visit);
  }
}

/** Removes hidden blocks (and their subtrees) without mutating the input. */
export function filterVisibleBlocks(blocks: BlockInstance[]): BlockInstance[] {
  return blocks
    .filter((b) => !b.hidden)
    .map((b) =>
      SLOT_BLOCK_TYPES.has(b.type)
        ? { ...b, props: { ...b.props, [SLOT_PROP]: filterVisibleBlocks(childrenOf(b)) } }
        : b,
    );
}
