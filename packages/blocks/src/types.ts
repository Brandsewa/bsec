import type { CSSProperties, ReactNode } from "react";
import type { z } from "zod";

export type BlockType =
  // Sections and content (M2)
  | "Hero"
  | "Banner"
  | "ProductGrid"
  | "CollectionGrid"
  | "ProductCarousel"
  | "Testimonials"
  | "Reviews"
  | "RichText"
  | "FAQ"
  | "Gallery"
  | "Newsletter"
  | "UspStrip"
  // Layout primitives: hold child blocks in their `content` slot
  | "Section"
  | "Container"
  | "Grid"
  | "FlexRow"
  | "FlexColumn"
  | "Spacer"
  | "Divider"
  // Content primitives
  | "Heading"
  | "Text"
  | "Image"
  | "Video"
  | "Button"
  | "Icon"
  | "Link"
  // Conversion widgets
  | "CallToAction";

/** Minimal product shape the product blocks need; the host supplies the real data. Prices are in paise. */
export interface BlockProduct {
  id: string;
  title: string;
  slug: string;
  priceMin: number;
  compareAtPriceMin?: number | undefined;
  ratingAvg?: string | undefined;
  ratingCount?: number | undefined;
  imageMediaId?: string | undefined;
  /** Ready-to-use public URL of the primary image, when the host already knows it. */
  imageUrl?: string | undefined;
  imageAlt?: string | null | undefined;
}

export interface BlockCollectionSummary {
  slug: string;
  title: string;
  imageMediaId?: string | undefined;
}

/** Server-resolved data for blocks that need store data, keyed by block id. */
export type BlockData =
  | { kind: "products"; products: BlockProduct[] }
  | { kind: "collections"; collections: BlockCollectionSummary[] };

/**
 * Host-provided rendering context. Blocks stay UI-agnostic: the storefront and the
 * visual editor each inject how media URLs and product cards are drawn.
 */
export interface RenderContext {
  mediaUrl?: ((mediaId: string) => string | null) | undefined;
  data?: Record<string, BlockData | undefined> | undefined;
  renderProductCard?: ((product: BlockProduct, opts: { showPrice: boolean; showRating: boolean }) => ReactNode) | undefined;
  /** Stable id of the block being rendered (for data lookup). */
  blockId?: string | undefined;
}

/**
 * A slot renderer: hosts that draw the slot themselves (the visual editor's drop zone) pass one
 * of these so layout classes land on the element that actually contains the children.
 */
export type SlotRender = (p: { className?: string; style?: CSSProperties }) => ReactNode;

export interface BlockRenderArgs<TProps> {
  props: TProps;
  /** Rendered children of the block's `content` slot (layout blocks only). */
  children?: ReactNode | SlotRender;
  ctx?: RenderContext | undefined;
}

export interface BlockDefinition<TProps = unknown> {
  type: BlockType;
  version: number;
  schema: z.ZodType<TProps>;
  defaultProps: TProps;
  render: (data: BlockRenderArgs<TProps>) => ReactNode;
  migrate?: (fromVersion: number, props: unknown) => TProps;
}

export interface BlockInstance {
  id: string;
  type: BlockType;
  version: number;
  props: Record<string, unknown>;
  hidden?: boolean | undefined;
}

export interface BlockDocument {
  version: 1;
  blocks: BlockInstance[];
}

/**
 * Props that hold nested block arrays. Only layout blocks have slots; the slot is always
 * named `content`. Validation, migration and rendering recurse through these.
 */
export const SLOT_BLOCK_TYPES: ReadonlySet<BlockType> = new Set<BlockType>([
  "Section",
  "Container",
  "Grid",
  "FlexRow",
  "FlexColumn",
]);
export const SLOT_PROP = "content";

/** Hard limits that keep documents (and the storefront's render cost) bounded. */
export const MAX_BLOCK_DEPTH = 6;
export const MAX_BLOCKS_PER_DOCUMENT = 300;
