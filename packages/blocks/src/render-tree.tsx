/** @jsxRuntime automatic */
/** @jsxImportSource react */
import { Fragment, type ReactNode } from "react";
import { getBlockDefinition } from "./registry.ts";
import { childrenOf } from "./tree.ts";
import { SLOT_BLOCK_TYPES, type BlockInstance, type RenderContext } from "./types.ts";

export interface RenderTreeOptions {
  /** Lets a host add per-block extras (e.g. JSON-LD) around the rendered block. */
  wrap?: ((block: BlockInstance, rendered: ReactNode, props: unknown) => ReactNode) | undefined;
}

/**
 * Renders a validated block tree with host-provided context. Used by the storefront and by theme
 * previews in the admin. Unknown blocks are skipped rather than crashing the page.
 */
export function renderBlockTree(blocks: BlockInstance[], base: RenderContext, options: RenderTreeOptions = {}): ReactNode {
  return blocks.map((block) => renderOne(block, base, options));
}

function renderOne(block: BlockInstance, base: RenderContext, options: RenderTreeOptions): ReactNode {
  if (block.hidden) return null;

  let def;
  try {
    def = getBlockDefinition(block.type);
  } catch {
    return null;
  }

  // Parse/merge props with defaults
  const parsed = def.schema.safeParse(block.props);
  const props = parsed.success ? parsed.data : { ...def.defaultProps, ...block.props };

  // Layout blocks render their children through the slot (depth is bounded at save time).
  const children = SLOT_BLOCK_TYPES.has(block.type)
    ? childrenOf(block).map((child) => renderOne(child, base, options))
    : undefined;

  const rendered = def.render({ props, children, ctx: { ...base, blockId: block.id } });
  return <Fragment key={block.id}>{options.wrap ? options.wrap(block, rendered, props) : rendered}</Fragment>;
}
